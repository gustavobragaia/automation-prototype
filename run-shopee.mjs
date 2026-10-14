// Captura os pedidos da Shopee interceptando as chamadas internas que a
// própria página faz, em vez de raspar o DOM.
//
// Vantagem: o JSON da API interna muda muito menos que o HTML. Um redesenho
// da tela não quebra o robô.
//
//   node --env-file=.env run-shopee.mjs [serial]

import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { abrirPerfil, fecharPerfil } from "./src/adspower.mjs";

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const aviso = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const info = (m) => console.log(`    ${m}`);
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const serial = Number(process.argv[2] ?? 2);
mkdirSync("captura", { recursive: true });

let aberto = null;
const encerrar = async () => { if (aberto) { try { await fecharPerfil(aberto); } catch {} aberto = null; } };
process.on("SIGINT", async () => { await encerrar(); process.exit(130); });

try {
  sec("1. Abrir perfil e conectar");
  const s = await abrirPerfil({ serial }, { aoEsperar: (m, i, n) => aviso(`${m} (${i}/${n})`) });
  aberto = { serial };
  const browser = await chromium.connectOverCDP(s.ws);
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  ok("conectado");

  sec("2. Escutando as chamadas internas da Shopee");
  const capturas = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (!/shopee\.com\.br\/api\//.test(url)) return;
    try {
      const ct = res.headers()["content-type"] ?? "";
      if (!ct.includes("json")) return;
      const corpo = await res.json();
      const rota = url.split("?")[0].replace("https://shopee.com.br", "");
      const interessa = /order|purchase|logistic|tracking/i.test(url);
      capturas.push({ url, rota, interessa, corpo });
      info(`${interessa ? "*" : " "} ${res.status()} ${rota}`);
    } catch {}
  });

  await page.goto("https://shopee.com.br/user/purchase", { waitUntil: "domcontentloaded", timeout: 60_000 });

  // espera o conteúdo real do #main, não só o cabeçalho do site
  await page
    .waitForFunction(() => {
      const t = document.querySelector("#main")?.innerText ?? "";
      return /nenhum pedido|sem pedidos|você ainda não|no orders|entrega|a caminho|concluído|a enviar|pedido/i.test(t);
    }, null, { timeout: 45_000, polling: 500 })
    .catch(() => aviso("não apareceu nem lista nem estado-vazio em 45s"));

  await page.waitForTimeout(4000); // deixa as chamadas tardias chegarem

  sec("3. Resultado");
  const texto = await page.evaluate(() => document.querySelector("#main")?.innerText ?? "");
  info(`#main: ${texto.length} caracteres`);
  writeFileSync("captura/main.txt", texto);
  writeFileSync("captura/pagina.html", await page.content());
  await page.screenshot({ path: "captura/tela.png", fullPage: true });

  if (capturas.length === 0) {
    aviso("nenhuma chamada de pedidos interceptada");
    info("se a conta ainda não tem compras, isso é esperado");
  } else {
    ok(`${capturas.length} resposta(s) capturada(s)`);
    const rel = capturas.filter((c) => c.interessa);
    ok(`${rel.length} delas parecem ser de pedidos/rastreio`);
    capturas.forEach((c, i) => {
      const nome = `captura/api-${String(i + 1).padStart(2, "0")}.json`;
      writeFileSync(nome, JSON.stringify(c, null, 2));
      info(`${nome}  <-  ${c.url.split("?")[0].replace("https://shopee.com.br", "")}`);
    });
  }

  console.log("\n--- texto do #main (até 1500 chars) ---");
  console.log(texto.slice(0, 1500) || "(vazio)");

  await browser.close();
} finally {
  sec("Encerrando");
  await encerrar();
  console.log("  perfil fechado (sem deslogar)");
}
