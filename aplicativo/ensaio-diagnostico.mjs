// Avisos que não somem e "Exportar diagnóstico", na janela de verdade.
//
//   npm run ensaio:diagnostico
import { app, BrowserWindow } from "electron";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "esteira-diag-"));
mkdirSync(join(dir, "estado"), { recursive: true });
process.env.ESTADO_DIR = join(dir, "estado"); process.env.TRABALHO_DIR = dir;
process.env.RECURSOS_DIR = join(import.meta.dirname, "..");
writeFileSync(join(dir, "estado", "ajustes.json"), JSON.stringify({ guiaConcluido: true, shopeeSenha: "SenhaDeTeste#99" }));
app.setPath("userData", join(dir, "dados-electron"));
await import("./principal.mjs");
const { alertar, resolver } = await import("../src/alertas.mjs");
const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let tudo = true;

app.whenReady().then(async () => {
  await espera(3500);
  const w = BrowserWindow.getAllWindows()[0];
  const js = (c) => w.webContents.executeJavaScript(c);
  alertar({ id: "conta-humano-167", nivel: "atencao", conta: 167, titulo: "A conta 167 está esperando você",
    texto: "o e-mail de verificação não chegou em 120s" });
  await espera(300);
  resolver("conta-humano-167");
  await espera(500);
  const r = await js(`(async () => {
    document.getElementById("bAlertas").click();
    await new Promise(r => setTimeout(r, 200));
    const sino = document.getElementById("sinoN").hidden;
    const b = document.getElementById("bResolvidos");
    const rot = b.hidden ? null : b.innerText;
    b.click();
    await new Promise(r => setTimeout(r, 100));
    return { sino, rot, lista: document.getElementById("listaResolvidos").innerText };
  })()`);
  tudo &= ok(r.sino === true, "o alerta resolvido sai do contador do sino");
  tudo &= ok(r.rot === "Resolvidos nos últimos 7 dias (1)", `e aparece em "${r.rot}"`);
  tudo &= ok(/A conta 167 está esperando você/.test(r.lista) && /não chegou em 120s/.test(r.lista), "com o texto original");

  const caminho = join(dir, "diagnostico.txt");
  await js(`window.esteira.pedir("diagnostico:exportar", { caminho: ${JSON.stringify(caminho)} })`);
  const texto = existsSync(caminho) ? readFileSync(caminho, "utf8") : "";
  tudo &= ok(/DIAGNÓSTICO DO ESTEIRA/.test(texto) && /versão \d+\.\d+\.\d+/.test(texto), "o diagnóstico é salvo pelo app, com a versão");
  tudo &= ok(/A conta 167 está esperando você/.test(texto), "leva os alertas, inclusive os resolvidos");
  tudo &= ok(!texto.includes("SenhaDeTeste#99"), "e não leva a senha");
  tudo &= ok(/coletor ouvindo/.test(texto), "leva o log do app (gravado em arquivo)");
  console.log(tudo ? "\n\x1b[32m\x1b[1m  diagnóstico na tela: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  diagnóstico na tela: FALHOU\x1b[0m\n");
  app.exit(tudo ? 0 : 1);
});
