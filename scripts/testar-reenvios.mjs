// Reenvios — Chomps, 28/10/2026.
//
// O Matheus guarda os reenvios na aba "REENVIOS + CANCELADOS" (2ª aba do
// mesmo arquivo do Google Sheets): mesmo número de pedido, outra compra, em
// outra conta. Testando, o robô "não puxou nenhum": na Shopify o pedido já
// está atendido com o rastreio do envio original, e a etapa 4 conta como
// "já feito". Ele quer só o código novo, para colar na aba.
//
// Aqui: a ponte do app, um AdsPower de mentira, a loja de mentira contando
// toda chamada, e um arquivo com as duas abas. Nenhum nome de cliente real.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

const dir = mkdtempSync(join(tmpdir(), "esteira-reenvios-"));
process.env.TRABALHO_DIR = join(dir, "trabalho"); process.env.ESTADO_DIR = join(dir, "estado");
process.env.REGISTRO_ESCRITAS = join(dir, "escritas.json");
process.env.AJUSTES_ARQUIVO = join(dir, "ajustes.json");
process.env.SHOPIFY_CONEXAO_ARQUIVO = join(dir, "conexao.json");
writeFileSync(process.env.SHOPIFY_CONEXAO_ARQUIVO, JSON.stringify({ loja: "t.myshopify.com", modo: "token-fixo", accessToken: "x" }));
setTimeout(() => { console.log("  \x1b[31m✗ passou de 90 s\x1b[0m"); process.exit(1); }, 90_000).unref();

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

// ── AdsPower de mentira ──
const perfis = [247, 248, 300, 528, 529].map((n) => ({ user_id: `u${n}`, serial_number: String(n), name: `Shopee ${n}` }));
const ads = createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const p = Number(u.searchParams.get("page") ?? 1), t = Number(u.searchParams.get("page_size") ?? 100);
  res.end(JSON.stringify({ code: 0, msg: "ok", data: { list: perfis.slice((p - 1) * t, p * t) } }));
});
await new Promise((r) => ads.listen(0, "127.0.0.1", r));
process.env.ADSPOWER_BASE = `http://127.0.0.1:${ads.address().port}`;

// ── a loja de mentira: todo pedido já ATENDIDO (o rastreio do envio original) ──
let chamadasShopify = 0;
const fetchDeVerdade = globalThis.fetch;
globalThis.fetch = async (url, opcoes = {}) => {
  if (!String(url).includes("myshopify")) return fetchDeVerdade(url, opcoes);   // o AdsPower de mentira
  chamadasShopify++;
  const corpo = JSON.parse(opcoes.body ?? "{}");
  const nums = [...String(corpo.variables?.q ?? "").matchAll(/name:(\d+)/g)].map((m) => m[1]);
  return new Response(JSON.stringify({ data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: nums.map((n) => ({
    name: "#" + n, id: "gid://O/" + n, displayFulfillmentStatus: "FULFILLED",
    shippingAddress: { name: nomeDe.get(n) ?? "", zip: "01000000" }, totalPriceSet: { shopMoney: { amount: "1" } },
    lineItems: { nodes: [] }, fulfillmentOrders: { nodes: [{ id: "gid://FO/" + n, status: "CLOSED" }] } })) } } }), { status: 200 });
};
const nomeDe = new Map();

// ── o arquivo do Google Sheets: aba do dia + aba de reenvios ──
const { default: ExcelJS } = await import("../src/excel.mjs");
const ano = new Date().getFullYear();
async function arquivo(caminho, { reenviosPreenchidos = {} } = {}) {
  const wb = new ExcelJS.Workbook();
  const dia = wb.addWorksheet("ESPARTA");
  // sem cabeçalho, como a planilha dele: A data, B pedido, C nome, D produto,
  // E unidades, F valor, G rastreio, H conta
  dia.addRow(["27/10", "170001", "Cliente Dia Um", "Tábua", 1, 27, null, "Shopee 300"]);
  dia.addRow(["27/10", "170002", "Cliente Dia Dois", "Faca", 1, 19.99, null, "Shopee 528"]);
  const re = wb.addWorksheet("REENVIOS + CANCELADOS");
  const L = (data, pedido, nome, valor, conta) =>
    re.addRow([data, pedido, nome, "Produto", 1, valor, reenviosPreenchidos[pedido] ?? null, conta]);
  L("16/10", "161770", "Cliente Reenvio A", 42.78, "Shopee 248");    // achado
  L("20/10", "162228", "Cliente Reenvio B", 57.34, "Shopee 529");    // original tem que ser recusado
  L("21/10", "164017", "Cliente Reenvio C", 60, "Shopee 529");       // duas compras iguais: dúvida
  L("22/10", "163454", "Cliente Reenvio D", 61, "Shopee 529");       // ainda sem rastreio
  L("20/10", "164159", "Cliente Reenvio E", 29.99, "");              // falta a conta
  L("17/10", "162174", "Cliente Reenvio F", 27, "Shopee 247");       // nenhuma compra
  await wb.xlsx.writeFile(caminho);
}
for (const [n, nome] of [["161770", "Cliente Reenvio A"], ["162228", "Cliente Reenvio B"], ["164017", "Cliente Reenvio C"],
                         ["163454", "Cliente Reenvio D"], ["170001", "Cliente Dia Um"], ["170002", "Cliente Dia Dois"]]) nomeDe.set(n, nome);

