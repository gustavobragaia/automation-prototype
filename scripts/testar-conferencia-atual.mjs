// A conferência não pode mostrar dúvida que já não existe — EDESIO, 0.1.8,
// 21/10/2026. A conferência mostra a CARTEIRA (o que ficou pendente da rodada
// anterior). Depois de atualizar para a 0.1.8, a conciliação já pareava o
// #165172 e o #165173 pelo total, mas os dois continuavam lá como "dois
// candidatos" e o Matheus achou que nada tinha mudado.
//
// Caminho inteiro de verdade: a carteira gravada, a planilha REAL dele
// (~/Downloads/modelo-esteira (6).xlsx, se existir; senão uma cópia mínima),
// uma coleta no formato da Shopee, e a ponte do app respondendo
// "conferencia:listar" e "escrita:listar" (esta com a loja de mentira).
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "esteira-confatual-"));
process.env.TRABALHO_DIR = dir; process.env.ESTADO_DIR = join(dir, "estado");
process.env.REGISTRO_ESCRITAS = join(dir, "escritas.json");
process.env.SHOPIFY_CONEXAO_ARQUIVO = join(dir, "conexao.json");
writeFileSync(process.env.SHOPIFY_CONEXAO_ARQUIVO, JSON.stringify({ loja: "t.myshopify.com", modo: "token-fixo", accessToken: "x" }));

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

const { separarJaResolvidos } = await import("../src/conciliar.mjs");

sec("1. O que sai da conferência e o que fica");
{
  const linhas = [
    { conta: 162, p: { pedido: "Pedido #165172" }, estado: "ok-total", codigo: "BR2620456593785" },
    { conta: 162, p: { pedido: "Pedido #165173" }, estado: "ok-total", codigo: "BR265742968962P" },
    { conta: 130, p: { pedido: "Pedido #1" }, estado: "ok", codigo: "BR1" },
    { conta: 130, p: { pedido: "Pedido #2" }, estado: "ambiguo", codigo: "" },
    { conta: 140, p: { pedido: "Pedido #3" }, estado: "ok", codigo: "BR3" },
  ];
  const carteira = [
    { pedido: "Pedido #165172", conta: 162, motivo: "ambiguo" },
    { pedido: "Pedido #165173", conta: 162, motivo: "ambiguo" },
    { pedido: "Pedido #1", conta: 130, motivo: "nome-nao-confere" },     // a Shopify barrou
    { pedido: "Pedido #2", conta: 130, motivo: "ambiguo" },               // continua em dúvida hoje
    { pedido: "Pedido #3", conta: 999, motivo: "nao-achado-na-conta" },   // a pessoa corrigiu a conta
  ];
  const { ficam, resolvidos } = separarJaResolvidos(carteira, linhas);
  tudo &= ok(resolvidos.map((r) => r.pedido).join() === "Pedido #165172,Pedido #165173",
    "os dois do EDESIO saem: a conciliação de agora já resolve");
  tudo &= ok(ficam.some((p) => p.pedido === "Pedido #1"), "o que a SHOPIFY barrou (nome que não confere) fica — a conciliação não vê a Shopify");
  tudo &= ok(ficam.some((p) => p.pedido === "Pedido #2"), "o que continua em dúvida hoje fica");
  tudo &= ok(ficam.some((p) => p.pedido === "Pedido #3"), "pedido de outra conta na carteira fica (não é a mesma resolução)");
}

