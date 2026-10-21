// Progresso da coleta (etapa 2): "quantos foram e quantos não foram" —
// feedback do Matheus, 21/10/2026. Alimenta a tela com a sequência de eventos
// de uma rodada e confere a contagem e o filtro.
//
//   npm run ensaio:progresso
import { app, BrowserWindow } from "electron";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "esteira-prog-"));
mkdirSync(join(dir, "estado"), { recursive: true });
process.env.ESTADO_DIR = join(dir, "estado"); process.env.TRABALHO_DIR = dir;
process.env.RECURSOS_DIR = join(import.meta.dirname, "..");
writeFileSync(join(dir, "estado", "ajustes.json"), JSON.stringify({ guiaConcluido: true }));
app.setPath("userData", join(dir, "dados-electron"));
await import("./principal.mjs");
const { emitir } = await import("../src/eventos.mjs");
const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let tudo = true;

app.whenReady().then(async () => {
  await espera(3500);
  const w = BrowserWindow.getAllWindows()[0];
  const js = (c) => w.webContents.executeJavaScript(c);
  await js(`document.querySelector('[data-etapa="2"]').click()`);
  emitir("rodada:inicio", { contas: [124, 133, 128, 130, 152, 142].map((conta) => ({ conta, perfil: conta })) });
  await espera(200);
  emitir("conta:feita", { conta: 124, pedidos: 43, segundos: 40 });
  emitir("conta:humano", { conta: 133, motivo: "x" });
  emitir("conta:feita", { conta: 133, pedidos: 44, segundos: 90 });       // esperou e depois foi lida
  emitir("conta:repetindo", { conta: 128, tentativa: 2, de: 3, motivo: "prazo" });
  emitir("conta:falhou", { conta: 130, erro: "conta 130: a Shopee pediu uma pessoa", tentativas: 1, natureza: "pessoa" });
  emitir("conta:lendo", { conta: 152 });
  await espera(400);
  const txt = await js(`document.getElementById("pcTxt").innerText.replace(/\\s+/g, " ")`);
  tudo &= ok(/2 de 6 contas lidas/.test(txt), `"${txt}"`);
  tudo &= ok(/2 lidas/.test(txt) && /1 em andamento/.test(txt) && /1 tentando de novo/.test(txt) && /1 falhou/.test(txt) && /1 na fila/.test(txt),
    "cada grupo com a sua contagem");
  tudo &= ok(!/esperando você/.test(txt), "a 133 esperou alguém e depois foi lida: conta como lida, não nos dois");
  const barra = await js(`[...document.querySelectorAll("#pcBarra i")].map(i => i.className + ":" + Math.round(parseFloat(i.style.width))).join(" ")`);
  tudo &= ok(/lidas:33/.test(barra) && /falharam:17/.test(barra), `a barra tem o tamanho de cada grupo (${barra})`);
  if (process.env.ESTEIRA_FOTO) await writeFile("/private/tmp/claude-501/-Users-gustavobragaia-Documents-acompanhanteja/cac2f36a-9699-4e9f-9e4f-681742789520/scratchpad/progresso.png", (await w.webContents.capturePage()).toPNG());
  await js(`document.querySelector('#pcTxt [data-grupo="falharam"]').click()`); await espera(200);
  const linhas = await js(`[...document.querySelectorAll("#corpo tr")].map(t => t.innerText.match(/Shopee (\\d+)/)?.[1]).join(",")`);
  tudo &= ok(linhas === "130", `clicar em "falharam" mostra só a 130 (${linhas})`);
  await js(`document.querySelector('#pcTxt [data-grupo=""]').click()`); await espera(200);
  const todas = await js(`document.querySelectorAll("#corpo tr").length`);
  tudo &= ok(todas === 6, `"mostrar todas" volta as 6 (${todas})`);
  console.log(tudo ? "\n\x1b[32m\x1b[1m  progresso da coleta: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  progresso da coleta: FALHOU\x1b[0m\n");
  app.exit(tudo ? 0 : 1);
});