// ── as compras na Shopee, no formato de get_order_detail ──
const t = (iso) => Date.parse(iso) / 1000;
const compra = (id, nome, valor, codigo, criadoEm) => ({ orderId: String(id), bruto: { data: {
  address: { shipping_name: nome, shipping_address: "Rua Teste, 1, São Paulo, SP, 01000000" },
  info_card: { order_id: String(id), final_total: Math.round(valor * 100000) },
  pc_shipping: { forder_shipping_info_list: codigo ? [{ tracking_number: codigo }] : [] },
  pc_processing_info: { create_time: criadoEm } } } });
const { DIR_COLETAS } = await import("../src/caminhos.mjs");
const coleta = (conta, pedidos) => {
  mkdirSync(DIR_COLETAS, { recursive: true });
  writeFileSync(join(DIR_COLETAS, `conta-${conta}.json`), JSON.stringify({ conta: String(conta), listas: [{ ok: true }], pedidos }));
};
const NOVO_A = "BR2600000000001A", ORIGINAL_B = "BR2600000000002B", NOVO_B = "BR2600000000003C";
const C1 = "BR2600000000004D", C2 = "BR2600000000005E", VELHO_A = "BR2600000000006F";
function coletasDaRodada() {
  coleta(248, [
    compra(9001, "Cliente Reenvio A", 42.78, NOVO_A, t(`${ano}-10-17T12:00:00Z`)),
    // compra do mesmo cliente ANTES da data do reenvio: é outra entrega
    compra(9002, "Cliente Reenvio A", 42.78, VELHO_A, t(`${ano}-10-02T12:00:00Z`)),
  ]);
  coleta(529, [
    // o envio original (o robô escreveu este código na Shopify) e o reenvio
    compra(9101, "Cliente Reenvio B", 57.34, ORIGINAL_B, t(`${ano}-10-21T12:00:00Z`)),
    compra(9102, "Cliente Reenvio B", 57.34, NOVO_B, t(`${ano}-10-22T12:00:00Z`)),
    compra(9103, "Cliente Reenvio C", 60, C1, t(`${ano}-10-21T12:00:00Z`)),
    compra(9104, "Cliente Reenvio C", 60, C2, t(`${ano}-10-21T13:00:00Z`)),
    compra(9105, "Cliente Reenvio D", 61, null, t(`${ano}-10-23T12:00:00Z`)),
  ]);
  coleta(247, []);
  coleta(300, [compra(9201, "Cliente Dia Um", 27, "BR2600000000007G", t(`${ano}-10-27T12:00:00Z`))]);
  coleta(528, [compra(9301, "Cliente Dia Dois", 19.99, "BR2600000000008H", t(`${ano}-10-27T12:00:00Z`))]);
}
// o pedido original do B foi escrito pelo robô, com o código original
writeFileSync(process.env.REGISTRO_ESCRITAS, JSON.stringify({ "162228": { fulfillmentId: "gid://F/1", pedido: "#162228", conta: 300, codigos: [ORIGINAL_B] } }));

const { construir } = await import("../aplicativo/ponte.mjs");
let copiado = null;
const ponte = construir({ aoLog: () => {}, copiar: (x) => { copiado = x; } });
const des = async (p) => { const r = await p; if (r && r.ok === false) throw new Error(r.erro); return r && "ok" in r && "dado" in r ? r.dado : r; };
const DOWNLOADS = join(dir, "Downloads"); mkdirSync(DOWNLOADS);
const planilha = join(DOWNLOADS, "PEDIDOS SHOPEE.xlsx");
await arquivo(planilha);
coletasDaRodada();

