// Monta uma rodada inteira em disco, para o teste de fluxo ter algo real
// para conciliar: uma planilha .xlsx de verdade e os arquivos que o coletor
// teria gravado. Nada aqui é mock de função — são os mesmos arquivos que a
// Shopee e o cliente produzem.
import ExcelJS from "exceljs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PEDIDOS = {
  casado:    { pedido: "#1001", nome: "Sílvia Fictícia Mota",   conta: 124, valor: 88.30 },
  semCodigo: { pedido: "#1002", nome: "Otávio Fictício Reis",    conta: 124, valor: 31.33 },
  outraConta:{ pedido: "#1003", nome: "Lívia Fictícia Prado",conta: 124, valor: 57.65 },
  empate:    { pedido: "#1004", nome: "Marta Fictícia Lins",  conta: 128, valor: 13.00 },
};

// Os perfis do AdsPower, nomeados como o cliente nomeia: o número da conta
// dentro do nome é o que amarra conta -> perfil.
export const PERFIS = [
  { user_id: "k1boua9d", serial_number: "101", name: "shopee 124" },
  { user_id: "k1cexbyh", serial_number: "102", name: "shopee 128" },
];

export async function montarCenario(dir) {
  mkdirSync(join(dir, "captura", "coletas"), { recursive: true });

  // ── a planilha que o cliente exporta da Shopify ──
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("PEDIDOS");
  ws.addRow(["DATA", "NÚMERO DO PEDIDO", "NOME DO CLIENTE", "VALOR PAGO",
             "CÓDIGO DE RASTREIO", "ONDE FOI FEITO O PEDIDO"]);
  for (const p of Object.values(PEDIDOS))
    ws.addRow(["2026-10-18", p.pedido, p.nome, p.valor, "", `shopee ${p.conta}`]);
  const planilha = join(dir, "pedidos.xlsx");
  await wb.xlsx.writeFile(planilha);

  // ── o que o coletor gravou de cada conta ──
  //
  // No formato CRU da Shopee, não num resumo nosso: é esse corpo que o
  // robô recebe de /api/v4/order/get_order_detail, e é dele que a
  // conciliação extrai nome, CEP, valor e rastreio. Inventar um formato
  // mais simples aqui testaria um caminho que não existe.
  const cru = ({ orderId, nome, valor, cep, codigos }) => ({
    orderId,
    bruto: { data: {
      info_card: { order_id: orderId, final_total: Math.round(valor * 100000),
        parcel_cards: [{ product_info: { item_groups: [{ items: [{ name: "Kit" }] }] },
                         shop_info: { shop_name: "Loja" } }] },
      address: { shipping_name: nome, shipping_phone: "11999999999",
                 shipping_address: `Rua A, 1, Curitiba, Paraná, ${cep}` },
      pc_shipping: {
        num_parcels: codigos.length || 1,
        forder_shipping_info_list: codigos.map((c) => ({
          tracking_number: c, fulfilment_carrier: { text: "Correios" } })),
      },
    } },
  });

  const gravar = (conta, pedidos) =>
    writeFileSync(join(dir, "captura", "coletas", `conta-${conta}.json`),
      JSON.stringify({ tipo: "coleta", conta, pedidos: pedidos.map(cru) }, null, 2));

  gravar(124, [
    // casa redondo: nome bate, tem código
    { orderId: "S-1", nome: "Sílvia Fictícia Mota", valor: 88.30,
      cep: "80000000", codigos: ["BR260000000005X"] },
    // o nome bate mas a Shopee ainda não despachou -> se resolve sozinho
    { orderId: "S-2", nome: "Otávio Fictício Reis", valor: 31.33,
      cep: "80000111", codigos: [] },
    // o #1003 NÃO está aqui: a planilha aponta a conta errada
  ]);

  gravar(128, [
    // o cliente do #1003, na conta que a planilha não indicou
    { orderId: "S-3", nome: "Lívia Fictícia Prado", valor: 57.65,
      cep: "80000222", codigos: ["BR260000000006X"] },
    // dois do mesmo cliente, mesmo valor: nada desempata
    { orderId: "S-4", nome: "Marta Fictícia Lins", valor: 13.00,
      cep: "13485020", codigos: ["BR260000000002X"] },
    { orderId: "S-5", nome: "Marta Fictícia Lins", valor: 13.00,
      cep: "13485020", codigos: ["BR260000000001X"] },
  ]);

  return { planilha };
}

