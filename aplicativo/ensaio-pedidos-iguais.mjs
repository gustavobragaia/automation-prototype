// Pedidos iguais do mesmo cliente na janela de verdade — Chomps, 22/10/2026.
// A planilha com a forma da "modelo-esteira_filtrado" (nomes de mentira), as
// compras no formato da Shopee, a ponte e a tela de verdade, a loja de
// mentira. Antes: etapa 4 com 0 pedidos. Agora: os pares saem para escrever.
//
//   npm run ensaio:iguais          (ESTEIRA_FOTO=<pasta> grava os prints)
import { app, BrowserWindow } from "electron";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "esteira-iguais-"));
mkdirSync(join(dir, "estado"), { recursive: true });
process.env.ESTADO_DIR = join(dir, "estado"); process.env.TRABALHO_DIR = dir;
process.env.RECURSOS_DIR = join(import.meta.dirname, "..");
process.env.SHOPIFY_CONEXAO_ARQUIVO = join(dir, "conexao.json");
process.env.REGISTRO_ESCRITAS = join(dir, "escritas.json");
writeFileSync(process.env.SHOPIFY_CONEXAO_ARQUIVO, JSON.stringify({ loja: "loja-teste.myshopify.com", modo: "token-fixo", accessToken: "x" }));
writeFileSync(join(dir, "estado", "ajustes.json"), JSON.stringify({ guiaConcluido: true }));
app.setPath("userData", join(dir, "dados-electron"));

// a planilha: a mesma forma da filtrada (pares iguais, um par diferente, 2+1, sozinhos)
const LINHAS = [
  [165552, "Willian Lange", 21.9, 217], [165553, "Willian Lange", 12.9, 217],
  [165569, "Georgia Matos", 23.99, 220], [165570, "Georgia Matos", 23.99, 220],
  [165600, "Arce Batista", 24.89, 224], [165601, "Arce Batista", 24.89, 224],
  [165626, "Leno Durval", 14.66, 228],
  [165669, "Gustavo Cavalcante", 13, 234], [165670, "Gustavo Cavalcante", 13, 234],
  [165682, "Guilherme Filho", 23.99, 236], [165683, "Guilherme Filho", 23.99, 236],
  [165716, "Geraldo Brasil", 23.99, 241], [165717, "Geraldo Brasil", 23.99, 241],
  [165730, "Nelson Cardoso", 23.99, 244], [165731, "Deocleciano Neto", 23.99, 244], [165732, "Deocleciano Neto", 23.99, 244],
  [165740, "Nilton Siqueira", 47.98, 245], [165741, "Nilton Siqueira", 23.99, 245],
];
let seq = 0;
const cod = () => `BR26${String(4800000000 + ++seq)}${"ABCDEFGHJK"[seq % 10]}`;
const T0 = Date.parse("2026-10-16T13:00:00Z") / 1000;
const det = (nome, valor, codigo, t) => ({ orderId: String(900000 - ++seq), bruto: { data: {
  address: { shipping_name: nome, shipping_address: "Rua Teste, 1, São Paulo, SP, 01000000" },
  info_card: { final_total: Math.round(valor * 100000) },
  pc_shipping: { forder_shipping_info_list: [{ tracking_number: codigo }] },
  pc_processing_info: { create_time: t } } } });
const compras = new Map(), esperado = new Map();
const add = (conta, d) => { if (!compras.has(conta)) compras.set(conta, []); compras.get(conta).push(d); };
const porCliente = new Map();
for (const [n, nome, v, c] of LINHAS) { const k = `${c}|${nome}`; if (!porCliente.has(k)) porCliente.set(k, []); porCliente.get(k).push([n, nome, v, c]); }
for (const ls of porCliente.values()) {
  const c = ls[0][3];
  if (ls.length === 2 && ls[0][2] === 2 * ls[1][2]) { for (let i = 0; i < 3; i++) add(c, det(ls[0][1], ls[1][2], cod(), T0 + i * 40)); continue; }
  const iguais = ls.length > 1 && ls.every((x) => x[2] === ls[0][2]);
  ls.forEach(([n, nome, v], i) => {
    const k = cod();
    if (iguais) esperado.set(`Pedido #${n}`, k);
    const rateio = ls.length === 1 ? 0 : (i === 0 ? -1 : 1) * (iguais ? 0.8 : 1.76);
    add(c, det(nome, v + rateio, k, T0 + i * 40));
  });
}
const nomeDe = new Map(LINHAS.map(([n, nome]) => [String(n), nome]));
const escritos = [];
globalThis.fetch = async (url, opcoes = {}) => {
  const corpo = JSON.parse(opcoes.body ?? "{}");
  if (/fulfillmentCreateV2/.test(corpo.query ?? "")) {
    const f = corpo.variables.f, t = f.trackingInfo, nums = t.numbers ?? [t.number];
    escritos.push([f.lineItemsByFulfillmentOrder[0].fulfillmentOrderId.match(/\d+$/)[0], nums]);
    return new Response(JSON.stringify({ data: { fulfillmentCreateV2: { userErrors: [], fulfillment: { id: "gid://F/" + escritos.length, status: "SUCCESS", trackingInfo: nums.map((n) => ({ number: n, url: "", company: t.company })) } } } }), { status: 200 });
  }
  const nums = [...String(corpo.variables?.q ?? "").matchAll(/name:(\d+)/g)].map((m) => m[1]);
  return new Response(JSON.stringify({ data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: nums.map((n) => ({
    name: "#" + n, id: "gid://O/" + n, displayFulfillmentStatus: "UNFULFILLED",
    shippingAddress: { name: nomeDe.get(n), zip: "01000000" }, totalPriceSet: { shopMoney: { amount: "1" } },
    lineItems: { nodes: [] }, fulfillmentOrders: { nodes: [{ id: "gid://FO/" + n, status: "OPEN" }] } })) } } }), { status: 200 });
};

