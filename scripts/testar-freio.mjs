// O freio dos logins — diagnóstico do Matheus, rodada de 21/10/2026.
//
// Depois de ~35 verificações numa hora, os e-mails da Shopee passaram a
// chegar com 15-30 min de atraso ou nunca (53 de 74 falharam das 19h30 às
// 22h30; 19 de 19 certas às 23h). Aqui:
//   1. ritmo: no máximo 25 logins por hora;
//   2. freio: 2 e-mails seguidos que não chegam pausam os logins 45 min, e
//      depois uma conta de teste decide se volta ao normal;
//   3. o coletor, a extensão e a fila respeitando o freio, de verdade;
//   4. as contas que precisavam de login na última vez vão para o fim da fila.
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";

const dir = mkdtempSync(join(tmpdir(), "esteira-freio-"));
process.env.TRABALHO_DIR = dir; process.env.ESTADO_DIR = join(dir, "estado");
process.env.RECURSOS_DIR = fileURLToPath(new URL("..", import.meta.url));
process.env.SHOPEE_SENHA = "s"; process.env.SHOPEE_PREFIXO = "c"; process.env.SHOPEE_EMAIL_DOMINIO = "givmail.com";
process.env.RAPIDAPI_KEY = "chave-de-teste";

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;
const MIN = 60_000, HORA = 60 * MIN;

const F = await import("../src/freio-email.mjs");

sec("1. Ritmo: no máximo 25 logins por hora");
{
  F.zerarFreio();
  const t0 = Date.parse("2026-10-21T21:30:00Z");   // 18h30 em Brasília
  let liberados = 0, primeiroNegado = null;
  // a rodada de 21/10: uma conta pedindo login a cada ~90 s
  for (let i = 0; i < 40; i++) {
    const agora = t0 + i * 90_000;
    const r = F.podeLogar(100 + i, agora);
    if (r.ok) { F.registrarLogin(agora); liberados++; } else if (!primeiroNegado) primeiroNegado = { i, ...r };
  }
  tudo &= ok(liberados === 25, `40 contas pedindo login em 1 hora: 25 logam (${liberados})`);
  tudo &= ok(primeiroNegado?.ate === t0 + HORA && /logins na última hora/.test(primeiroNegado.motivo),
    `a 26ª espera até o 1º login fazer 1 hora (${new Date(primeiroNegado?.ate ?? 0).toISOString().slice(11, 16)} UTC)`);
  tudo &= ok(F.podeLogar(999, t0 + HORA + 1).ok, "passada a hora, volta a logar");
}

sec("2. Freio: 2 e-mails seguidos que não chegam");
{
  F.zerarFreio();
  const t = Date.parse("2026-10-21T22:30:00Z");
  tudo &= ok(F.emailNaoChegou(t).freou === false && F.podeLogar(1, t).ok, "1 e-mail que não chegou: segue (pode ser só aquela conta)");
  tudo &= ok(F.emailChegou() && F.situacaoDoFreio(t).seguidos === 0, "um que chega zera a conta");
  F.emailNaoChegou(t);
  const r = F.emailNaoChegou(t + MIN);
  tudo &= ok(r.freou && r.ate === t + MIN + 45 * MIN, "2 seguidos: freia por 45 min");
  const n = F.podeLogar(2, t + 10 * MIN);
  tudo &= ok(!n.ok && /pararam de chegar/.test(n.motivo) && n.ate === r.ate, "durante o freio, nenhum login novo");
  // passou a pausa: uma conta de teste
  const depois = r.ate + 1000;
  tudo &= ok(F.podeLogar(3, depois).ok, "passou a pausa: a 1ª conta vira a de teste");
  const outra = F.podeLogar(4, depois + 1000);
  tudo &= ok(!outra.ok && /conta 3 está testando/.test(outra.motivo), "as outras esperam o teste");
  tudo &= ok(F.podeLogar(3, depois + 2000).ok, "a de teste pode pedir de novo (renovar a vez)");
  // o e-mail da de teste não chegou: freia de novo, direto
  const r2 = F.emailNaoChegou(depois + 10 * MIN);
  tudo &= ok(r2.freou && !F.podeLogar(5, depois + 11 * MIN).ok, "o da conta de teste não chegou: freia de novo, sem esperar 2");
  // a de teste seguinte recebe: volta ao normal
  F.podeLogar(6, r2.ate + 1000);
  tudo &= ok(F.emailChegou().soltou === true, "o da conta de teste chegou: o freio solta");
  tudo &= ok(F.podeLogar(7, r2.ate + 2000).ok && F.podeLogar(8, r2.ate + 3000).ok, "e todas voltam a logar");
  // o estado sobrevive a o app reabrir
  F.emailNaoChegou(t); F.emailNaoChegou(t);
  const arq = JSON.parse(readFileSync(join(dir, "estado", "freio-email.json"), "utf8"));
  tudo &= ok(arq.freadoAte > t, "o freio fica em arquivo: reabrir o app não solta a pausa");
  F.zerarFreio();
}

