// Os Ajustes na janela de verdade: digitar, FECHAR o app, reabrir e
// conferir que o robô usa o que foi digitado — e não o .env.
//
//   npm run ensaio:ajustes
//
// Usa uma pasta descartável e um .env de mentira apontando para OUTROS
// valores. Se o ambiente vencer, o teste cai: é exatamente o que não pode
// acontecer com um cliente que só tem a tela.
import { app, BrowserWindow } from "electron";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = "/Users/gustavobragaia/Documents/shopee-tracking-bot";
const dir = mkdtempSync(join(tmpdir(), "esteira-ajustes-"));
process.env.ESTADO_DIR = join(dir, "estado");
process.env.TRABALHO_DIR = dir;
process.env.RECURSOS_DIR = raiz;
// o ".env esquecido na pasta", com valores diferentes dos que vamos digitar
process.env.SHOPEE_SENHA = "senha-do-env";
process.env.SHOPEE_PREFIXO = "doenv";
process.env.SHOPEE_EMAIL_DOMINIO = "env.com";

await import("./principal.mjs");

const ok = (c, m) => { console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`); return c; };
let tudo = true;

app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 3500));
  const w = BrowserWindow.getAllWindows()[0];
  await w.webContents.executeJavaScript(`document.querySelector('[data-tela="ajustes"]')?.click()`);

  // digita como uma pessoa digita, e dispara o `change` de cada campo
  const digitado = await w.webContents.executeJavaScript(`(() => {
    const p = (id, v) => { const e = document.getElementById(id);
      e.value = v; e.dispatchEvent(new Event("input", {bubbles:true}));
      e.dispatchEvent(new Event("change", {bubbles:true})); };
    // os segredos são salvos um a um, pelo botão Salvar do próprio campo
    const segredo = (qual, v) => {
      const cx = document.querySelector('.segredo[data-segredo="' + qual + '"]');
      cx.querySelector("input").value = v;
      cx.querySelector("[data-salvar]").click();
    };
    segredo("shopeeSenha", "senha-que-eu-digitei");
    segredo("codigoChave", "chave-que-eu-digitei");
    p("shPrefixo", "minhaloja");
    p("shPrefixoAlto", "");
    p("shDominio", "meudominio.com");
    p("shFaixa", "");
    return { exemplo: document.getElementById("shExemplo").textContent };
  })()`);
  await new Promise((r) => setTimeout(r, 900));

  // a tela nunca pode ter o segredo de volta
  const estadoSegredo = await w.webContents.executeJavaScript(`(() => {
    const cx = document.querySelector('.segredo[data-segredo="shopeeSenha"]');
    return { guardada: !cx.querySelector(".guardado").hidden &&
                       /Guardada neste computador/.test(cx.querySelector(".guardado").innerText),
             campoVazio: cx.querySelector("input").value === "" };
  })()`);
  const naTela = await w.webContents.executeJavaScript(`(async () => {
    const r = await window.esteira.pedir("ajustes:ler", {});
    const a = r.dado && r.dado.dado ? r.dado.dado : r.dado;
    return { senha: a.shopeeSenha, prefixo: a.emailPrefixo };
  })()`);

  console.log("");
  tudo &= ok(/minhaloja124@meudominio\.com/.test(digitado.exemplo),
    `a tela mostra o e-mail que será usado (${digitado.exemplo.trim()})`);
  tudo &= ok(naTela.senha === "guardada", "a senha NUNCA volta inteira para a tela");
  tudo &= ok(estadoSegredo.guardada, "e o campo diz, com todas as letras, 'Guardada neste computador'");
  tudo &= ok(estadoSegredo.campoVazio, "sem pontinhos falsos no lugar do valor");
  tudo &= ok(naTela.prefixo === "minhaloja", "mas o que não é segredo, sim");

  // ── fecha o app: a partir daqui, só o que está em disco vale ──
  const guardado = JSON.parse(readFileSync(join(dir, "estado", "ajustes.json"), "utf8"));
  tudo &= ok(guardado.shopeeSenha === "senha-que-eu-digitei", "gravou a senha em disco");
  tudo &= ok(guardado.emailDominio === "meudominio.com", "e o domínio");

  // ── e o robô, lendo do zero, usa os Ajustes e não o .env ──
  const { execFileSync } = await import("node:child_process");
  const usado = JSON.parse(execFileSync(process.execPath,
    ["--input-type=module", "-e", `
      const { aplicarNoAmbiente } = await import("${raiz}/src/ajustes.mjs");
      aplicarNoAmbiente();
      const { emailDaConta } = await import("${raiz}/src/tracking.mjs");
      console.log(JSON.stringify({ senha: process.env.SHOPEE_SENHA, email: emailDaConta(124) }));
    `], { encoding: "utf8",
          // Dentro do Electron, process.execPath É o Electron. Sem esta
          // variável ele trata o script como um app e recusa a abrir.
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }).trim());

  tudo &= ok(usado.senha === "senha-que-eu-digitei",
    "o robô usa a senha dos Ajustes, não a do ambiente");
  tudo &= ok(usado.email === "minhaloja124@meudominio.com",
    `e monta o e-mail com o padrão da tela (${usado.email})`);

  console.log(tudo ? "\n\x1b[32m\x1b[1m  os Ajustes mandam no robô\x1b[0m\n"
                   : "\n\x1b[31m\x1b[1m  os Ajustes NÃO mandam no robô\x1b[0m\n");
  if (process.env.ESTEIRA_FOTO) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile("/tmp/ajustes.png", (await w.webContents.capturePage()).toPNG());
  }
  app.exit(tudo ? 0 : 1);
});
