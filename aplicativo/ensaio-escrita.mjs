// Etapa 4 na janela: "Ver todos os N" e o progresso da escrita — feedback do
// Matheus, 21/10/2026. A escrita é simulada (nada vai para a Shopify).
//
//   npm run ensaio:escrita
import { app, BrowserWindow } from "electron";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "esteira-esc-"));
mkdirSync(join(dir, "estado"), { recursive: true });
process.env.ESTADO_DIR = join(dir, "estado"); process.env.TRABALHO_DIR = dir;
process.env.RECURSOS_DIR = join(import.meta.dirname, "..");
writeFileSync(join(dir, "estado", "ajustes.json"), JSON.stringify({ guiaConcluido: true }));
app.setPath("userData", join(dir, "dados-electron"));
await import("./principal.mjs");
const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let tudo = true;

app.whenReady().then(async () => {
  await espera(3500);
  const w = BrowserWindow.getAllWindows()[0];
  const js = (c) => w.webContents.executeJavaScript(c);
  await js(`window.TELA.escrita({ itens: Array.from({ length: 40 }, (_, i) => ({ pedido: "#" + (1001 + i), conta: 124,
    nome: "Cliente " + i, codigos: ["BR26" + (1001 + i) + "X"], transportadora: "Correios" })) });
    document.querySelector('[data-etapa="4"]').click();`);
  await espera(300);
  const antes = await js(`document.querySelectorAll("#tbEscrita tr").length`);
  const botao = await js(`document.getElementById("bVerTodos")?.innerText`);
  tudo &= ok(antes === 13 && botao === "Ver todos os 40 pedidos", `mostra 12 e o botão "${botao}"`);
  await js(`document.getElementById("bVerTodos").click()`); await espera(150);
  const todos = await js(`document.querySelectorAll("#tbEscrita tr").length`);
  tudo &= ok(todos === 41, `"Ver todos" abre a lista inteira (${todos - 1} pedidos)`);

  // escrita simulada: a tela recebe os mesmos avisos que a escrita de verdade manda
  const r = await js(`(async () => {
    const vistos = [];
    window.GANCHOS.escrever = async () => {
      // passos sem temporizador: janela de teste em segundo plano tem os
      // temporizadores atrasados para 1 s pelo Chromium
      const passa = async (p) => { await Promise.resolve(); window.TELA.escritaProgresso(p); };
      await passa({ fase: "conferindo", total: 40 });
      vistos.push(document.getElementById("eBotTexto").innerText);
      for (let f = 0; f <= 40; f++) {
        await passa({ fase: "escrevendo", feitos: f, total: 40, escritos: f > 7 ? f - 1 : f, falhas: f > 7 ? 1 : 0 });
        if (f === 7) vistos.push(document.getElementById("eBotTexto").innerText + " | " + document.getElementById("eProgTxt").innerText);
        if (f === 20) vistos.push(document.getElementById("eProgBarra").style.width + " " + document.getElementById("eProgFalha").style.width);
      }
      return { escritos: 39, falhas: 1 };
    };
    document.getElementById("bEscrever").click();
    const travou = document.getElementById("bEscrever").disabled;
    for (let i = 0; i < 50 && document.getElementById("bEscrever").disabled && !document.getElementById("fechDet").innerText; i++) await new Promise((r) => setTimeout(r, 100));
    return { vistos, travou, fim: document.getElementById("fechDet").innerText, prog: document.getElementById("eProg").hidden };
  })()`);
  tudo &= ok(r.travou, "o botão trava durante a escrita");
  tudo &= ok(r.vistos[0] === "Conferindo os pedidos na Shopify…", `1ª fase: "${r.vistos[0]}"`);
  tudo &= ok(/^Escrevendo 8 de 40… \| 7 escritos · 33 faltando$/.test(r.vistos[1]), `no meio: "${r.vistos[1]}"`);
  tudo &= ok(/^4\d\.5%|^4\d%/.test(r.vistos[2] ?? "") && /2\.5%/.test(r.vistos[2] ?? ""), `a barra tem escritos e recusados (${r.vistos[2]})`);
  tudo &= ok(/1 recusado pela Shopify/.test(r.fim), `no fim, o resumo fica na tela: "${r.fim.slice(0, 90)}"`);
  tudo &= ok(r.prog === true, "e a barra some quando termina");
  if (process.env.ESTEIRA_FOTO) await writeFile("/private/tmp/claude-501/-Users-gustavobragaia-Documents-acompanhanteja/cac2f36a-9699-4e9f-9e4f-681742789520/scratchpad/escrita.png", (await w.webContents.capturePage()).toPNG());
  console.log(tudo ? "\n\x1b[32m\x1b[1m  escrita na tela: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  escrita na tela: FALHOU\x1b[0m\n");
  app.exit(tudo ? 0 : 1);
});