sec("3. O coletor de verdade: a trava de login respeita o freio");
{
  const { iniciarColetor } = await import("../src/coletor.mjs");
  const { novoToken } = await import("../src/credenciais.mjs");
  const { donoAtual, limparTrava } = await import("../src/trava-login.mjs");
  const { lerAlertas } = await import("../src/alertas.mjs");
  const fetchDeVerdade = globalThis.fetch;
  // RapidAPI de mentira: o e-mail de verificação real (limpo) na caixa
  const EMAIL = readFileSync(new URL("./fixtures/email-shopee-verificacao.html", import.meta.url), "utf8");
  let caixa = [];
  globalThis.fetch = async (url, opcoes = {}) => {
    const u = String(url);
    if (!u.includes("rapidapi.com")) return fetchDeVerdade(url, opcoes);
    const resp = (c) => new Response(JSON.stringify(c), { status: 200, headers: { "content-type": "application/json", date: new Date().toUTCString() } });
    if (u.includes("/messages/")) return resp({ html: EMAIL });
    if ((opcoes.method ?? "GET") === "POST") return resp({ ok: true });
    return resp(caixa);
  };
  const coletor = await iniciarColetor({ porta: 3941 });
  novoToken(); limparTrava(); F.zerarFreio();
  const cred = await import("../src/credenciais.mjs");
  const token = readFileSync(join(cred.extensaoDaConta(1), "sessao.js"), "utf8").match(/COLETOR_TOKEN = "([^"]+)"/)[1];
  const trava = (conta) => fetchDeVerdade(`http://127.0.0.1:3941/trava-login?conta=${conta}&token=${token}`).then((r) => r.json());
  const soltar = (conta) => fetchDeVerdade(`http://127.0.0.1:3941/trava-login?conta=${conta}&token=${token}&acao=soltar`).then((r) => r.json());
  const evento = (m) => fetchDeVerdade("http://127.0.0.1:3941/", { method: "POST", body: JSON.stringify(m) }).then(() => new Promise((r) => setTimeout(r, 40)));
  const alerta = () => lerAlertas().find((a) => a.id === "freio-email");

  let r = await trava(222);
  tudo &= ok(r.meu === true && F.situacaoDoFreio().loginsNaHora === 1, "login novo: ganha a vez e conta 1 login na hora");
  await trava(222);
  tudo &= ok(F.situacaoDoFreio().loginsNaHora === 1, "renovar a vez no meio do login não conta outro");
  // o e-mail da 222 e o da 223 não chegam (a mensagem final do login.js)
  const NAO = "o e-mail de verificação da Shopee não chegou (pedido às 19:54, reenviado às 19:57, desistiu às 20:05) — o e-mail com o link de verificação não chegou em 180 s";
  await evento({ tipo: "login-falhou", conta: "222", motivo: NAO }); await soltar(222);
  tudo &= ok(!alerta(), "1 que não chegou: sem alerta");
  await trava(223);
  await evento({ tipo: "login-falhou", conta: "223", motivo: NAO }); await soltar(223);
  tudo &= ok(/pararam de chegar/.test(alerta()?.titulo ?? "") && /pausados até \d\d:\d\d/.test(alerta()?.texto ?? ""),
    `2 seguidos: alerta "${alerta()?.titulo}"`);
  r = await trava(224);
  tudo &= ok(r.meu === false && r.adiar === true && /volta às \d\d:\d\d/.test(r.motivo) && donoAtual() === null,
    "a 224 pede a vez: recusada com \"adiar\", e a trava fica livre");
  // o freio passou; a conta de teste recebe o e-mail pelo coletor (/link de verdade)
  const s = JSON.parse(readFileSync(join(dir, "estado", "freio-email.json"), "utf8"));
  s.freadoAte = Date.now() - 1000; writeFileSync(join(dir, "estado", "freio-email.json"), JSON.stringify(s));
  r = await trava(225);
  tudo &= ok(r.meu === true, "passada a pausa: a 225 loga como conta de teste");
  caixa = [];
  await fetchDeVerdade(`http://127.0.0.1:3941/caixa?conta=225&token=${token}`);
  caixa = [{ uid: "v1", created_at_epoch: Math.floor(Date.now() / 1000), subject: "Verificação necessária", from: '"Shopee" <info@security.shopee.com.br>' }];
  const l = await fetchDeVerdade(`http://127.0.0.1:3941/link?conta=225&token=${token}`).then((x) => x.json());
  tudo &= ok(/sendgrid/.test(l.link ?? ""), "o link chega pelo coletor");
  tudo &= ok(!alerta() && !F.situacaoDoFreio().freadoAte, "e o freio solta sozinho, com o alerta");
  await soltar(225);
  await coletor.fechar();
  globalThis.fetch = fetchDeVerdade;
}

