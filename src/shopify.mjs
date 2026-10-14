// Escrita do rastreio na Shopify via Admin GraphQL.
// Suporta vários códigos no mesmo fulfillment (2% dos pedidos da base real).

const VERSAO = process.env.SHOPIFY_API_VERSAO ?? "2026-04";

// A Shopify aposentou os apps personalizados legados em 01/01/2026: não
// existe mais token estático na tela. Apps do Dev Dashboard trocam
// client_id + client_secret por um token que vale 24h, então o robô
// renova sozinho e guarda em memória até perto do vencimento.
let tokenCache = { valor: null, expiraEm: 0 };

export async function obterToken({ loja, clientId, clientSecret, token } = {}) {
  if (token) return token;                       // token fixo, se houver
  if (tokenCache.valor && Date.now() < tokenCache.expiraEm) return tokenCache.valor;

  loja ??= process.env.SHOPIFY_LOJA;
  clientId ??= process.env.SHOPIFY_CLIENT_ID;
  clientSecret ??= process.env.SHOPIFY_CLIENT_SECRET;
  if (!loja || !clientId || !clientSecret)
    throw new Error("faltam SHOPIFY_LOJA, SHOPIFY_CLIENT_ID e SHOPIFY_CLIENT_SECRET no .env");

  const r = await fetch(`https://${loja}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token)
    throw new Error(`troca de token falhou (HTTP ${r.status}): ${JSON.stringify(j).slice(0, 200)}`);

  const segundos = Number(j.expires_in ?? 86400);
  tokenCache = { valor: j.access_token, expiraEm: Date.now() + (segundos - 300) * 1000 };
  return tokenCache.valor;
}

const MUTATION = `
mutation criarFulfillment($f: FulfillmentV2Input!) {
  fulfillmentCreateV2(fulfillment: $f) {
    fulfillment { id status trackingInfo { number url company } }
    userErrors { field message }
  }
}`;

export function montarEntrada({ fulfillmentOrderId, codigos, transportadora, notificar = true }) {
  const numeros = codigos.map((c) => (typeof c === "string" ? c : c.code));
  if (numeros.length === 0) throw new Error("sem código de rastreio");

  return {
    lineItemsByFulfillmentOrder: [{ fulfillmentOrderId }],
    notifyCustomer: notificar,
    trackingInfo:
      numeros.length === 1
        ? { number: numeros[0], company: transportadora, url: urlRastreio(numeros[0]) }
        : { numbers: numeros, company: transportadora, urls: numeros.map(urlRastreio) },
  };
}

export function urlRastreio(codigo) {
  if (/^SPX/i.test(codigo)) return `https://spx.com.br/track?${new URLSearchParams({ key: codigo })}`;
  return `https://rastreamento.correios.com.br/app/index.php?${new URLSearchParams({ objeto: codigo })}`;
}

export function transportadoraDe(codigos) {
  const tipos = new Set(codigos.map((c) => (typeof c === "string" ? inferir(c) : c.carrier)));
  if (tipos.size === 1) return [...tipos][0] === "shopee-xpress" ? "Shopee Xpress" : "Correios";
  return "Outros";
}
const inferir = (c) => (/^SPX/i.test(c) ? "shopee-xpress" : "correios");

export async function enviar(entrada, { loja, token, dryRun = false } = {}) {
  if (dryRun) return { dryRun: true, enviaria: { query: "fulfillmentCreateV2", variables: { f: entrada } } };
  loja ??= process.env.SHOPIFY_LOJA;
  token = await obterToken({ loja, token });

  const r = await fetch(`https://${loja}/admin/api/${VERSAO}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query: MUTATION, variables: { f: entrada } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`Shopify HTTP ${r.status}`);

  const json = await r.json();
  const erros = json?.data?.fulfillmentCreateV2?.userErrors ?? [];
  if (erros.length) throw new Error(`Shopify: ${erros.map((e) => e.message).join("; ")}`);
  return json.data.fulfillmentCreateV2.fulfillment;
}


const QUERY_ABERTOS = `
query pedidosAbertos($cursor: String) {
  orders(first: 50, after: $cursor, query: "fulfillment_status:unfulfilled AND status:open") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt
      totalPriceSet { shopMoney { amount } }
      shippingAddress { name address1 city province zip }
      lineItems(first: 5) { nodes { title quantity } }
      fulfillmentOrders(first: 5) { nodes { id status } }
    }
  }
}`;

/** Pedidos da Shopify ainda sem rastreio — o lado "aberto" do casamento. */
export async function pedidosAbertos({ loja, token } = {}) {
  loja ??= process.env.SHOPIFY_LOJA;
  token = await obterToken({ loja, token });

  const saida = [];
  let cursor = null;
  do {
    const r = await fetch(`https://${loja}/admin/api/${VERSAO}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: QUERY_ABERTOS, variables: { cursor } }),
      signal: AbortSignal.timeout(30_000),
    });
    const j = await r.json();
    if (j.errors) throw new Error(`Shopify: ${JSON.stringify(j.errors).slice(0, 300)}`);
    const p = j.data.orders;
    for (const o of p.nodes) {
      saida.push({
        pedido: o.name,
        id: o.id,
        criadoEm: o.createdAt,
        // o nome que importa é o do ENDEREÇO DE ENTREGA, não o do cliente:
        // é esse que aparece na Shopee
        nome: o.shippingAddress?.name ?? "",
        cep: (o.shippingAddress?.zip ?? "").replace(/\D/g, ""),
        endereco: [o.shippingAddress?.address1, o.shippingAddress?.city, o.shippingAddress?.province].filter(Boolean).join(", "),
        valor: Number(o.totalPriceSet?.shopMoney?.amount ?? 0),
        produto: o.lineItems?.nodes?.[0]?.title ?? null,
        unidades: o.lineItems?.nodes?.reduce((s, i) => s + (i.quantity ?? 0), 0) ?? null,
        fulfillmentOrderId: o.fulfillmentOrders?.nodes?.find((f) => f.status === "OPEN")?.id
          ?? o.fulfillmentOrders?.nodes?.[0]?.id ?? null,
      });
    }
    cursor = p.pageInfo.hasNextPage ? p.pageInfo.endCursor : null;
  } while (cursor);

  return saida;
}