await import("./principal.mjs");
const { default: ExcelJS } = await import("../src/excel.mjs");
const { DIR_COLETAS } = await import("../src/caminhos.mjs");
const { guardarPendentes } = await import("../src/estado.mjs");
mkdirSync(DIR_COLETAS, { recursive: true });
for (const [c, ps] of compras) writeFileSync(join(DIR_COLETAS, `conta-${c}.json`), JSON.stringify({ conta: String(c), listas: [{ ok: true }], pedidos: ps }));
const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("PEDIDOS");
ws.addRow(["DATA", "NÚMERO DO PEDIDO", "NOME DO CLIENTE", "VALOR PAGO", "CÓDIGO DE RASTREIO", "ONDE FOI FEITO O PEDIDO"]);
for (const [n, nome, v, c] of LINHAS) ws.addRow(["16/10", `Pedido #${n}`, nome, v, null, `shopee ${c}`]);
const planilha = join(dir, "filtrado.xlsx"); await wb.xlsx.writeFile(planilha);
// como está no app do Matheus: todos em "dois candidatos" desde 21/10
guardarPendentes(LINHAS.map(([n, nome, v, c]) => ({ pedido: `Pedido #${n}`, conta: c, nome, valor: v, motivo: { codigo: "ambiguo", grupo: "precisa" } })));

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const FOTO = process.env.ESTEIRA_FOTO;
let tudo = true;

app.whenReady().then(async () => {
  await espera(3500);
  const w = BrowserWindow.getAllWindows()[0];
  w.setSize(1280, 860);
  const js = (c) => w.webContents.executeJavaScript(c);
  const foto = async (nome) => { if (FOTO) { w.show(); w.focus(); w.webContents.invalidate(); await espera(800); await writeFile(join(FOTO, nome), (await w.webContents.capturePage()).toPNG()); } };
  await js(`window.esteira.pedir("planilha:ler", { caminho: ${JSON.stringify(planilha)} }).then(() => 1)`);

  console.log("\n\x1b[1mPedidos iguais do mesmo cliente, na janela\x1b[0m");
  await js(`document.querySelector('[data-etapa="3"]').click(); 1`);
  await espera(1500);
  const conf = await js(`[...document.querySelectorAll("#cxPrecisa .item[data-rev]")].map(i => i.dataset.pedido).join(", ")`);
  const nota = await js(`document.getElementById("confResolvidos").hidden ? "" : document.getElementById("confResolvidosTxt").innerText`);
  tudo &= ok(conf === "Pedido #165740, Pedido #165741", `na conferência ficam só os do pedido de 2 unidades + 1 (${conf})`);
  tudo &= ok(/16 pedidos que estavam aqui já foram resolvidos/.test(nota), `e diz que os outros foram resolvidos: "${nota.slice(0, 80)}…"`);
  await foto("5-conferencia-pares-resolvidos.png");

  await js(`document.querySelector('[data-etapa="4"]').click(); 1`);
  await espera(1800);
  await js(`document.getElementById("bVerTodos")?.click(); 1`);
  await espera(300);
  const etapa4 = await js(`[...document.querySelectorAll("#tbEscrita tr")].map(t => t.innerText.replace(/\\s+/g, " ")).join(" || ")`);
  const linhas4 = etapa4.split(" || ").filter((t) => /Pedido #/.test(t));
  tudo &= ok(linhas4.length === 16, `etapa 4: 16 pedidos para escrever (antes: 0) — ${linhas4.length}`);
  tudo &= ok((etapa4.match(/pedidos iguais do mesmo cliente/g) ?? []).length === esperado.size,
    `os ${esperado.size} dos pares vêm marcados "pedidos iguais do mesmo cliente · pela ordem da compra"`);
  await foto("6-etapa4-pares.png");

  await js(`document.getElementById("bEscrever").click(); 1`);
  for (let i = 0; i < 40 && escritos.length < 16; i++) await espera(250);
  await espera(800);
  tudo &= ok(escritos.length === 16, `escreveu os 16 na Shopify (${escritos.length})`);
  tudo &= ok([...esperado].every(([p, c]) => escritos.find(([n]) => `Pedido #${n}` === p)?.[1].join() === c),
    "cada par: o 1º pedido com a 1ª compra, o 2º com a 2ª — conferido no que chegou à Shopify");
  await foto("7-escrito.png");

  console.log(tudo ? "\n\x1b[32m\x1b[1m  pedidos iguais na janela: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  pedidos iguais na janela: FALHOU\x1b[0m\n");
  app.exit(tudo ? 0 : 1);
});
