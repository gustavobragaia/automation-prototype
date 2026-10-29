// Rastreio repetido na conferência e a etapa 4 — Chomps, 29/10/2026.
// Janela de verdade, ponte de verdade; só a loja é de mentira (conta as
// escritas). O "Usar este" com um rastreio que já foi para outro pedido
// para e pergunta; "Escrever mesmo assim" escreve; a etapa 4 lista o que a
// conferência escreveu, com o par repetido marcado.
//
//   npm run ensaio:repetido          (ESTEIRA_FOTO=<pasta> grava os prints)
import { app, BrowserWindow, ipcMain } from "electron";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "esteira-repetido-"));
mkdirSync(join(dir, "estado"), { recursive: true });
process.env.ESTADO_DIR = join(dir, "estado"); process.env.TRABALHO_DIR = dir;
process.env.RECURSOS_DIR = join(import.meta.dirname, "..");
process.env.SHOPIFY_CONEXAO_ARQUIVO = join(dir, "conexao.json");
process.env.REGISTRO_ESCRITAS = join(dir, "escritas.json");
writeFileSync(process.env.SHOPIFY_CONEXAO_ARQUIVO, JSON.stringify({ loja: "loja-teste.myshopify.com", modo: "token-fixo", accessToken: "x" }));
writeFileSync(join(dir, "estado", "ajustes.json"), JSON.stringify({ guiaConcluido: true }));
app.setPath("userData", join(dir, "dados-electron"));

const X = "BR2600000000011", Y = "BR260000000002Y", W = "BR260000000004W";
writeFileSync(process.env.REGISTRO_ESCRITAS, JSON.stringify({
  "170420": { fulfillmentId: "gid://F/a", pedido: "#170420", codigos: [X], em: new Date().toISOString(), origem: "manual" } }));

let mutacoes = 0;
globalThis.fetch = ((orig) => async (url, opcoes = {}) => {
  if (!String(url).includes("myshopify")) return orig(url, opcoes);
  const corpo = JSON.parse(opcoes.body ?? "{}");
  const resp = (data) => new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
  if (/fulfillmentCreateV2/.test(corpo.query)) {
    mutacoes++;
    const t = corpo.variables.f.trackingInfo, nums = t.numbers ?? [t.number];
    return resp({ fulfillmentCreateV2: { userErrors: [], fulfillment: { id: "gid://F/" + mutacoes, status: "SUCCESS",
      trackingInfo: nums.map((n) => ({ number: n, url: "", company: "Shopee Xpress" })) } } });
  }
  const nums = [...String(corpo.variables?.q ?? "").matchAll(/name:(\d+)/g)].map((m) => m[1]);
  return resp({ orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: nums.map((n) => ({
    name: "#" + n, id: "gid://O/" + n, createdAt: "2026-10-28T10:00:00Z", displayFulfillmentStatus: "UNFULFILLED",
    shippingAddress: { name: "Rosana Prado", zip: "01000000" }, totalPriceSet: { shopMoney: { amount: "1" } },
    lineItems: { nodes: [] }, fulfillmentOrders: { nodes: [{ id: "gid://FO/" + n, status: "OPEN" }] } })) } });
})(globalThis.fetch);

await import("./principal.mjs");
const { default: ExcelJS } = await import("../src/excel.mjs");
const planilha = join(dir, "PEDIDOS SHOPEE.xlsx");
{
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("ESPARTA").addRow(["29/10", "170422", "Rosana Prado", "Tábua Inox", 1, 27, null, "Shopee 300"]);
  await wb.xlsx.writeFile(planilha);
}

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const FOTO = process.env.ESTEIRA_FOTO;
let tudo = true;
process.on("unhandledRejection", (e) => { console.log("  \x1b[31m✗ quebrou: " + (e?.message ?? e) + "\x1b[0m"); app.exit(1); });
setTimeout(() => { console.log("  \x1b[31m✗ passou de 120 s\x1b[0m"); app.exit(1); }, 120_000).unref?.();

const amb = (pedido, nome, cands) => ({ pedido, conta: 300, nome, dias: 1,
  motivo: { codigo: "ambiguo", grupo: "precisa", rotulo: "dois candidatos", texto: "Duas compras parecidas.", acao: "Escolha uma." },
  candidatos: cands.map((c) => ({ codigos: [c], valor: 27, cep: "01000000" })) });