sec("4. O login.js: com o freio, não pede a senha nem clica em nada");
{
  const FONTE = readFileSync(new URL("../extensao/login.js", import.meta.url), "utf8");
  for (const pagina of ["/buyer/login", "/verify/ivs"]) {
    const avisos = [], pedidos = [];
    const loc = { pathname: pagina, href: "https://shopee.com.br" + pagina };
    const chrome = { runtime: { sendMessage: (msg, responder) => {
      if (msg.pedido) pedidos.push(msg.pedido);
      if (msg.pedido === "login-ligado") return responder?.({ ok: true });
      if (msg.pedido === "travar-login") return responder?.({ ok: false, adiar: true, ate: 1, motivo: "logins pausados (volta às 20:45)" });
      if (msg.pedido === "qual-conta") return responder?.({ conta: 224 });
      if (msg.tipo) avisos.push(msg);
      responder?.({});
    } } };
    const doc = { title: "", body: { innerText: "" }, querySelector: () => null, querySelectorAll: () => [] };
    const ctx = { chrome, document: doc, location: loc, Object, Event: class {}, Promise, Date, Math, Number, String, Array, Set, Map, JSON, RegExp,
      setTimeout: (f, t) => setTimeout(f, Math.min(t ?? 0, 5)), setInterval: () => 0, clearInterval: () => {},
      sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
    ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(FONTE, ctx);
    const t0 = Date.now(); while (!avisos.some((a) => a.tipo === "login-adiado") && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 10));
    const a = avisos.find((x) => x.tipo === "login-adiado");
    tudo &= ok(a && a.ate === 1 && /20:45/.test(a.motivo), `${pagina}: avisa "login-adiado" com a hora de voltar`);
    tudo &= ok(!pedidos.includes("credencial") && !pedidos.includes("caixa") && !pedidos.includes("link"),
      `${pagina}: não pede senha, não ativa a caixa, não pede e-mail (${pedidos.join(", ")})`);
  }
}

