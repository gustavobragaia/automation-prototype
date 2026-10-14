// Escrita do rastreio na Shopify via Admin GraphQL.
// Suporta vários códigos no mesmo fulfillment (2% dos pedidos da base real).

const VERSAO = "2026-04";

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
  if (!loja || !token) throw new Error("faltam credenciais da Shopify");

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
