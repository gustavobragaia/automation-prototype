// A planilha que some de Downloads — Chomps, 27/10/2026 — na janela de
// verdade: escolher, apagar o original, clicar em "Iniciar coleta". Antes, a
// rodada abria o AdsPower inteiro (500 contas). Aqui o AdsPower de mentira tem
// 200 perfis e a tabela da coleta tem que mostrar só as 3 da planilha. Depois,
// sem a cópia também, a rodada não começa e a tela diz por quê.
//
//   npm run ensaio:sumida          (ESTEIRA_FOTO=<pasta> grava os prints)
import { app, BrowserWindow } from "electron";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

const dir = mkdtempSync(join(tmpdir(), "esteira-sumida-"));
mkdirSync(join(dir, "estado"), { recursive: true });
process.env.ESTADO_DIR = join(dir, "estado"); process.env.TRABALHO_DIR = join(dir, "trabalho");
process.env.RECURSOS_DIR = join(import.meta.dirname, "..");
process.env.PAUSA_REPETIR_MS = "60000";
writeFileSync(join(dir, "estado", "ajustes.json"), JSON.stringify({ guiaConcluido: true, shopeeSenha: "x", codigoChave: "y",
  emailPrefixo: "loja", emailDominio: "ex.com" }));
app.setPath("userData", join(dir, "dados-electron"));

// AdsPower de mentira: 200 perfis; abrir perfil falha (nada abre de verdade)
const perfis = [...Array.from({ length: 197 }, (_, i) => 600 + i), 453, 454, 455]
  .map((n) => ({ user_id: `u${n}`, serial_number: String(n), name: `Shopee ${n}` }));
const abertos = [];
const ads = createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.endsWith("/user/list")) {
    const p = Number(u.searchParams.get("page") ?? 1), t = Number(u.searchParams.get("page_size") ?? 100);
    return res.end(JSON.stringify({ code: 0, msg: "ok", data: { list: perfis.slice((p - 1) * t, p * t) } }));
  }
  if (/browser\/start/.test(u.pathname)) abertos.push(u.searchParams.get("user_id") ?? u.searchParams.get("serial_number"));
  res.end(JSON.stringify({ code: -1, msg: "perfil de teste: não abre" }));
});
await new Promise((r) => ads.listen(0, "127.0.0.1", r));
process.env.ADSPOWER_BASE = `http://127.0.0.1:${ads.address().port}`;

const DOWNLOADS = join(dir, "Downloads"); mkdirSync(DOWNLOADS);
const original = join(DOWNLOADS, "modelo-esteira_filtrado (2).xlsx");

await import("./principal.mjs");
const { default: ExcelJS } = await import("../src/excel.mjs");
const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("PEDIDOS");
ws.addRow(["DATA", "NÚMERO DO PEDIDO", "NOME DO CLIENTE", "VALOR PAGO", "CÓDIGO DE RASTREIO", "ONDE FOI FEITO O PEDIDO"]);
[453, 454, 455].forEach((c, i) => ws.addRow(["27/10", `Pedido #${180000 + i}`, `Cliente ${i}`, 10, null, `shopee ${c}`]));
await wb.xlsx.writeFile(original);

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const FOTO = process.env.ESTEIRA_FOTO;
let tudo = true;
process.on("unhandledRejection", (e) => { console.log("  \x1b[31m✗ quebrou: " + (e?.message ?? e) + "\x1b[0m"); app.exit(1); });
setTimeout(() => { console.log("  \x1b[31m✗ passou de 150 s\x1b[0m"); app.exit(1); }, 150_000).unref?.();

app.whenReady().then(async () => {
  await espera(3500);
  const w = BrowserWindow.getAllWindows()[0];
  w.setSize(1280, 860);
  const js = (c) => w.webContents.executeJavaScript(c);
  const foto = async (nome) => { if (FOTO) { w.show(); w.focus(); w.webContents.invalidate(); await espera(800); await writeFile(join(FOTO, nome), (await w.webContents.capturePage()).toPNG()); } };
  await js(`window.__avisos = []; window.TELA.avisar = (t, c) => window.__avisos.push(t + " — " + c); 1`);

  console.log("\n\x1b[1mA planilha some de Downloads depois de escolhida\x1b[0m");
  // como o Matheus: escolhe pelo arquivo (o mesmo caminho que o arrastar usa)
  await js(`window.esteira.pedir("planilha:ler", { caminho: ${JSON.stringify(original)} }).then(() => 1)`);
  await espera(1500);
  rmSync(original);
  console.log("     (o arquivo foi apagado de Downloads)");
  await js(`document.querySelector('[data-etapa="2"]').click(); 1`);
  await espera(500);
  console.log("     rodada:contas →", JSON.stringify(await js(`window.esteira.pedir("rodada:contas", []).then(r => r.ok ? (r.dado.ok === false ? "erro: " + r.dado.erro : r.dado.dado ?? r.dado) : "erro: " + r.erro).then(d => Array.isArray(d) ? d.map(c => c.conta) : d)`)));
  await js(`document.getElementById("bRodar").disabled = false; document.getElementById("bRodar").click(); 1`);
  // espera a varredura do AdsPower (1,2 s por página) e a tabela montar
  for (let i = 0; i < 40 && !(await js(`document.querySelectorAll("table tr").length > 2`)); i++) await espera(500);
  await espera(1500);
  const linhas = await js(`[...document.querySelectorAll("table tr")].map(t => t.innerText.match(/Shopee (\\d+)/)?.[1]).filter(Boolean).join(",")`);
  tudo &= ok(linhas.split(",").sort().join() === "453,454,455", `a rodada abriu só as contas da planilha: ${linhas} (antes: o AdsPower inteiro)`);
  await foto("10-planilha-sumida-rodada.png");
  await js(`document.getElementById("bParar").click(); 1`);
  for (let i = 0; i < 60 && (await js(`window.esteira.pedir("rodada:emCurso", {}).then(r => r.dado)`)); i++) await espera(500);

  // sem a cópia também: a rodada não começa, e a tela diz por quê
  for (const f of readdirSync(join(dir, "trabalho", "planilhas"))) rmSync(join(dir, "trabalho", "planilhas", f));
  await js(`window.__avisos = []; document.getElementById("bRodar").disabled = false; document.getElementById("bRodar").click(); 1`);
  await espera(2500);
  const erro = await js(`(document.getElementById("erroRodada")?.textContent ?? "") + " | " + window.__avisos.join(" | ")`);
  tudo &= ok(/a planilha "modelo-esteira_filtrado \(2\)\.xlsx" não está mais acessível — escolha de novo na etapa 1/.test(erro),
    `sem a cópia: não começa, e a tela diz "${erro.split(" | ")[0]}"`);
  await foto("11-planilha-sumida-erro.png");

  ads.close();
  console.log(tudo ? "\n\x1b[32m\x1b[1m  planilha que some na janela: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  planilha que some na janela: FALHOU\x1b[0m\n");
  app.exit(tudo ? 0 : 1);
});