sec("5. A fila: conta adiada volta depois, sem virar falha");
{
  const { rodarFila, prazoDaConta, pedirParada } = await import("../src/fila.mjs");
  const { aoEvento, limparOuvintes } = await import("../src/eventos.mjs");
  const p = prazoDaConta({ comecou: 0, agora: 1000, timeoutMs: 150_000, marca: { tipo: "login-adiado", motivo: "logins pausados", em: 500, ate: 99_000 } });
  tudo &= ok(/login adiado/.test(p.desistir) && p.adiarAte === 99_000, "a marca \"login-adiado\" faz a fila soltar a conta, com a hora de voltar");
  const eventos = []; aoEvento((e) => eventos.push(e));
  const ordem = []; let vezes224 = 0;
  const processar = async (c) => {
    ordem.push(c.conta);
    if (c.conta === 224 && ++vezes224 === 1)
      throw Object.assign(new Error("conta 224: login adiado — logins pausados"), { adiarAte: Date.now() + 300 });
    await new Promise((r) => setTimeout(r, 20));
    return "/tmp/x.json";
  };
  const t0 = Date.now();
  const res = await rodarFila([224, 120, 133].map((conta) => ({ conta, serial: conta })), { concorrencia: 1, pausaMin: 0, pausaMax: 0, processar });
  tudo &= ok(res.every((x) => x.ok) && res.length === 3, `as 3 lidas, a 224 depois da pausa (${ordem.join(" ")})`);
  tudo &= ok(res.find((x) => x.conta === 224).tentativas === 1, "a adiada não gastou tentativa");
  tudo &= ok(eventos.some((e) => e.tipo === "conta:adiada" && e.conta === 224 && e.ate) && !eventos.some((e) => e.tipo === "conta:falhou"),
    "a tela recebe \"conta:adiada\", e nenhuma falha");
  tudo &= ok(Date.now() - t0 >= 290, "esperou a hora de voltar");
  // parar no meio: a adiada aparece como não lida (com o botão de tentar de novo), não some
  const processar2 = async (c) => {
    if (c.conta === 224) throw Object.assign(new Error("conta 224: login adiado — logins pausados"), { adiarAte: Date.now() + 60_000 });
    pedirParada(); return "/tmp/x.json";
  };
  const res2 = await rodarFila([224, 120].map((conta) => ({ conta, serial: conta })), { concorrencia: 1, pausaMin: 0, pausaMax: 0, processar: processar2 });
  tudo &= ok(res2.some((x) => x.conta === 224 && x.ok === false && /login adiado/.test(x.erro)), "parada pedida: a adiada aparece como não lida, não some");
  // a que esperava a 2ª tentativa também (antes: sumia do resultado e do alerta)
  process.env.PAUSA_REPETIR_MS = "60000";
  let vezes = 0;
  const processar3 = async (c) => {
    if (c.conta === 130) throw new Error("conta 130: nada chegou ao coletor em 150s");
    if (++vezes === 1) setTimeout(pedirParada, 50);
    await new Promise((r) => setTimeout(r, 100));
    return "/tmp/x.json";
  };
  const res3 = await rodarFila([130, 131].map((conta) => ({ conta, serial: conta })), { concorrencia: 1, pausaMin: 0, pausaMax: 0, processar: processar3 });
  const r130 = res3.find((x) => x.conta === 130);
  tudo &= ok(r130?.ok === false && /nada chegou/.test(r130.erro) && r130.tentativas === 1,
    "parada pedida: a que esperava a 2ª tentativa aparece como não lida, com o erro dela");
  limparOuvintes();
}

sec("6. Quem precisou de login na última vez vai para o fim da fila");
{
  const { ordenarParaFila } = await import("../src/fila.mjs");
  const { loginDaConta, coletaDaConta, DIR_LOGIN, DIR_COLETAS } = await import("../src/caminhos.mjs");
  mkdirSync(DIR_LOGIN, { recursive: true }); mkdirSync(DIR_COLETAS, { recursive: true });
  const marca = (c, tipo, em) => writeFileSync(loginDaConta(c), JSON.stringify({ tipo, em }));
  const coleta = (c, ms) => { writeFileSync(coletaDaConta(c), "{}"); utimesSync(coletaDaConta(c), ms / 1000, ms / 1000); };
  const agora = Date.now();
  marca(501, "login-ok", agora - HORA);                         // o robô logou e deu certo
  marca(502, "precisa-humano", agora - HORA);                   // não entrou, e não foi lida depois
  marca(503, "precisa-humano", agora - 2 * HORA); coleta(503, agora - HORA);   // alguém resolveu: foi lida depois
  marca(505, "login-falhou", agora - HORA);                     // não entrou
  const ordem = ordenarParaFila([501, 502, 503, 504, 505].map((conta) => ({ conta }))).map((c) => c.conta);
  tudo &= ok(ordem.join(" ") === "501 503 504 502 505",
    `sessão viva primeiro, as que não entraram no fim (${ordem.join(" ")})`);
}

console.log(tudo ? "\n\x1b[32m\x1b[1m  freio dos logins: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  freio dos logins: FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
