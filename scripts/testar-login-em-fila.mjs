// Várias contas deslogadas ao mesmo tempo — rodada de 21/10/2026 na Chomps.
//
// Um login por vez na rodada inteira (src/trava-login.mjs). Quem perdia a vez
// desistia para sempre: a aba ficava parada na tela de login da Shopee, com o
// modal de idioma por cima, até a fila estourar o prazo — "nada chegou ao
// coletor em 150s" em conta atrás de conta.
//
// Aqui o extensao/login.js de verdade roda em três abas de mentira, uma por
// conta, contra a trava de verdade do coletor. Todas têm que entrar, uma de
// cada vez, e ninguém pode logar junto com ninguém.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { pedirTrava, soltarTrava, limparTrava } from "../src/trava-login.mjs";

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
let tudo = true;
const FONTE = readFileSync(new URL("../extensao/login.js", import.meta.url), "utf8");

// o tempo do script corre 200x mais rápido: 6 s de espera viram 30 ms
const RAPIDO = 200;
const avisos = [];
let logandoAgora = 0, maxJuntos = 0;

function abrirAba(conta, { comModalDeIdioma = true } = {}) {
  const loc = { pathname: "/buyer/login", href: "https://shopee.com.br/buyer/login?from=x" };
  let modal = comModalDeIdioma;
  const campo = (nome) => ({ name: nome, value: "", focus() {}, blur() {}, dispatchEvent() {} });
  const usuario = campo("loginKey"), senha = campo("password");
  const botao = (texto, aoClicar) => ({ innerText: texto, click: aoClicar,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }), contains: () => true });
  const entrar = botao("Entrar", () => {
    if (modal) return;               // o modal intercepta o clique
    logandoAgora++; maxJuntos = Math.max(maxJuntos, logandoAgora);
    // a Shopee leva um tempo e manda para a página de compras
    setTimeout(() => { loc.pathname = "/user/purchase"; logandoAgora--; }, 400);
  });
  const portugues = botao("Português (BR)", () => { modal = false; });
  const doc = {
    body: { innerText: "" },
    querySelector: (s) => /loginKey/.test(s) ? usuario : /password/.test(s) ? senha : null,
    querySelectorAll: (s) => s === "button" ? (modal ? [portugues, entrar] : [entrar]) : [],
    elementFromPoint: () => entrar,
  };
  const chrome = { runtime: { sendMessage: (msg, responder) => {
    if (msg.pedido === "login-ligado") return responder({ ok: true });
    if (msg.pedido === "travar-login") return responder({ ok: pedirTrava(conta).meu });
    if (msg.pedido === "credencial") return responder({ email: `conta${conta}@x.com`, senha: "s" });
    if (msg.pedido === "caixa") return responder({ ok: true });
    avisos.push({ conta, ...msg });
    if (["login-ok", "login-falhou", "precisa-humano"].includes(msg.tipo)) soltarTrava(conta);
  } } };
  const lento = (fn, ms) => (f, t, ...a) => fn(f, Math.max(0, (t ?? 0) / RAPIDO), ...a);
  const ctx = {
    chrome, document: doc, location: loc, Object, Event: class { constructor(t) { this.type = t; } },
    setTimeout: lento(setTimeout), setInterval: lento(setInterval), clearInterval,
    Promise, Date, Math, Number, String, Array, Set, JSON, RegExp,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(FONTE, ctx);
  return loc;
}

limparTrava();
const contas = [124, 133, 152];
const abas = contas.map((c) => abrirAba(c));
const t0 = Date.now();
// espera as três entrarem E avisarem (o aviso vem um passo depois da troca de página)
while (Date.now() - t0 < 8000 && !(abas.every((l) => l.pathname === "/user/purchase") &&
       avisos.filter((a) => a.tipo === "login-ok").length >= 3))
  await new Promise((r) => setTimeout(r, 20));

console.log("\n\x1b[1mTrês contas deslogadas ao mesmo tempo\x1b[0m");
const entraram = abas.filter((l) => l.pathname === "/user/purchase").length;
tudo &= ok(entraram === 3, `as três entraram (${entraram}/3) — antes só a primeira, as outras ficavam paradas no login`);
tudo &= ok(maxJuntos === 1, `uma de cada vez (no máximo ${maxJuntos} logando junto)`);
const okPorConta = contas.map((c) => avisos.filter((a) => a.conta === c && a.tipo === "login-ok").length);
tudo &= ok(okPorConta.every((n) => n === 1), `cada conta avisou "login-ok" uma vez (${okPorConta.join(", ")})`);
tudo &= ok(avisos.some((a) => a.tipo === "modal-idioma-fechado"),
  "o modal de idioma é fechado (ele bloqueia o clique em Entrar)");

