// A rodada de 21/10/2026, contas 125 e 150 — e por que não pode repetir.
//
// O que aconteceu: a sessão da Shopee dessas duas contas tinha caído. A
// Shopee respondeu de um jeito que o coletor não reconhecia como "não
// logado" (403 com is_login:false; ou a página /verify/traffic/error com
// error 90309999). O coletor publicou isso como uma coleta com ZERO pedidos,
// a conferência acusou os 12 pedidos de "não achado na conta", e ninguém
// tentou fazer login. Três falhas em cadeia:
//
//   1. o coletor não reconhecia a sessão caída nessas formas novas
//   2. coleta sem nenhuma lista respondendo virava "a conta não tem pedidos"
//   3. conta sem coleta sumia da rodada; e a coleta de um dia velho podia
//      responder pela de hoje
//
// Os testes usam as respostas REAIS da Shopee daquela rodada
// (scripts/fixtures/coleta-sessao-caida-*.json — só códigos de erro, nenhum
// dado de cliente) e rodam o código de verdade: o extensao/coleta.js num
// navegador de mentira, e a conciliação/escrita do robô.
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";

const dir = mkdtempSync(join(tmpdir(), "esteira-sessao-"));
process.env.ESTADO_DIR = join(dir, "estado");
process.env.TRABALHO_DIR = dir;

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

const REAL_125 = JSON.parse(readFileSync(new URL("./fixtures/coleta-sessao-caida-125.json", import.meta.url)));
const REAL_150 = JSON.parse(readFileSync(new URL("./fixtures/coleta-sessao-caida-150.json", import.meta.url)));
const FONTE = readFileSync(new URL("../extensao/coleta.js", import.meta.url), "utf8");

// ── um navegador de mentira para o extensao/coleta.js ────────────────────
// `respostas(caminho)` decide o que a "Shopee" devolve. O script roda inteiro
// (setTimeout imediato), e o teste olha o que ele publicou e para onde foi.
async function rodarColeta({ url, respostas, sessao = {} }) {
  const publicados = [];
  const loc = new URL(url);
  const location = {
    get href() { return loc.href; },
    set href(v) { location.navegouPara = v; },
    get pathname() { return loc.pathname; },
    get hash() { return loc.hash; },
    navegouPara: null,
  };
  const storage = {
    getItem: (k) => (k in sessao ? sessao[k] : null),
    setItem: (k, v) => { sessao[k] = String(v); },
    removeItem: (k) => { delete sessao[k]; },
  };
  let vivos = 0;
  const ctx = {
    window: { postMessage: (m) => publicados.push(m.payload) },
    location, sessionStorage: storage, self: {},
    document: { querySelector: () => null },
    // relógio real, sem esperar: a coleta pausa 200 ms entre páginas e 6 s
    // antes de começar — aqui tudo vira 0, mas na ordem certa
    setTimeout: (fn) => { vivos++; return setTimeout(async () => { try { await fn(); } finally { vivos--; } }, 0); },
    fetch: async (caminho) => {
      const r = respostas(caminho);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.corpo };
    },
    URLSearchParams, Promise, Set, Map, JSON, Math, Date, String, Number, Object, Array,
  };
  vm.createContext(ctx);
  vm.runInContext(FONTE, ctx);
  // espera o script terminar tudo o que agendou (coleta, pausas, ida ao login)
  for (let i = 0; i < 2000; i++) {
    await new Promise((r) => setTimeout(r, 2));
    if (vivos === 0) break;
  }
  return { publicados, navegouPara: location.navegouPara, sessao };
}

// devolve, para cada chamada, o corpo que a Shopee REAL devolveu naquela rodada
const comoNaRodada = (real) => (caminho) => {
  const l = real.listas.find((x) => caminho.startsWith(x.caminho.split("?")[0])) ?? real.listas[0];
  return { status: l.status, corpo: l.corpo };
};

sec("1 · o coletor reconhece a sessão caída como ela chegou na rodada");
{
  const r = await rodarColeta({ url: "https://shopee.com.br/user/purchase?type=7#conta=150",
                                respostas: comoNaRodada(REAL_150) });
  const t = r.publicados.map((p) => p.tipo);
  tudo &= ok(!t.includes("coleta"),
    "conta 150 (403 · is_login:false): NÃO publica uma coleta de zero pedidos");
  tudo &= ok(t.includes("nao-autenticado"), "publica 'não autenticado'");
  tudo &= ok(/\/buyer\/login\?next=/.test(r.navegouPara ?? ""),
    "e vai para a página de login, onde o login automático age");
  tudo &= ok(r.sessao["esteira-foi-ao-login"] === "1", "marcando que já foi ao login nesta aba");
}
{
  const r = await rodarColeta({ url: "https://shopee.com.br/verify/traffic/error?is_logged_in=false&type=4",
                                respostas: comoNaRodada(REAL_125) });
  const t = r.publicados.map((p) => p.tipo);
  tudo &= ok(!t.includes("coleta"),
    "conta 125 (/verify/traffic · error 90309999): NÃO publica uma coleta de zero pedidos");
  tudo &= ok(t.includes("nao-autenticado") && /verificação de tráfego/.test(r.publicados[0]?.motivo ?? ""),
    "publica 'não autenticado' dizendo que foi a página de verificação de tráfego");
  tudo &= ok(/\/buyer\/login/.test(r.navegouPara ?? ""), "e vai para o login");
}