sec("1. O que acontecia: o reenvio pela rota normal some");
{
  // a aba de reenvio lida como se fosse a do dia; o cliente A com só a
  // compra do reenvio na conta, para o pedido chegar até a Shopify
  coleta(248, [compra(9001, "Cliente Reenvio A", 42.78, NOVO_A, t(`${ano}-10-17T12:00:00Z`))]);
  const lido = await des(ponte["planilha:ler"]({ caminho: planilha, aba: "REENVIOS + CANCELADOS" }));
  const e = await des(ponte["escrita:listar"]({}));
  tudo &= ok(lido.pendentes === 5 && e.itens.length === 0 && e.pulados > 0,
    `5 reenvios na planilha, ${e.itens.length} na etapa 4, ${e.pulados} "pulado(s) — já feito(s)": o código ${NOVO_A} foi colhido e jogado fora`);
  await des(ponte["planilha:esquecer"]({}));
  coletasDaRodada();
}

sec("2. O arquivo inteiro do Google Sheets: a etapa 1 oferece a aba de reenvios");
let contasRodada;
{
  const { contaDoPedido, anotarMapeamento } = await import("../src/estado.mjs");
  const { pendentesAbertos } = await import("../src/estado.mjs");
  anotarMapeamento("#162228", 300, "planilha");   // o original foi comprado na 300
  const carteiraAntes = JSON.stringify(pendentesAbertos());

  const copiasAntes = readdirSync(join(dir, "trabalho", "planilhas")).length;
  const r = await des(ponte["planilha:ler"]({ caminho: planilha }));
  tudo &= ok(r.aba === "ESPARTA" && r.abaReenvio === "REENVIOS + CANCELADOS",
    `lida a aba "${r.aba}"; sugerida para reenvios: "${r.abaReenvio}"`);
  const abas = await des(ponte["planilha:abas"]({ caminho: planilha }));
  tudo &= ok(abas.sugerida === "REENVIOS + CANCELADOS" && abas.abas.length === 2, "escolhendo pelo botão de reenvios, a aba certa vem sozinha");
  const re = await des(ponte["reenvios:escolher"]({ caminho: planilha, aba: abas.sugerida }));
  tudo &= ok(re.pendentes === 5 && re.semConta === 1 && re.contas.sort().join() === "247,248,529",
    `aba de reenvios: ${re.pendentes} para buscar em ${re.contas.join(", ")} · ${re.semConta} sem conta`);
  const novas = readdirSync(join(dir, "trabalho", "planilhas")).length - copiasAntes;
  tudo &= ok(novas === 2, `o mesmo arquivo nas duas listas: 2 cópias, uma não troca a outra (${novas})`);

  contasRodada = await des(ponte["rodada:contas"]([]));
  const ns = contasRodada.map((c) => c.conta).sort((a, b) => a - b);
  tudo &= ok(ns.join() === "247,248,300,528,529", `uma fila só, cada conta uma vez: ${ns.join(", ")}`);
  tudo &= ok(contaDoPedido("#162228")?.conta === 300 && contaDoPedido("162228") == null,
    "o mapeamento pedido→conta do original continua na conta 300 (o reenvio não anota)");

  const e = await des(ponte["escrita:listar"]({}));
  tudo &= ok(e.itens.every((i) => /^17000/.test(String(i.pedido).replace(/\D/g, ""))) && e.itens.length === 0,
    `a etapa 4 do dia não vê os reenvios (${e.itens.length} itens; a loja de mentira tem tudo atendido)`);
  const conf = await des(ponte["conferencia:listar"]({}));
  const todos = [...conf.pendencias, ...conf.sozinhos].map((x) => x.pedido);
  tudo &= ok(!todos.some((p) => /16177|162228|164017|163454/.test(p)), "nenhum reenvio na conferência");
  tudo &= ok(JSON.stringify(pendentesAbertos()) === carteiraAntes, "a carteira de pendentes não mudou");
}

sec("3. O resultado dos reenvios, sem a Shopify");
let itens;
{
  chamadasShopify = 0;
  const r = await des(ponte["reenvios:listar"]({}));
  itens = r.itens;
  const de = (p) => itens.find((i) => i.pedido === p);
  tudo &= ok(chamadasShopify === 0, `nenhuma chamada à Shopify (${chamadasShopify})`);
  tudo &= ok(de("161770")?.estado === "achado" && de("161770").codigos.join() === NOVO_A,
    `#161770: ${de("161770")?.codigos} (a compra de 02/10, antes da data do reenvio, ficou de fora)`);
  tudo &= ok(de("162228")?.estado === "achado" && de("162228").codigos.join() === NOVO_B,
    `#162228: ${de("162228")?.codigos} — o código do envio original nunca volta`);
  tudo &= ok(de("164017")?.estado === "duvida" && de("164017").candidatos.length === 2,
    "#164017: duas compras iguais do cliente na conta → mostra as duas, não chuta");
  tudo &= ok(de("163454")?.estado === "sem-rastreio-ainda", "#163454: a compra existe, a Shopee ainda não despachou");
  tudo &= ok(de("164159")?.estado === "falta-conta", "#164159: linha sem conta aparece (antes sumia em silêncio)");
  tudo &= ok(de("162174")?.estado === "nao-achado", "#162174: conta lida, nenhuma compra do cliente");
  tudo &= ok(itens.map((i) => i.linha).join() === [...itens.map((i) => i.linha)].sort((a, b) => a - b).join(),
    "na ordem das linhas da aba");
}

