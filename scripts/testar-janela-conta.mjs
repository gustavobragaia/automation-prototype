// Achar a janela da conta que pede ajuda — feedback do Matheus, 21/10/2026.
//
// "A conta 130 está esperando você", e ninguém sabia qual das janelas abertas
// era a 130: a fila fechava a aba do próprio AdsPower ("Shopee 130") e abria
// o perfil sem ela. Agora: a aba do AdsPower fica, o título da aba da Shopee
// começa com "Conta 130 · " (vira o nome da janela na barra de tarefas), e a
// janela vem para a frente quando a conta pede uma pessoa.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

sec("1. Que abas a fila fecha ao abrir o perfil");
{
  const { abasParaFechar } = await import("../src/fila.mjs");
  // as abas de verdade de um perfil (conta 124, 21/10)
  const abas = [
    { type: "page", url: "https://shopee.com.br/user/purchase?type=7", title: "Shopee Brasil" },
    { type: "page", url: "https://start.adspower.net/?id=k1boua9d&host=127.0.0.1:20725", title: "Shopee 124" },
    { type: "page", url: "about:blank" },
    { type: "service_worker", url: "chrome-extension://x/background.mjs" },
  ];
  const fecha = abasParaFechar(abas).map((t) => t.url);
  tudo &= ok(!fecha.some((u) => /start\.adspower/.test(u)), "a aba do AdsPower (\"Shopee 124\") fica aberta");
  tudo &= ok(fecha.length === 1 && /shopee\.com\.br/.test(fecha[0]), "a aba restaurada da Shopee é fechada (evita logins duplicados)");
  const fonte = readFileSync(new URL("../src/adspower.mjs", import.meta.url), "utf8");
  tudo &= ok(/ip_tab: 1/.test(fonte), "o perfil abre com ip_tab: 1 (sem isso o AdsPower nem cria a aba)");
}

sec("2. \"Conta N · \" no título da aba da Shopee");
{
  const FONTE = readFileSync(new URL("../extensao/login.js", import.meta.url), "utf8");
  const doc = { title: "Lista de Pedidos", body: { innerText: "" }, querySelector: () => null, querySelectorAll: () => [] };
  const intervalos = [];
  const ctx = {
    chrome: { runtime: { sendMessage: (m, r) => { if (m.pedido === "qual-conta") r?.({ conta: "139" }); } } },
    document: doc, location: { pathname: "/user/purchase", href: "https://shopee.com.br/user/purchase" },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout, clearInterval, setInterval: (f) => { intervalos.push(f); return 0; },
    Promise, Date, Math, Object, Array, String, Number, JSON, RegExp, Set, Event: class {},
  };
  vm.createContext(ctx); vm.runInContext(FONTE, ctx);
  await new Promise((r) => setTimeout(r, 20));
  tudo &= ok(doc.title === "Conta 139 · Lista de Pedidos", `título: "${doc.title}"`);
  doc.title = "Verificar Identidade";                   // a Shopee troca o título ao navegar
  for (const f of intervalos) f();
  tudo &= ok(doc.title === "Conta 139 · Verificar Identidade", `a Shopee troca o título e ele volta: "${doc.title}"`);
  for (const f of intervalos) f();
  tudo &= ok(doc.title === "Conta 139 · Verificar Identidade", "sem repetir o prefixo");
}

sec("3. \"Precisa de você\" traz a janela da conta para a frente");
{
  const FONTE = readFileSync(new URL("../extensao/background.js", import.meta.url), "utf8");
  const feitos = [];
  let ouvinte = null;
  const prometer = () => Promise.resolve();
  const ctx = {
    self: { COLETOR_CONTA: "139", COLETOR_TOKEN: "t" },
    importScripts: () => {},
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
    URL, JSON, Date, Set, Promise, String,
    chrome: {
      runtime: { onMessage: { addListener: (f) => { ouvinte = f; } } },
      tabs: { onRemoved: { addListener() {} }, update: (id, o) => { feitos.push(["aba", id, o]); return prometer(); },
              create() {}, remove: () => prometer() },
      windows: { update: (id, o) => { feitos.push(["janela", id, o]); return prometer(); } },
    },
  };
  vm.createContext(ctx); vm.runInContext(FONTE, ctx);
  ouvinte({ tipo: "precisa-humano", motivo: "x" }, { tab: { id: 5, windowId: 9 } }, () => {});
  const janela = feitos.find((f) => f[0] === "janela");
  tudo &= ok(janela && janela[1] === 9 && janela[2].focused === true && janela[2].drawAttention === true,
    "a janela da conta vem para a frente e pisca na barra de tarefas");
  tudo &= ok(feitos.some((f) => f[0] === "aba" && f[1] === 5 && f[2].active === true), "e a aba que pediu ajuda fica ativa");
  feitos.length = 0;
  ouvinte({ tipo: "login-iniciado" }, { tab: { id: 5, windowId: 9 } }, () => {});
  tudo &= ok(!feitos.some((f) => f[0] === "janela"), "outros avisos não mexem nas janelas (não rouba a tela à toa)");
}

sec("4. O alerta diz qual janela procurar");
{
  const fonte = readFileSync(new URL("../src/coletor.mjs", import.meta.url), "utf8");
  tudo &= ok(/Procure a janela "Conta \$\{conta\}"/.test(fonte), "\"Procure a janela Conta 139\"");
}

console.log(tudo ? "\n\x1b[32m\x1b[1m  janela da conta: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  janela da conta: FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