sec("2 · se volta do login e continua bloqueada, para e chama uma pessoa");
{
  const r = await rodarColeta({ url: "https://shopee.com.br/user/purchase?type=7",
                                respostas: comoNaRodada(REAL_150),
                                sessao: { "esteira-foi-ao-login": "1" } });
  const t = r.publicados.map((p) => p.tipo);
  tudo &= ok(t.includes("precisa-humano") && /depois de entrar/.test(r.publicados[0]?.motivo ?? ""),
    "segunda vez sem sessão na mesma aba: 'precisa de você', sem tentar de novo");
  tudo &= ok(r.navegouPara === null, "e não fica indo e voltando do login (insistir piora o bloqueio)");
}

sec("3 · o que já funcionava continua funcionando");
{
  // a forma antiga de "não logado"
  const r = await rodarColeta({ url: "https://shopee.com.br/user/purchase?type=7",
    respostas: () => ({ status: 200, corpo: { error: 19, error_msg: "not authenticated" } }) });
  tudo &= ok(r.publicados.some((p) => p.tipo === "nao-autenticado"), "error 19 (o jeito antigo): ainda reconhecido");
}
{
  // coleta boa: uma lista com dois pedidos e o detalhe de cada um
  const lista = { error: 0, new_data: { order_or_checkout_data: [
    { order_list_detail: { info_card: { order_id: 245759000000001 } } },
    { order_list_detail: { info_card: { order_id: 245759000000002 } } } ] } };
  const detalhe = (id) => ({ error: 0, data: { order_id: id, address: { shipping_name: "Cliente Fictício" },
    tracking_number: "BR260000000001X" } });
  const sessao = { "esteira-foi-ao-login": "1" };   // voltou do login com sessão boa
  const r = await rodarColeta({ url: "https://shopee.com.br/user/purchase?type=7#conta=124", sessao,
    respostas: (c) => c.includes("get_order_detail")
      ? { status: 200, corpo: detalhe(Number(new URL("http://x" + c).searchParams.get("order_id"))) }
      : c.includes("offset=0") ? { status: 200, corpo: lista } : { status: 200, corpo: { error: 0, new_data: {} } } });
  const coleta = r.publicados.find((p) => p.tipo === "coleta");
  tudo &= ok(coleta && coleta.pedidos.length === 2, "sessão boa: publica a coleta com os pedidos (2)");
  tudo &= ok(coleta?.pedidos.every((p) => p.codigos.includes("BR260000000001X")), "com o rastreio de cada um");
  tudo &= ok(!("esteira-foi-ao-login" in sessao), "e limpa a marca do login (a próxima queda pode tentar de novo)");
}
{
  // nenhuma lista respondeu, mas não é sessão (Shopee fora do ar)
  const r = await rodarColeta({ url: "https://shopee.com.br/user/purchase?type=7",
    respostas: () => ({ status: 502, corpo: null }) });
  const t = r.publicados.map((p) => p.tipo);
  tudo &= ok(t.includes("coleta-falhou") && !t.includes("coleta"),
    "Shopee fora do ar (502): 'coleta falhou', não 'zero pedidos'");
}

sec("4 · a conferência: conta não lida NUNCA vira 'não achado na conta'");
const { lerColetas, conciliar, MOTIVOS } = await import("../src/conciliar.mjs");
const coletasDir = join(dir, "coletas");
mkdirSync(coletasDir, { recursive: true });
// exatamente os arquivos que o coletor gravou na máquina do Matheus
writeFileSync(join(coletasDir, "conta-125.json"), JSON.stringify(REAL_125));
writeFileSync(join(coletasDir, "conta-150.json"), JSON.stringify(REAL_150));
const planilha = [
  { conta: 125, pedidos: [1, 2, 3, 4, 5, 6].map((i) => ({ pedido: `#90${i}`, nome: `Cliente Fictício 12${i}`, valor: 10 + i })) },
  { conta: 150, pedidos: [1, 2, 3, 4, 5, 6].map((i) => ({ pedido: `#95${i}`, nome: `Cliente Fictício 15${i}`, valor: 20 + i })) },
  { conta: 199, pedidos: [{ pedido: "#999", nome: "Cliente Fictício 199", valor: 9 }] },   // nem chegou a coletar
];
const coletas = lerColetas(coletasDir);
tudo &= ok(coletas.get(125)?.falhou && coletas.get(150)?.falhou,
  "os arquivos reais de 125 e 150 são lidos como 'conta não lida', não 'conta sem pedidos'");
const { linhas } = conciliar(planilha, coletas);
const de = (c) => linhas.filter((l) => l.conta === c);
tudo &= ok(linhas.filter((l) => l.motivo?.codigo === "nao-achado-na-conta").length === 0,
  "nenhum dos 13 pedidos vira 'não achado na conta' (eram 12 na rodada)");