sec("2. Caminho inteiro: carteira + planilha real + coleta + ponte do app");
{
  // a planilha: a real do Matheus se estiver aqui; senão as 3 linhas do EDESIO
  let planilha = join(homedir(), "Downloads", "modelo-esteira (6).xlsx");
  if (!existsSync(planilha)) {
    const { default: ExcelJS } = await import("../src/excel.mjs");
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("PEDIDOS");
    ws.addRow(["DATA", "NÚMERO DO PEDIDO", "NOME DO CLIENTE", "VALOR PAGO", "CÓDIGO DE RASTREIO", "ONDE FOI FEITO O PEDIDO"]);
    ws.addRow(["14/10", "Pedido #165172", "EDESIO LOPES DE CERQUEIRA", 36.56, null, "shopee 162"]);
    ws.addRow(["14/10", "Pedido #165172", "EDESIO LOPES DE CERQUEIRA", 36.56, null, "shopee 162"]);
    ws.addRow(["14/10", "Pedido #165173", "EDESIO LOPES DE CERQUEIRA", 12.9, null, "shopee 162"]);
    planilha = join(dir, "planilha.xlsx"); await wb.xlsx.writeFile(planilha);
  }
  // a coleta da conta 162, no formato que a Shopee devolve
  const { DIR_COLETAS } = await import("../src/caminhos.mjs");
  mkdirSync(DIR_COLETAS, { recursive: true });
  const detalhe = (id, valor, codigo) => ({ orderId: id, bruto: { data: {
    address: { shipping_name: "Edesio Lopes de Cerqueira", shipping_address: "Rua Teste, 1, São Paulo, SP, 08900000" },
    info_card: { order_id: id, final_total: Math.round(valor * 100000) },
    pc_shipping: { forder_shipping_info_list: [{ tracking_number: codigo }] } } } });
  writeFileSync(join(DIR_COLETAS, "conta-162.json"), JSON.stringify({ conta: "162", listas: [{ ok: true }],
    pedidos: [detalhe("1", 34.8, "BR2620456593785"), detalhe("2", 14.66, "BR265742968962P")] }));

  // a carteira como a rodada da 0.1.7 deixou: os dois como "dois candidatos"
  const { guardarPendentes } = await import("../src/estado.mjs");
  const motivo = { codigo: "ambiguo", grupo: "precisa" };
  guardarPendentes([{ pedido: "Pedido #165172", conta: 162, nome: "EDESIO LOPES DE CERQUEIRA", valor: 36.56, motivo },
                    { pedido: "Pedido #165173", conta: 162, nome: "EDESIO LOPES DE CERQUEIRA", valor: 12.9, motivo }]);

  // loja de mentira para a etapa 4 (só leitura aqui)
  globalThis.fetch = async (url, opcoes = {}) => {
    const corpo = JSON.parse(opcoes.body ?? "{}");
    const nums = [...String(corpo.variables?.q ?? "").matchAll(/name:(\d+)/g)].map((m) => m[1]);
    return new Response(JSON.stringify({ data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: nums.map((n) => ({
      name: "#" + n, id: "gid://O/" + n, displayFulfillmentStatus: "UNFULFILLED",
      shippingAddress: { name: n === "165172" || n === "165173" ? "EDESIO LOPES DE CERQUEIRA" : "Outro Cliente", zip: "08900000" },
      totalPriceSet: { shopMoney: { amount: "1" } }, lineItems: { nodes: [] },
      fulfillmentOrders: { nodes: [{ id: "gid://FO/" + n, status: "OPEN" }] } })) } } }), { status: 200 });
  };

  const { construir } = await import("../aplicativo/ponte.mjs");
  const ponte = construir({});
  const des = (r) => (r && "ok" in r && "dado" in r ? r.dado : r);
  await ponte["planilha:ler"]({ caminho: planilha });
  const conf = des(await ponte["conferencia:listar"]({}));
  const naConferencia = (conf.pendencias ?? []).map((i) => i.pedido);
  tudo &= ok(!naConferencia.includes("Pedido #165172") && !naConferencia.includes("Pedido #165173"),
    `o EDESIO não aparece mais em "Precisa de você" (${naConferencia.filter((p) => /16517[23]/.test(p)).join(", ") || "nenhum dos dois"})`);
  tudo &= ok((conf.resolvidosAgora ?? []).map((r) => r.pedido).sort().join() === "Pedido #165172,Pedido #165173",
    "e a conferência diz que eles já foram resolvidos e vão para a etapa 4");
  const esc = des(await ponte["escrita:listar"]({}));
  const ed = (esc.itens ?? []).filter((i) => /16517[23]/.test(i.pedido));
  tudo &= ok(ed.length === 2 && ed.find((i) => /165172/.test(i.pedido))?.codigos.join() === "BR2620456593785"
    && ed.find((i) => /165173/.test(i.pedido))?.codigos.join() === "BR265742968962P",
    "na etapa 4, cada um com o seu rastreio — e uma vez só, mesmo com o #165172 em 2 linhas");
}

console.log(tudo ? "\n\x1b[32m\x1b[1m  conferência atual: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  conferência atual: FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
