// Reenvios na janela de verdade — Chomps, 28/10/2026.
// O arquivo inteiro do Google Sheets (aba do dia + "REENVIOS + CANCELADOS"),
// escolhido pela janela do sistema. A etapa 1 oferece a aba de reenvios, a
// etapa 4 mostra o rastreio novo e "Copiar" põe na área de transferência.
// Nomes de mentira; a loja de mentira conta chamadas (tem que ficar em 0
// para os reenvios).
//
//   npm run ensaio:reenvios          (ESTEIRA_FOTO=<pasta> grava os prints)
import { app, BrowserWindow, ipcMain, clipboard } from "electron";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

const dir = mkdtempSync(join(tmpdir(), "esteira-reenvios-"));
mkdirSync(join(dir, "estado"), { recursive: true });
process.env.ESTADO_DIR = join(dir, "estado"); process.env.TRABALHO_DIR = dir;
process.env.RECURSOS_DIR = join(import.meta.dirname, "..");
process.env.SHOPIFY_CONEXAO_ARQUIVO = join(dir, "conexao.json");
process.env.REGISTRO_ESCRITAS = join(dir, "escritas.json");
writeFileSync(process.env.SHOPIFY_CONEXAO_ARQUIVO, JSON.stringify({ loja: "loja-teste.myshopify.com", modo: "token-fixo", accessToken: "x" }));
writeFileSync(join(dir, "estado", "ajustes.json"), JSON.stringify({ guiaConcluido: true }));
app.setPath("userData", join(dir, "dados-electron"));

const ano = new Date().getFullYear();
const t = (iso) => Date.parse(iso) / 1000;
const compra = (id, nome, valor, codigo, criadoEm) => ({ orderId: String(id), bruto: { data: {
  address: { shipping_name: nome, shipping_address: "Rua Teste, 1, São Paulo, SP, 01000000" },
  info_card: { final_total: Math.round(valor * 100000) },
  pc_shipping: { forder_shipping_info_list: codigo ? [{ tracking_number: codigo }] : [] },
  pc_processing_info: { create_time: criadoEm } } } });
const NOVO_A = "BR2647100000001A", NOVO_B = "BR2647100000002B", ORIGINAL_B = "BR2647100000003C";
writeFileSync(process.env.REGISTRO_ESCRITAS, JSON.stringify({ "162228": { fulfillmentId: "gid://F/1", codigos: [ORIGINAL_B] } }));

let chamadasShopify = 0;
globalThis.fetch = ((orig) => async (url, opcoes) => {
  if (!String(url).includes("myshopify")) return orig(url, opcoes);
  chamadasShopify++;
  return new Response(JSON.stringify({ data: { orders: { pageInfo: { hasNextPage: false }, nodes: [] } } }), { status: 200 });
})(globalThis.fetch);

// AdsPower de mentira: os perfis existem, abrir não abre
const perfis = [248, 300, 301, 529, 700].map((n) => ({ user_id: `u${n}`, serial_number: String(n), name: `Shopee ${n}` }));
const ads = createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.endsWith("/user/list")) {
    const p = Number(u.searchParams.get("page") ?? 1), t = Number(u.searchParams.get("page_size") ?? 100);
    return res.end(JSON.stringify({ code: 0, msg: "ok", data: { list: perfis.slice((p - 1) * t, p * t) } }));
  }
  res.end(JSON.stringify({ code: -1, msg: "perfil de teste: não abre" }));
});
await new Promise((r) => ads.listen(0, "127.0.0.1", r));
process.env.ADSPOWER_BASE = `http://127.0.0.1:${ads.address().port}`;

await import("./principal.mjs");
const { default: ExcelJS } = await import("../src/excel.mjs");
const { DIR_COLETAS } = await import("../src/caminhos.mjs");
const { emitir } = await import("../src/eventos.mjs");

const planilha = join(dir, "PEDIDOS SHOPEE.xlsx");
{
  const wb = new ExcelJS.Workbook();
  const dia = wb.addWorksheet("ESPARTA");
  dia.addRow(["27/10", "170001", "Rosana Prado", "Tábua Inox - Médio", 1, 27, null, "Shopee 300"]);
  dia.addRow(["27/10", "170002", "Otávio Leme", "Swifty Sharp", 1, 19.99, null, "Shopee 301"]);
  const re = wb.addWorksheet("REENVIOS + CANCELADOS");
  re.addRow(["16/10", "161770", "Lauro Teixeira", "Canivete G10", 1, 42.78, null, "Shopee 248"]);
  re.addRow(["20/10", "162228", "Marina Couto", "Rede de Sombreamento", 1, 57.34, null, "Shopee 529"]);
  re.addRow(["22/10", "163454", "Abel Ramos", "Rede de Sombreamento", 1, 61, null, "Shopee 529"]);
  re.addRow(["20/10", "164159", "Iara Nunes", "Tábua Inox - Grande", 1, 29.99, null, ""]);
  await wb.xlsx.writeFile(planilha);
}
// o que a rodada colheu (aqui escrito direto: o AdsPower não existe no ensaio)
mkdirSync(DIR_COLETAS, { recursive: true });
const coleta = (conta, pedidos) => writeFileSync(join(DIR_COLETAS, `conta-${conta}.json`),
  JSON.stringify({ conta: String(conta), listas: [{ ok: true }], pedidos }));