/**
 * Uma Shopify e um AdsPower de mentira, respondendo no formato dos de
 * verdade. Os dois juntos porque trocamos o `fetch` global: deixar o
 * AdsPower de fora faria as chamadas dele caírem na resposta da Shopify.
 *
 * `escritas` registra o que a Shopify recebeu, para o teste poder afirmar
 * que saiu o código certo no pedido certo — e não só que "não deu erro".
 */
export function fingirShopify({ pedidos = {}, recusar = null, perfis = PERFIS } = {}) {
  const escritas = [];
  globalThis.fetch = async (url, opcoes) => {
    const endereco = String(url);

    if (endereco.includes("/api/v1/user/list")) {
      // Paginar de verdade: devolver a mesma lista em toda página faria o
      // robô ver cada conta trinta vezes e tratá-las como perfil duplicado
      // — que é o comportamento certo dele, e um teste errado nosso.
      const pagina = Number(new URL(endereco).searchParams.get("page") ?? 1);
      return resposta({ code: 0, msg: "success",
                        data: { list: pagina === 1 ? perfis : [] } });
    }
    if (endereco.includes("/api/v1/"))
      return resposta({ code: 0, msg: "success", data: {} });

    const corpo = JSON.parse(opcoes?.body ?? "{}");
    const q = corpo.query ?? "";

    if (/fulfillmentCreateV2|fulfillmentCreate/.test(q)) {
      if (recusar) return resposta({ data: { fulfillmentCreateV2: {
        fulfillment: null, userErrors: [{ message: recusar }] } } });
      // A mutação de verdade manda em $f, não em $fulfillment.
      const f = corpo.variables?.f ?? {};
      const fo = f.lineItemsByFulfillmentOrder?.[0]?.fulfillmentOrderId;
      const info = f.trackingInfo ?? {};
      const numeros = [].concat(info.numbers ?? info.number ?? []);
      escritas.push({ fulfillmentOrderId: fo, codigos: numeros });
      return resposta({ data: { fulfillmentCreateV2: {
        fulfillment: { id: "gid://shopify/Fulfillment/" + (escritas.length + 900),
                       status: "SUCCESS",
                       trackingInfo: numeros.map((n) => ({ number: n })) },
        userErrors: [] } } });
    }

    if (/shop\s*\{/.test(q))
      return resposta({ data: { shop: { name: "lojateste",
        myshopifyDomain: "lojateste.myshopify.com", email: "a@b.c", currencyCode: "BRL" } } });

    // busca de pedidos por número — mesma forma que src/shopify.mjs mapeia
    const alvo = corpo.variables?.q ?? "";
    const nodes = Object.entries(pedidos)
      .filter(([num]) => alvo.includes(num.replace("#", "")))
      .map(([num, p], i) => ({
        id: "gid://shopify/Order/" + (100 + i),
        name: num,
        createdAt: "2026-10-18T09:00:00Z",
        displayFulfillmentStatus: p.situacao ?? "UNFULFILLED",
        totalPriceSet: { shopMoney: { amount: String(p.valor ?? 0) } },
        shippingAddress: { name: p.nome, address1: "Rua A", city: "Curitiba",
                           province: "PR", zip: p.cep ?? "80000000" },
        lineItems: { nodes: [{ title: "Kit", quantity: 1 }] },
        fulfillmentOrders: { nodes: p.semEntrega ? []
          : [{ id: "gid://shopify/FulfillmentOrder/" + (200 + i), status: "OPEN" }] },
      }));
    return resposta({ data: { orders: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } });
  };
  return escritas;
}
const resposta = (json) => ({ ok: true, status: 200, json: async () => json });
