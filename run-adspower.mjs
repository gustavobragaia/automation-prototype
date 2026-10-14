// Teste contra o AdsPower REAL (não o mock do run-e2e.mjs).
//
// Prova que a Local API responde como programado, que o Playwright conecta
// no perfil via CDP e que o navegador obedece comandos.
//
//   node --env-file=.env run-adspower.mjs              # abre o 1º perfil
//   node --env-file=.env run-adspower.mjs <user_id>    # abre um específico
//
// Não faz login em lugar nenhum: só abre o perfil e lê o que já está na tela.

import { chromium } from "playwright-core";
import { listarPerfisOuNull, abrirPerfil, fecharPerfil, statusPerfil } from "./src/adspower.mjs";
import { parseConta, emailDaConta } from "./src/tracking.mjs";

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const aviso = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const info = (m) => console.log(`    ${m}`);
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

if (!process.env.ADSPOWER_API_KEY) {
  console.error("Falta ADSPOWER_API_KEY no .env — rode com: node --env-file=.env run-adspower.mjs");
  process.exit(1);
}

let perfilAberto = null;
const encerrar = async () => {
  if (perfilAberto) { try { await fecharPerfil(perfilAberto); } catch {} perfilAberto = null; }
};
process.on("SIGINT", async () => { await encerrar(); process.exit(130); });

try {
  // ─── 1. Local API ───────────────────────────────────────────────────────
  sec("1. AdsPower Local API");
  const serial = Number(process.argv[2] ?? 1);
  const lista = await listarPerfisOuNull(1, 50);

  if (lista) {
    ok(`${lista.list.length} perfil(is) encontrado(s)`);
    for (const p of lista.list)
      info(`[${p.serial_number}] ${p.name || "(sem nome)"} · user_id=${p.user_id} · username=${p.username ? "preenchido" : "VAZIO"}`);
    const p = lista.list.find((x) => Number(x.serial_number) === serial);
    if (p) {
      const conta = parseConta(p.name);
      if (conta.numeros.length) ok(`"${p.name}" -> conta ${conta.numeros[0]} -> ${emailDaConta(conta.numeros[0])}`);
    }
  } else {
    aviso("user/list é bloqueado no plano free do AdsPower — endereçando por serial_number");
    info("no plano do cliente (700 perfis) esse endpoint funciona normalmente");
  }

  const alvo = { serial };
  ok(`status antes de abrir: ${await statusPerfil(alvo)}`);

  // ─── 2. Abrir e conectar ────────────────────────────────────────────────
  sec("2. Abrir o perfil e conectar o Playwright");
  const t0 = Date.now();
  const sessao = await abrirPerfil(alvo);
  perfilAberto = alvo;
  ok(`perfil aberto em ${Date.now() - t0} ms`);
  info(`ws: ${sessao.ws}`);

  const browser = await chromium.connectOverCDP(sessao.ws);
  ok(`connectOverCDP conectado · ${browser.contexts().length} contexto(s)`);

  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  // ─── 3. O navegador obedece? ────────────────────────────────────────────
  sec("3. Controlar o navegador");
  await page.goto("https://shopee.com.br/user/purchase", { waitUntil: "domcontentloaded", timeout: 60_000 });

  // A Shopee é SPA: o HTML inicial vem vazio. Espera o corpo ter conteúdo
  // de verdade antes de ler qualquer coisa.
  const texto = await page
    .waitForFunction(() => {
      const t = document.body?.innerText?.trim() ?? "";
      return t.length > 40 ? t : null;
    }, null, { timeout: 45_000, polling: 500 })
    .then((h) => h.jsonValue())
    .catch(() => "");

  ok(`navegou · título: "${await page.title()}"`);
  info(`url final: ${page.url()}`);
  info(`texto renderizado: ${texto.length} caracteres`);

  const ua = await page.evaluate(() => navigator.userAgent);
  const wd = await page.evaluate(() => navigator.webdriver);
  const mobile = /Android|iPhone|Mobile/i.test(ua);
  ok(`navigator.webdriver = ${wd}  ${wd ? "(ATENÇÃO: detectável)" : "(mascarado pelo cdp_mask)"}`);
  (mobile ? aviso : ok)(`User-Agent: ${mobile ? "MOBILE" : "desktop"} — ${ua.slice(0, 80)}...`);
  if (mobile) info("o layout mobile da Shopee é diferente do desktop; o perfil do cliente provavelmente é desktop");

  const logado =
    !/\/buyer\/login|\/login/i.test(page.url()) &&
    !/entrar|fazer login|log ?in/i.test(texto.slice(0, 400));
  (logado ? ok : aviso)(logado
    ? "sessão ativa: a tela de compras carregou"
    : "não logado na Shopee neste perfil — crie/entre na conta dentro deste perfil do AdsPower");

  await page.screenshot({ path: "tela-adspower.png", fullPage: false });
  const { writeFileSync } = await import("node:fs");
  writeFileSync("tela-shopee.txt", texto);
  writeFileSync("tela-shopee.html", await page.content());
  ok("salvos: tela-adspower.png · tela-shopee.txt · tela-shopee.html");

  sec("4. O que tem na tela");
  console.log(texto.slice(0, 1200) || "  (vazio)");

  await browser.close();
} finally {
  sec("Encerrando");
  await encerrar();
  console.log("  perfil fechado (sem deslogar)");
}