coleta(248, [compra(1, "Lauro Teixeira", 42.78, NOVO_A, t(`${ano}-10-17T12:00:00Z`))]);
coleta(529, [compra(2, "Marina Couto", 57.34, ORIGINAL_B, t(`${ano}-10-21T12:00:00Z`)),
             compra(3, "Marina Couto", 57.34, NOVO_B, t(`${ano}-10-22T12:00:00Z`)),
             compra(4, "Abel Ramos", 61, null, t(`${ano}-10-23T12:00:00Z`))]);

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const FOTO = process.env.ESTEIRA_FOTO;
let tudo = true;
process.on("unhandledRejection", (e) => { console.log("  \x1b[31m✗ quebrou: " + (e?.message ?? e) + "\x1b[0m"); app.exit(1); });
setTimeout(() => { console.log("  \x1b[31m✗ passou de 120 s\x1b[0m"); app.exit(1); }, 120_000).unref?.();

app.whenReady().then(async () => {
  await espera(3500);
  // a janela do sistema de escolher arquivo devolve a planilha
  ipcMain.removeHandler("escolher-planilha");
  ipcMain.handle("escolher-planilha", () => [planilha]);
  const w = BrowserWindow.getAllWindows()[0];
  w.setSize(1280, 900);
  const js = (c) => w.webContents.executeJavaScript(c);
  const foto = async (nome) => { if (FOTO) { w.show(); w.focus(); w.webContents.invalidate(); await espera(800); await writeFile(join(FOTO, nome), (await w.webContents.capturePage()).toPNG()); } };
  await js(`window.__avisos = []; { const a = window.TELA.avisar; window.TELA.avisar = (t, c) => { window.__avisos.push(t + " — " + c); }; } 1`);

  console.log("\n\x1b[1mReenvios na janela\x1b[0m");
  await js(`document.querySelector('[data-etapa="1"]').click(); document.getElementById("solta").click(); 1`);
  await espera(2500);
  const sug = await js(`{ const s = document.getElementById("reSugere"); s.hidden ? "" : s.innerText; }`);
  tudo &= ok(/REENVIOS \+ CANCELADOS/.test(sug), `etapa 1, arquivo inteiro: "${sug.replace(/\s+/g, " ").trim()}"`);
  await js(`document.getElementById("blReenvio").scrollIntoView({ block: "center" }); 1`);
  await foto("12-reenvios-sugestao.png");

  await js(`document.getElementById("bReSug").click(); 1`);
  await espera(1500);
  const chip = await js(`document.getElementById("reArq").innerText`);
  tudo &= ok(/3 reenvio\(s\) para buscar · 2 conta\(s\) · 1 sem conta/.test(chip), `a aba entrou: "${chip.replace(/\s+/g, " ").trim()}"`);
  tudo &= ok(await js(`!document.getElementById("bRodar").disabled`), "\"Iniciar coleta\" liberado");
  const contas = await js(`window.esteira.pedir("rodada:contas", []).then(r => { const d = r.dado?.dado ?? r.dado; return Array.isArray(d) ? d.map(c => c.conta).sort().join(",") : JSON.stringify(r); })`);
  tudo &= ok(contas === "248,300,301,529", `a fila soma as do dia e as dos reenvios, cada uma uma vez: ${contas}`);
  await foto("13-reenvios-escolhida.png");

  // a rodada terminou
  emitir("rodada:fim", {});
  await espera(2500);
  await js(`document.querySelector('[data-etapa="4"]').click(); 1`);
  await espera(800);
  await js(`document.getElementById("blReenvios4").scrollIntoView({ block: "start" }); 1`);
  const tabela = await js(`document.getElementById("tbReenvios").innerText`);
  tudo &= ok(tabela.includes(NOVO_A) && tabela.includes(NOVO_B) && !tabela.includes(ORIGINAL_B),
    "etapa 4: o rastreio novo de cada reenvio, e nunca o do envio original");
  tudo &= ok(/ainda não despachou/.test(tabela) && /falta a conta/.test(tabela), "o que não achou diz por quê");
  await foto("14-reenvios-etapa4.png");

  await js(`document.querySelector('[data-copiar-re]').click(); 1`);
  await espera(600);
  tudo &= ok(clipboard.readText() === NOVO_A, `"Copiar" de uma linha: ${clipboard.readText()}`);
  await js(`document.getElementById("bCopiarRe").click(); 1`);
  await espera(600);
  tudo &= ok(clipboard.readText().split("\n").length === 2, "\"Copiar todos\": 2 linhas");
  const selo = await js(`document.querySelector(".selo-proto")?.title ?? ""`);
  tudo &= ok(!/reenvio/i.test(selo), `a parte nova da tela ligou de verdade${selo ? " (selo do ensaio: " + selo + ")" : ""}`);
  const avisos = await js(`window.__avisos.join(" | ")`);
  tudo &= ok(!/Não consegui/.test(avisos), `sem erro na tela${avisos ? " (" + avisos + ")" : ""}`);

  console.log(tudo ? "\n\x1b[32m\x1b[1m  reenvios na janela: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  reenvios na janela: FALHOU\x1b[0m\n");
  app.exit(tudo ? 0 : 1);
});