// ── "Verificar Identidade" depois da senha (contas 142, 149, 153) ──────────
// O robô tratava sair do /buyer/login como "entrei", voltava para Minhas
// Compras, a Shopee devolvia para o login e ele entrava DE NOVO. Agora: a
// identidade é confirmada pelo link do e-mail, a senha sai uma vez só por
// rodada, e uma segunda ida ao login vira "precisa de você".
console.log("\n\x1b[1mA Shopee pede \"Verificar Identidade\" depois da senha\x1b[0m");
const { entregarCredencial, novoToken, marcarTentativa } = await import("../src/credenciais.mjs");
process.env.SHOPEE_SENHA = "s"; process.env.SHOPEE_PREFIXO = "c"; process.env.SHOPEE_EMAIL_DOMINIO = "x.com";
novoToken();
limparTrava();
const sessao = {};
const avisosIvs = [];
let senhasPedidas = 0, linkPedido = 0, caixaAntes = false;
function abrirPagina(caminho) {
  const loc = { pathname: caminho, _href: "https://shopee.com.br" + caminho, navegou: null,
    get href() { return this._href; }, set href(v) { this.navegou = v; } };
  const campo = () => ({ value: "", focus() {}, blur() {}, dispatchEvent() {} });
  const usuario = campo(), senha = campo();
  const el = (texto, aoClicar = () => {}) => ({ innerText: texto, click: aoClicar,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }), contains: () => true });
  const entrar = el("Entrar", () => setTimeout(() => { loc.pathname = "/verify/ivs"; }, 100));
  const viaEmail = el("Verificar via link por E-mail", () => avisosIvs.push({ tipo: "clicou-email" }));
  const doc = {
    body: { innerText: "" },
    querySelector: (q) => loc.pathname === "/buyer/login" ? (/loginKey/.test(q) ? usuario : /password/.test(q) ? senha : null) : null,
    querySelectorAll: () => loc.pathname === "/verify/ivs" ? [viaEmail] : [entrar],
    elementFromPoint: () => entrar,
  };
  const chrome = { runtime: { sendMessage: (msg, responder) => {
    if (msg.pedido === "login-ligado") return responder({ ok: true });
    if (msg.pedido === "travar-login") return responder({ ok: pedirTrava(160).meu });
    if (msg.pedido === "credencial") { senhasPedidas++;
      try { return responder(entregarCredencial(160)); } catch (e) { return responder({ erro: e.message, repetida: e.repetida }); } }
    if (msg.pedido === "caixa") { caixaAntes = !avisosIvs.some((a) => a.tipo === "clicou-email"); return responder({ ok: true }); }
    if (msg.pedido === "link") { linkPedido++; return responder({ link: "https://shopee.com.br/verify/link?token=abc" }); }
    avisosIvs.push(msg);
    if (msg.tipo === "login-iniciado") marcarTentativa(160);   // como o coletor faz
    if (["login-ok", "login-falhou", "precisa-humano"].includes(msg.tipo)) soltarTrava(160);
  } } };
  const storage = { getItem: (k) => sessao[k] ?? null, setItem: (k, v) => { sessao[k] = String(v); }, removeItem: (k) => { delete sessao[k]; } };
  const lento = (fn) => (f, t, ...a) => fn(f, Math.max(0, (t ?? 0) / RAPIDO), ...a);
  const ctx = { chrome, document: doc, location: loc, sessionStorage: storage, Object,
    Event: class {}, setTimeout: lento(setTimeout), setInterval: lento(setInterval), clearInterval,
    Promise, Date, Math, Number, String, Array, Set, JSON, RegExp };
  vm.createContext(ctx); vm.runInContext(FONTE, ctx);
  return loc;
}
const p1 = abrirPagina("/buyer/login");
for (let i = 0; i < 300 && !p1.navegou; i++) await new Promise((r) => setTimeout(r, 10));
tudo &= ok(!avisosIvs.some((a) => a.tipo === "login-ok"), "sair do login para /verify/ivs NÃO é \"entrei\"");
tudo &= ok(avisosIvs.some((a) => a.tipo === "clicou-email") && linkPedido === 1,
  "clica em \"Verificar via link por E-mail\" e busca o link na caixa");
tudo &= ok(caixaAntes, "ativa a caixa de e-mail ANTES de pedir o envio (caixa não ativada perde a mensagem)");
tudo &= ok(p1.navegou === "https://shopee.com.br/verify/link?token=abc", "abre o link do e-mail na própria aba");
// a Shopee devolve para o login mesmo assim: a senha NÃO sai de novo
const p2 = abrirPagina("/buyer/login");
for (let i = 0; i < 300 && !avisosIvs.some((a) => a.tipo === "precisa-humano"); i++) await new Promise((r) => setTimeout(r, 10));
tudo &= ok(senhasPedidas === 2 && avisosIvs.filter((a) => a.tipo === "login-iniciado").length === 1,
  "segunda ida ao login: a senha é negada, o robô não entra de novo (antes: 6 logins em 30 s)");
tudo &= ok(avisosIvs.some((a) => a.tipo === "precisa-humano"), "e vira \"precisa de você\", com a janela aberta");
void p2;

// Aba restaurada pelo perfil pega a senha e é fechada pela fila antes de
// entrar (conta 122, 21/10). A aba de verdade ainda tem direito à tentativa.
novoToken();
tudo &= ok(Boolean(entregarCredencial(122).senha), "aba restaurada pede a senha e é fechada antes de entrar…");
tudo &= ok(Boolean(entregarCredencial(122).senha), "…e a aba de verdade ainda recebe a senha (antes: negada)");
marcarTentativa(122);
let negada = false; try { entregarCredencial(122); } catch (e) { negada = e.repetida === true; }
tudo &= ok(negada, "depois que um login COMEÇOU, a próxima senha da rodada é negada");

console.log(tudo ? "\n\x1b[32m\x1b[1m  login em fila: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  login em fila: FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
