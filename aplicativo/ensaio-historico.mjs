// Histórico sem fechar o app — feedback do Matheus, 21/10/2026.
//
// Com um dia aberto no Histórico, uma escrita nova não aparecia: a lista de
// dias era refeita, mas o dia aberto continuava com os dados de antes. E o
// dia que só tinha escritas mostrava "null contas visitadas em null, null já
// estavam conectadas".
//
//   npm run ensaio:historico
import { app, BrowserWindow } from "electron";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "esteira-hist-"));
mkdirSync(join(dir, "estado"), { recursive: true });
process.env.ESTADO_DIR = join(dir, "estado");
process.env.TRABALHO_DIR = dir;
process.env.RECURSOS_DIR = join(import.meta.dirname, "..");
writeFileSync(join(dir, "estado", "ajustes.json"), JSON.stringify({ guiaConcluido: true }));
app.setPath("userData", join(dir, "dados-electron"));
await import("./principal.mjs");
const { lerRegistro, gravarRegistro } = await import("../src/escrita.mjs");

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const escrita = (n) => ({ pedido: `#90${n}`, conta: 124, codigos: [`BR00000000${n}X`], em: new Date().toISOString(), origem: "robô" });
let tudo = true;

app.whenReady().then(async () => {
  gravarRegistro({ "#901": escrita(1) });
  await espera(3500);
  const w = BrowserWindow.getAllWindows()[0];
  const js = (c) => w.webContents.executeJavaScript(c);
  await js(`document.querySelector('[data-tela="historico"]').click()`); await espera(500);
  await js(`document.querySelector('#tbHist tr.clica')?.click()`); await espera(300);
  const sub = await js(`document.querySelector('#diaSub').innerText`);
  tudo &= ok(!/null/.test(sub), `dia só com escritas não mostra "null" ("${sub}")`);

  // uma escrita nova, com o dia aberto; a tela recarrega como depois de escrever
  gravarRegistro({ ...lerRegistro(), "#902": escrita(2) });
  await js(`(async () => { const r = await window.esteira.pedir("historico:dias"); window.TELA.historico(r.dado ?? r); })()`);
  await espera(400);
  const dia = await js(`document.querySelector('#tbDia').innerText`);
  tudo &= ok(/#902/.test(dia), "o dia aberto mostra a escrita nova sem fechar o app");
  const resumo = await js(`document.querySelector('#diaResumo').innerText.replace(/\\s+/g, " ")`);
  tudo &= ok(/2 escritos/.test(resumo), `e o resumo do dia conta 2 escritos (${resumo.slice(0, 60)})`);

  // abrir a aba Histórico lê de novo, sem depender de quem escreveu
  gravarRegistro({ ...lerRegistro(), "#903": escrita(3) });
  await js(`document.querySelector('[data-tela="ajustes"]').click()`); await espera(200);
  await js(`document.querySelector('[data-tela="historico"]').click()`); await espera(600);
  const dia3 = await js(`document.querySelector('#tbDia').innerText + document.querySelector('#tbHist').innerText`);
  tudo &= ok(/#903/.test(dia3) || /\b3\b/.test(dia3), "ao abrir a aba Histórico, ela é lida de novo");

  console.log(tudo ? "\n\x1b[32m\x1b[1m  histórico: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  histórico: FALHOU\x1b[0m\n");
  app.exit(tudo ? 0 : 1);
});