sec("4. Copiar");
{
  await des(ponte["reenvios:copiar"]({ texto: NOVO_A }));
  tudo &= ok(copiado === NOVO_A, "um código");
  const r = await des(ponte["reenvios:copiar"]({ todos: true }));
  const linhas = copiado.split("\n");
  tudo &= ok(r.linhas === 2 && linhas[0] === `161770\tCliente Reenvio A\t${NOVO_A}` && linhas[1].endsWith(NOVO_B),
    `todos: ${r.linhas} linha(s), pedido · cliente · código`);
}

sec("5. O achado não se perde");
{
  // a conta 248 abre de novo amanhã por outro motivo, e a coleta nova não traz a compra
  coleta(248, []);
  const r = await des(ponte["reenvios:listar"]({}));
  const a = r.itens.find((i) => i.pedido === "161770");
  tudo &= ok(a?.estado === "achado" && a.codigos.join() === NOVO_A && Boolean(a.deAntes), "coleta nova sem a compra: o código achado antes continua");
  // o app fechou: sem aba escolhida, a lista vem do que foi guardado
  const outra = construir({ aoLog: () => {} });
  const g = await des(outra["reenvios:listar"]({}));
  tudo &= ok(!g.daSessao && g.itens.length === 2, `app reaberto: ${g.itens.length} reenvio(s) guardado(s)`);
  // ele colou o código na aba e escolheu de novo: a linha sai
  coletasDaRodada();
  await arquivo(planilha, { reenviosPreenchidos: { "161770": NOVO_A } });
  await des(ponte["reenvios:escolher"]({ caminho: planilha, aba: "REENVIOS + CANCELADOS" }));
  const depois = await des(ponte["reenvios:listar"]({}));
  tudo &= ok(!depois.itens.some((i) => i.pedido === "161770") && depois.itens.length === 5,
    "colado na aba: a linha sai da lista");
}

sec("6. Rodada só de reenvios");
{
  const { rodarCiclo } = await import("../src/ciclo.mjs");
  const { lerAlertas } = await import("../src/alertas.mjs");
  chamadasShopify = 0;
  await rodarCiclo({ contas: [], escrever: false, planilhas: [], soReenvios: true });
  tudo &= ok(!lerAlertas().some((a) => a.id === "rodada-sem-cruzar") && chamadasShopify === 0,
    "sem planilha do dia: não acusa \"não conseguiu cruzar\" e não chama a Shopify");
  const so = construir({ aoLog: () => {} });
  await des(so["reenvios:escolher"]({ caminho: planilha, aba: "REENVIOS + CANCELADOS" }));
  const c = await des(so["rodada:contas"]([]));
  // a 248 saiu: a linha dela foi colada na seção 5
  tudo &= ok(c.map((x) => x.conta).sort().join() === "247,529", `só a aba de reenvios: a rodada abre só as contas com reenvio a buscar (${c.map((x) => x.conta).sort().join()})`);
  await des(so["planilha:esquecer"]({}));
  const vazio = await so["rodada:contas"]([]);
  tudo &= ok(vazio.ok === false || /nenhuma planilha/.test(vazio?.erro ?? ""), "\"próxima rodada\" esquece os reenvios junto");
}

sec("7. A mesma compra não serve a dois reenvios");
{
  const { apurarReenvios } = await import("../src/reenvios.mjs");
  const { extrairPedido } = await import("../src/shopee.mjs");
  const uma = compra(9901, "Cliente Duas Vezes", 30, "BR2600000000009J", t(`${ano}-10-21T12:00:00Z`));
  const coletas = new Map([[530, [extrairPedido(uma.bruto, { orderId: uma.orderId })]]]);
  const linha = (n, pedido) => ({ linha: n, pedido, nome: "Cliente Duas Vezes", conta: 530, data: `${ano}-10-20`, valor: 30 });
  const r = apurarReenvios({ pendentes: [linha(10, "171001"), linha(11, "171002")], coletas });
  tudo &= ok(r.every((i) => i.estado === "duvida" && !i.codigos.length),
    "dois reenvios do mesmo cliente, uma compra: os dois ficam em dúvida, o código não vai colado duas vezes");
}

ads.close();
console.log(tudo ? "\n\x1b[32m\x1b[1m  reenvios: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  reenvios: FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
