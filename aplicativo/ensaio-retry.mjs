// "Tentar de novo" na janela de verdade: a tabela da coleta mostra "vai tentar
// de novo · 2ª de 3", a falha final diz quantas tentativas, e o alerta do fim
// da rodada tem o botão "Tentar de novo só essas" com as contas certas.
//
//   npm run ensaio:retry
import { app, BrowserWindow } from "electron";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "esteira-retry-"));
process.env.ESTADO_DIR = join(dir, "estado");
process.env.TRABALHO_DIR = dir;
process.env.RECURSOS_DIR = join(import.meta.dirname, "..");
app.setPath("userData", join(dir, "dados-electron"));
await import("./principal.mjs");
const { emitir } = await import("../src/eventos.mjs");
const { alertar } = await import("../src/alertas.mjs");

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let tudo = true;

app.whenReady().then(async () => {
  await espera(3500);
  const w = BrowserWindow.getAllWindows()[0];
  const js = (c) => w.webContents.executeJavaScript(c);
  await js(`document.querySelector('[data-etapa="2"]')?.click()`);
  emitir("rodada:inicio", { contas: [{ conta: 124, perfil: 267 }, { conta: 133, perfil: 250 }] });
  await espera(300);
  emitir("conta:repetindo", { conta: 124, tentativa: 2, de: 3, motivo: "conta 124: nada chegou ao coletor em 150s" });
  emitir("conta:falhou", { conta: 133, erro: "conta 133: a coleta não leu nenhum pedido", tentativas: 3, natureza: "passageira" });
  await espera(400);
  const linhas = await js(`[...document.querySelectorAll("tr")].map(t => t.innerText.replace(/\\s+/g," ")).filter(t => /Shopee 1(24|33)/.test(t))`);
  const l124 = linhas.find((t) => /Shopee 124/.test(t)) ?? "", l133 = linhas.find((t) => /Shopee 133/.test(t)) ?? "";
  tudo &= ok(/vai tentar de novo · 2ª de 3/.test(l124), `a 124 aparece como "vai tentar de novo · 2ª de 3" (${l124.slice(0, 80)})`);
  tudo &= ok(/falhou: .*\(3 tentativas\)/.test(l133), `a 133 aparece como falha, com "(3 tentativas)" (${l133.slice(0, 90)})`);

  alertar({ id: "rodada-falhas", nivel: "erro", titulo: "1 de 2 contas não foram lidas nesta rodada",
    texto: "1 × a coleta não leu nenhum pedido (conta 133)", acao: "Rode de novo só essas.", rerodar: [133] });
  await espera(400);
  const r = await js(`(async () => {
    let chamou = null;
    window.GANCHOS.rerodar = (contas) => { chamou = contas; };
    document.getElementById("bAlertas").click();
    await new Promise(r => setTimeout(r, 200));
    const b = document.querySelector("[data-rerodar]");
    const texto = b ? b.innerText : null;
    b?.click();
    await new Promise(r => setTimeout(r, 100));
    return { texto, chamou, fechou: document.getElementById("painelAlertas").hidden };
  })()`);
  tudo &= ok(r.texto === "Tentar de novo só essas (1)", `o alerta tem o botão "${r.texto}"`);
  tudo &= ok(JSON.stringify(r.chamou) === "[133]", `o botão roda de novo exatamente a conta 133 (${JSON.stringify(r.chamou)})`);
  tudo &= ok(r.fechou, "e fecha o painel para mostrar a rodada");
  console.log(tudo ? "\n\x1b[32m\x1b[1m  tentar de novo na tela: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  tentar de novo na tela: FALHOU\x1b[0m\n");
  app.exit(tudo ? 0 : 1);
});