app.whenReady().then(async () => {
  await espera(3500);
  ipcMain.removeHandler("escolher-planilha");
  ipcMain.handle("escolher-planilha", () => [planilha]);
  const w = BrowserWindow.getAllWindows()[0];
  w.setSize(1280, 900);
  if (process.env.DEPURAR) w.webContents.on("console-message", (e, nivel, msg, linha) => console.log("[tela]", msg ?? e.message, linha ?? e.lineNumber));
  const js = (c) => w.webContents.executeJavaScript(c);
  const foto = async (nome) => { if (FOTO) { w.show(); w.focus(); w.webContents.invalidate(); await espera(800); await writeFile(join(FOTO, nome), (await w.webContents.capturePage()).toPNG()); } };
  const item = (p) => `document.querySelector('#cxPrecisa .item[data-pedido="${p}"]')`;

  console.log("\n\x1b[1mRastreio repetido na conferência\x1b[0m");
  await js(`document.querySelector('[data-etapa="1"]').click(); document.getElementById("solta").click(); 1`);
  await espera(2000);
  // abrir a etapa 3 recarrega a conferência de verdade (vazia aqui): antes
  await js(`document.querySelector('[data-etapa="3"]').click(); 1`);
  await espera(2500);
  await js(`window.TELA.conferencia({ pendencias: ${JSON.stringify([amb("Pedido #170422", "Rosana Prado", [X, Y])])}, sozinhos: [] }); 1`);
  await espera(500);
  if (process.env.DEPURAR) console.log(await js(`[...document.querySelectorAll("#cxPrecisa .item")].map(i => i.dataset.pedido + " | " + [...i.querySelectorAll("[data-usar-codigo]")].map(b => b.dataset.usarCodigo).join(",")).join("\\n")`));

  // "Usar este" no rastreio que já foi para o #170420
  await js(`[...${item("Pedido #170422")}.querySelectorAll("[data-usar-codigo]")].find(b => b.dataset.usarCodigo === "${X}").click(); 1`);
  await espera(1500);
  const aviso = await js(`(${item("Pedido #170422")}?.querySelector(".repetido")?.innerText ?? "")`);
  tudo &= ok(/já foi escrito em outro pedido/.test(aviso) && aviso.includes("#170420"), `para e pergunta: "${aviso.replace(/\s+/g, " ").slice(0, 120)}…"`);
  tudo &= ok(mutacoes === 0, "nada escrito na Shopify ainda");
  tudo &= ok(await js(`!${item("Pedido #170422")}.querySelector("[data-usar-codigo]").disabled`), "o pedido continua na conferência, com os botões soltos");
  await js(`${item("Pedido #170422")}.scrollIntoView({ block: "center" }); 1`);
  await foto("15-repetido-pergunta.png");

  await js(`${item("Pedido #170422")}.querySelector("[data-repetido-nao]").click(); 1`);
  await espera(300);
  tudo &= ok(await js(`!${item("Pedido #170422")}.querySelector(".repetido")`), "\"Cancelar\" tira o aviso e não escreve");

  await js(`[...${item("Pedido #170422")}.querySelectorAll("[data-usar-codigo]")].find(b => b.dataset.usarCodigo === "${X}").click(); 1`);
  await espera(1500);
  await js(`${item("Pedido #170422")}.querySelector("[data-repetido-sim]").click(); 1`);
  await espera(1500);
  tudo &= ok(mutacoes === 1, "\"Escrever mesmo assim\" escreve, uma vez");
  tudo &= ok(await js(`!${item("Pedido #170422")}`), "e o pedido sai da conferência");
  const trat = await js(`document.getElementById("listaTratados").innerText`);
  tudo &= ok(/mesmo rastreio de #170420/.test(trat), "\"Já tratados\" diz que foi com o mesmo rastreio de outro pedido");

  // "Colei o rastreio": o aviso aparece no quadro de conferir, antes de escrever
  await js(`window.TELA.conferencia({ pendencias: ${JSON.stringify([amb("Pedido #170423", "Rosana Prado", [W, Y])])}, sozinhos: [] }); 1`);
  await espera(400);
  const r = await js(`window.GANCHOS.conferirColado("Pedido #170423", "${X}")`);
  tudo &= ok(r.ok && r.repetidos?.length === 2, `"Colei o rastreio" sabe que o código já está em 2 pedidos (${(r.repetidos ?? []).map((x) => x.pedido).join(", ")})`);

  // a etapa 4
  await js(`document.querySelector('[data-etapa="4"]').click(); 1`);
  await espera(2000);
  await js(`document.getElementById("blConf4").scrollIntoView({ block: "center" }); 1`);
  const t4 = await js(`document.getElementById("blConf4").hidden ? "" : document.getElementById("tbConf4").innerText`);
  tudo &= ok(t4.includes("#170422") && t4.includes("#170420") && t4.includes(X), "etapa 4: \"Já escritos na conferência\" com os dois pedidos");
  tudo &= ok((t4.match(/mesmo rastreio do/g) ?? []).length === 2, "o par com o mesmo rastreio aparece marcado");
  await foto("16-etapa4-conferencia.png");
  const avisos = await js(`[...document.querySelectorAll(".erro-item")].map(e => e.innerText).join(" | ")`);
  tudo &= ok(!avisos, `sem erro na tela${avisos ? " (" + avisos + ")" : ""}`);

  console.log(tudo ? "\n\x1b[32m\x1b[1m  rastreio repetido na janela: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  rastreio repetido na janela: FALHOU\x1b[0m\n");
  app.exit(tudo ? 0 : 1);
});
