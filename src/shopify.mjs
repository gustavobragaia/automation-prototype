// Escrita do rastreio na Shopify via Admin GraphQL.
// Suporta vários códigos no mesmo fulfillment (2% dos pedidos da base real).
//
// De onde vem o token não é problema deste arquivo: ver src/shopify-conexao.mjs.

import { conexaoAtiva, tokenDaConexao, ESCOPOS } from "./shopify-conexao.mjs";

const VERSAO = process.env.SHOPIFY_API_VERSAO ?? "2026-04";

/** Mantido para os scripts que já chamavam obterToken({...}). */
export async function obterToken({ token, conexao } = {}) {
  if (token) return token;
  return tokenDaConexao(conexao ?? conexaoAtiva());
}

export async function graphql(query, variables = {}, { conexao, token } = {}) {
  const c = conexao ?? conexaoAtiva();
  if (!c?.loja) throw new Error("nenhuma loja Shopify conectada — rode: npm run conectar");
  const t = token ?? (await tokenDaConexao(c));

  const r = await fetch(`https://${c.loja}/admin/api/${VERSAO}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": t },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });

  if (r.status === 401 || r.status === 403)
    throw new Error(`Shopify negou acesso (HTTP ${r.status}) — o app provavelmente não tem os escopos: ${ESCOPOS.join(", ")}`);
  if (!r.ok) throw new Error(`Shopify HTTP ${r.status}`);

  const json = await r.json();
  if (json.errors) throw new Error(`Shopify: ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.data;
}

// ─── Identidade da loja ──────────────────────────────────────────────────────

const QUERY_LOJA = `{ shop { name myshopifyDomain email currencyCode } }`;

/** Nome da loja conectada. É o que o painel mostra para o cliente conferir. */
export async function identidadeDaLoja(opts = {}) {
  const d = await graphql(QUERY_LOJA, {}, opts);
  return d.shop;
}

/**
 * Escopos realmente concedidos ao token. Vale mais que a configuração do app:
 * é o que diz se a escrita vai falhar antes de a gente tentar escrever.
 */
export async function escoposConcedidos({ conexao, token } = {}) {
  const c = conexao ?? conexaoAtiva();
  const t = token ?? (await tokenDaConexao(c));
  const r = await fetch(`https://${c.loja}/admin/oauth/access_scopes.json`, {
    headers: { "X-Shopify-Access-Token": t },
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) return null; // alguns modos não expõem esse endpoint
  const j = await r.json().catch(() => ({}));
  return (j.access_scopes ?? []).map((s) => s.handle);
}

// ─── Leitura de pedidos ──────────────────────────────────────────────────────

const CAMPOS_PEDIDO = `
  id name createdAt displayFulfillmentStatus
  totalPriceSet { shopMoney { amount } }
  shippingAddress { name address1 city province zip }
  lineItems(first: 10) { nodes { title quantity } }
  fulfillmentOrders(first: 10) { nodes { id status } }
`;

function mapear(o) {
  return {
    pedido: o.name,
    id: o.id,
    criadoEm: o.createdAt,
    situacao: o.displayFulfillmentStatus,
    // o nome que importa é o do ENDEREÇO DE ENTREGA, não o do cliente:
    // é esse que aparece na Shopee
    nome: o.shippingAddress?.name ?? "",
    cep: (o.shippingAddress?.zip ?? "").replace(/\D/g, ""),
    endereco: [o.shippingAddress?.address1, o.shippingAddress?.city, o.shippingAddress?.province]
      .filter(Boolean).join(", "),
    valor: Number(o.totalPriceSet?.shopMoney?.amount ?? 0),
    produto: o.lineItems?.nodes?.[0]?.title ?? null,
    unidades: o.lineItems?.nodes?.reduce((s, i) => s + (i.quantity ?? 0), 0) ?? null,
    fulfillmentOrderId:
      o.fulfillmentOrders?.nodes?.find((f) => f.status === "OPEN")?.id
      ?? o.fulfillmentOrders?.nodes?.[0]?.id
      ?? null,
  };
}

const QUERY_BUSCA = `
query buscar($q: String!, $cursor: String) {
  orders(first: 50, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes { ${CAMPOS_PEDIDO} }
  }
}`;

async function buscar(q, opts = {}) {
  const saida = [];
  let cursor = null;
  do {
    const d = await graphql(QUERY_BUSCA, { q, cursor }, opts);
    saida.push(...d.orders.nodes.map(mapear));
    cursor = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
  } while (cursor);
  return saida;
}

/** Pedidos da Shopify ainda sem rastreio — o lado "aberto" do casamento. */
export function pedidosAbertos(opts = {}) {
  return buscar("fulfillment_status:unfulfilled AND status:open", opts);
}

/**
 * Pedidos por número, como vêm na planilha do cliente ("Pedido #164891").
 * Esse é o caminho preferido: a planilha já diz QUAL pedido da Shopify é,
 * então não há casamento por nome nem ambiguidade a resolver.
 *
 * A Shopify casa `name:` por prefixo em alguns casos, então o resultado é
 * filtrado por igualdade exata do número.
 */
export async function pedidosPorNumero(numeros, opts = {}) {
  const limpos = [...new Set(numeros.map(normalizarNumero).filter(Boolean))];
  const porNumero = new Map();

  // 20 por consulta: o `query` da Shopify tem limite de tamanho e a busca
  // com muitos OR fica lenta.
  for (let i = 0; i < limpos.length; i += 20) {
    const lote = limpos.slice(i, i + 20);
    const q = lote.map((n) => `name:${n}`).join(" OR ");
    for (const p of await buscar(q, opts)) {
      const n = normalizarNumero(p.pedido);
      if (lote.includes(n)) porNumero.set(n, p);
    }
  }
  return porNumero;
}

/** "Pedido #164891" / "164891" / "#164891" -> "164891" */
export function normalizarNumero(valor) {
  const m = String(valor ?? "").match(/(\d{3,})/);
  return m ? m[1] : null;
}

// ─── Escrita ─────────────────────────────────────────────────────────────────

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
  if (!fulfillmentOrderId) throw new Error("sem fulfillmentOrderId: o pedido não tem fulfillment order aberta");

  return {
    lineItemsByFulfillmentOrder: [{ fulfillmentOrderId }],
    notifyCustomer: notificar,
    trackingInfo:
      numeros.length === 1
        ? { number: numeros[0], company: transportadora, url: urlRastreio(numeros[0]) }
        // (n) => …, e não .map(urlRastreio): o map passaria o índice como modelo
        : { numbers: numeros, company: transportadora, urls: numeros.map((n) => urlRastreio(n)) },
  };
}

// O link de rastreio que vai no pedido. O dos Correios
// (rastreamento.correios.com.br/app/index.php?objeto=) parou de funcionar —
// mostra o formulário vazio com captcha — e nem era a transportadora certa:
// os BR26… são da Shopee Express. O cliente (Chomps, 26/10/2026) pediu o
// parcelsapp, que mostra o histórico inteiro sem captcha.
//
// Configurável em Ajustes ("Link de rastreio"), para o cliente trocar
// sozinho se esse site também mudar. Aceita o endereço puro (o código vai no
// fim, depois de uma barra) ou com {codigo} onde o código entra.
export const LINK_RASTREIO_PADRAO = "https://parcelsapp.com/pt/tracking";

export function modeloDeLink(modelo = process.env.LINK_RASTREIO) {
  const m = String(modelo ?? "").trim() || LINK_RASTREIO_PADRAO;
  if (!/^https:\/\/[^\s/]+\.[^\s]+/i.test(m)) throw new Error(`o link de rastreio precisa começar com https:// (está "${m}")`);
  return m;
}

export function urlRastreio(codigo, modelo) {
  const m = modeloDeLink(modelo);
  const c = encodeURIComponent(String(codigo).trim());
  return m.includes("{codigo}") ? m.split("{codigo}").join(c) : `${m.replace(/\/+$/, "")}/${c}`;
}

// Shopee Express para os da Shopee (BR26… e SPX…), Correios só para código
// dos Correios de verdade (AA123456789BR). Mistura vira "Outros". O link que
// o robô manda vale mais que o que a Shopify gera pela transportadora
// (testado na loja de teste em 26/10), então o nome é só o que o cliente lê.
export function transportadoraDe(codigos) {
  const tipos = new Set(codigos.map((c) => tipoDe(c)));
  if (tipos.size === 1) return [...tipos][0] === "correios" ? "Correios" : "Shopee Xpress";
  return "Outros";
}
const CORREIOS_DE_VERDADE = /^[A-Z]{2}\d{9}BR$/i;
// pelo formato, e não pelo rótulo do leitor: vale para código solto também
const tipoDe = (c) => (CORREIOS_DE_VERDADE.test(typeof c === "string" ? c : c.code) ? "correios" : "shopee");

export async function enviar(entrada, opts = {}) {
  if (opts.dryRun)
    return { dryRun: true, enviaria: { query: "fulfillmentCreateV2", variables: { f: entrada } } };

  const d = await graphql(MUTATION, { f: entrada }, opts);
  const erros = d?.fulfillmentCreateV2?.userErrors ?? [];
  if (erros.length) throw new Error(`Shopify: ${erros.map((e) => e.message).join("; ")}`);
  return d.fulfillmentCreateV2.fulfillment;
}