tudo &= ok(de(125).length === 6 && de(150).length === 6 && de(199).length === 1 &&
           linhas.every((l) => l.motivo?.codigo === "conta-nao-lida"),
  "os 13 aparecem, todos como 'conta não foi lida' — inclusive a conta que nem coletou");
tudo &= ok(MOTIVOS["conta-nao-lida"].grupo === "precisa" && /NÃO foram procurados/.test(MOTIVOS["conta-nao-lida"].texto),
  "e a tela diz que os pedidos NÃO foram procurados, e o que fazer");
tudo &= ok(de(125)[0].motivo.pagina?.includes("/verify/traffic"),
  "com a página em que a Shopee parou, para quem for investigar");

sec("5 · a escrita: pedido de conta não lida vai para a carteira, não some");
const { escreverRastreios } = await import("../src/escrita.mjs");
const res = await escreverRastreios(planilha, coletas, { escrever: false });
tudo &= ok(res.pendencias.length === 13, `os 13 viram pendência (vieram ${res.pendencias.length}) — antes, conta sem coleta sumia`);
tudo &= ok(res.planejado.length === 0, "e nada é planejado para escrever");

sec("6 · a fila: espera o login, e desiste na hora quando não vai dar");
const { prazoDaConta } = await import("../src/fila.mjs");
const comecou = 1_000_000, T = 150_000;
const p0 = prazoDaConta({ comecou, agora: comecou, timeoutMs: T, marca: null });
tudo &= ok(p0.limite === comecou + T && !p0.desistir, "sem aviso: o prazo normal (150s)");
const p1 = prazoDaConta({ comecou, agora: comecou + 140_000, timeoutMs: T,
  marca: { tipo: "otp-preenchido", em: comecou + 140_000 } });
tudo &= ok(p1.limite > comecou + T && !p1.desistir, "login em andamento: o prazo cresce a partir do último passo");
// precisa de uma pessoa: a janela fica aberta (10 min), não desiste na hora
const pH = prazoDaConta({ comecou, agora: comecou + 5000, timeoutMs: T, marca: { tipo: "precisa-humano", em: comecou + 4000 } });
tudo &= ok(!pH.desistir && pH.limite >= comecou + 4000 + 600_000,
  "'precisa-humano': a janela fica aberta 10 min para a pessoa resolver (antes fechava em 2 s)");
const pH2 = prazoDaConta({ comecou, agora: comecou + 4000 + 600_001, timeoutMs: T, marca: { tipo: "precisa-humano", em: comecou + 4000, motivo: "x" } });
tudo &= ok(/ninguém resolveu/.test(pH2.desistir ?? ""), "depois dos 10 min sem ninguém, desiste dizendo por quê");
for (const [tipo, frase] of [["login-falhou", /login automático falhou/],
                             ["coleta-falhou", /não leu nenhum pedido/], ["sessao-caida", /desligado/]]) {
  const p = prazoDaConta({ comecou, agora: comecou + 5000, timeoutMs: T, marca: { tipo, em: comecou + 4000, motivo: "x" } });
  tudo &= ok(frase.test(p.desistir ?? ""), `'${tipo}': desiste na hora, com o motivo`);
}
const pVelha = prazoDaConta({ comecou, agora: comecou + 5000, timeoutMs: T,
  marca: { tipo: "precisa-humano", em: comecou - 86_400_000 } });
tudo &= ok(!pVelha.desistir, "aviso de ontem não derruba a conta hoje (a marca nunca é apagada)");

sec("7 · nomes grudados na planilha");
const { normNome } = await import("../src/match.mjs");
tudo &= ok(normNome("Carlos EduardoMafraCavalcanti") === normNome("Carlos Eduardo Mafra Cavalcanti"),
  "'Carlos EduardoMafraCavalcanti' (conta 150) = 'Carlos Eduardo Mafra Cavalcanti'");
tudo &= ok(normNome("JoséRicardo") === normNome("José Ricardo"), "com acento também");
tudo &= ok(normNome("Isaías Luiz da cruz") === normNome("ISAIAS LUIZ DA CRUZ"), "caixa e acento continuam não importando");
tudo &= ok(normNome("Ana Paula") !== normNome("Ana") && normNome("Mc Donald") !== normNome("McDonald Silva"),
  "e não junta nomes diferentes");

sec("8 · a coleta velha não responde pela de hoje");
const fonteCiclo = readFileSync(new URL("../src/ciclo.mjs", import.meta.url), "utf8");
const antesDaFila = fonteCiclo.slice(0, fonteCiclo.indexOf("await rodarFila("));
tudo &= ok(/for \(const c of contas\) rmSync\(coletaDaConta\(c\.conta\)/.test(antesDaFila),
  "a rodada apaga a coleta anterior das contas que vai abrir ANTES de abrir");

console.log(tudo ? "\n\x1b[32m\x1b[1m  sessão caída não vira mais 'não achado'\x1b[0m\n"
                 : "\n\x1b[31m\x1b[1m  sessão caída ainda escapa\x1b[0m\n");
process.exit(tudo ? 0 : 1);
