// O que o Matheus trouxe em 22/10/2026, depois da rodada de 2 dias juntos.
//
// 1. Conferência com pedido de 2 dias atrás já resolvido: o que está
//    atendido na Shopify sai sozinho (e no botão "Conferir na Shopify e limpar").
// 2. Senha errada numa conta só (232): o alerta é da conta, não "a senha das
//    contas"; e "Tentar de novo a conta 232" põe a conta de volta na fila
//    DESTA rodada.
// 3. O e-mail de verificação que não chega: o robô continua olhando a caixa
//    ~10 min, e se não chegar a conta volta para o fim da fila, uma vez.
//
// Tudo de verdade, menos a Shopify, a Shopee e o AdsPower: a carteira, a
// ponte do app, o coletor por HTTP, a fila, e o extensao/login.js rodando
// numa página de "Verificar Identidade" de mentira.
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";

const dir = mkdtempSync(join(tmpdir(), "esteira-2210-"));
process.env.TRABALHO_DIR = dir; process.env.ESTADO_DIR = join(dir, "estado");
process.env.REGISTRO_ESCRITAS = join(dir, "escritas.json");
process.env.SHOPIFY_CONEXAO_ARQUIVO = join(dir, "conexao.json");
process.env.RECURSOS_DIR = fileURLToPath(new URL("..", import.meta.url));
process.env.SHOPEE_SENHA = "s"; process.env.SHOPEE_PREFIXO = "c"; process.env.SHOPEE_EMAIL_DOMINIO = "x.com";
process.env.PAUSA_REPETIR_MS = "30"; process.env.PAUSA_EMAIL_MS = "200";
writeFileSync(process.env.SHOPIFY_CONEXAO_ARQUIVO, JSON.stringify({ loja: "t.myshopify.com", modo: "token-fixo", accessToken: "x" }));

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

// ── a loja de mentira: cada pedido com a sua situação ──
const SITUACAO = {
  "165001": "FULFILLED",            // colado à mão na Shopify, 2 dias atrás
  "165002": "UNFULFILLED",          // continua precisando
  "165003": "PARTIALLY_FULFILLED",  // parcial: pode faltar rastreio, fica
  "165004": "FULFILLED",            // adiado para amanhã, mas já atendido
};
let consultas = 0, mutacoes = 0;
const fetchDeVerdade = globalThis.fetch;
globalThis.fetch = async (url, opcoes = {}) => {
  const corpo = JSON.parse(opcoes.body ?? "{}");
  const resp = (data) => new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
  if (/fulfillmentCreateV2/.test(corpo.query)) { mutacoes++; return resp({ fulfillmentCreateV2: { userErrors: [], fulfillment: { id: "gid://F/1", status: "SUCCESS", trackingInfo: [{ number: "BR1", url: "", company: "Correios" }] } } }); }
  consultas++;
  const nums = [...String(corpo.variables?.q ?? "").matchAll(/name:(\d+)/g)].map((m) => m[1]);
  return resp({ orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: nums.map((n) => ({
    name: "#" + n, id: "gid://O/" + n, createdAt: "2026-10-20T10:00:00Z", displayFulfillmentStatus: SITUACAO[n] ?? "UNFULFILLED",
    shippingAddress: { name: "Cliente Teste", zip: "01000000" }, totalPriceSet: { shopMoney: { amount: "1" } },
    lineItems: { nodes: [] }, fulfillmentOrders: { nodes: [{ id: "gid://FO/" + n, status: SITUACAO[n] === "FULFILLED" ? "CLOSED" : "OPEN" }] } })) } });
};

const { guardarPendentes, pendentesAbertos, adiarPendente } = await import("../src/estado.mjs");
const motivo = { codigo: "ambiguo", grupo: "precisa" };
const naCarteira = (n) => pendentesAbertos({ hoje: "9999-12-31" }).some((p) => p.pedido === `Pedido #${n}`);

sec("1. Conferência: o que já está atendido na Shopify sai");
{
  guardarPendentes(["165001", "165002", "165003", "165004"].map((n) =>
    ({ pedido: `Pedido #${n}`, conta: 130, nome: "Cliente Teste", valor: 10, motivo })));
  adiarPendente("Pedido #165004", "2026-10-23");
  const { construir } = await import("../aplicativo/ponte.mjs");
  const ponte = construir({});
  const des = (r) => (r && "ok" in r && "dado" in r ? r.dado : r);
  const r = des(await ponte["conferencia:limparShopify"]({}));
  const sairam = r.sairam.map((x) => x.pedido).sort().join(", ");
  tudo &= ok(sairam === "Pedido #165001, Pedido #165004", `saíram os 2 atendidos, o adiado também (${sairam})`);
  tudo &= ok(naCarteira(165002) && naCarteira(165003), "ficam o que não foi atendido e o parcial");
  tudo &= ok(consultas === 1, `uma consulta só à Shopify para a carteira inteira (${consultas})`);
  tudo &= ok(mutacoes === 0, "nada escrito na Shopify: só leitura");
  // Desfazer devolve
  des(await ponte["conferencia:desfazer"]({ pedido: "Pedido #165001" }));
  tudo &= ok(naCarteira(165001), "\"Desfazer\" devolve o pedido à conferência");
  const r2 = des(await ponte["conferencia:limparShopify"]({}));
  tudo &= ok(r2.sairam.length === 1 && !naCarteira(165001), "e limpar de novo tira de novo");
  const r3 = des(await ponte["conferencia:limparShopify"]({}));
  tudo &= ok(r3.sairam.length === 0, "nada mais para limpar: a segunda vez não tira nada");

  // a etapa 4 também: pedido já atendido sai da carteira, não fica "pulado" para sempre
  const { escreverRastreios } = await import("../src/escrita.mjs");
  const res = await escreverRastreios([{ conta: 130, pedidos: [{ pedido: "Pedido #165004", nome: "Cliente Teste", valor: 10 }] }],
    new Map([[130, [{ nome: "Cliente Teste", valor: 10, codigos: ["BR123456789BR"], cep: "01000000" }]]]),
    { escrever: true, conexao: { loja: "t.myshopify.com", modo: "token-fixo", accessToken: "x" } });
  tudo &= ok(res.jaAtendidos?.join() === "Pedido #165004" && mutacoes === 0,
    `a escrita devolve o já atendido em "jaAtendidos" (${res.jaAtendidos?.join()}), sem escrever de novo`);
}

sec("2. Senha errada numa conta só (232)");
{
  const { iniciarColetor } = await import("../src/coletor.mjs");
  const { novoToken } = await import("../src/credenciais.mjs");
  const { lerAlertas } = await import("../src/alertas.mjs");
  const coletor = await iniciarColetor({ porta: 3921 });
  const evento = (m) => fetchDeVerdade("http://127.0.0.1:3921/", { method: "POST", body: JSON.stringify(m) })
    .then(() => new Promise((r) => setTimeout(r, 30)));
  const alerta = (id) => lerAlertas().find((a) => a.id === id);

  novoToken();
  await evento({ tipo: "login-ok", conta: "120" });
  await evento({ tipo: "login-falhou", conta: "232", motivo: "a Shopee respondeu: senha inválida" });
  const a = alerta("conta-senha-232");
  tudo &= ok(a && /diferente da padrão/.test(a.titulo), `alerta da conta: "${a?.titulo}"`);
  tudo &= ok(JSON.stringify(a?.rerodar) === "[232]" && a.rotuloRerodar === "Tentar de novo a conta 232",
    "com o botão \"Tentar de novo a conta 232\"");
  tudo &= ok(/troque a senha para a padrão/.test(a?.acao ?? ""), "e diz o que fazer: entrar na conta e trocar para a padrão");
  tudo &= ok(!alerta("shopee-senha"), "sem o alerta geral \"a senha das contas\" (outra conta entrou com ela)");
  await evento({ tipo: "coleta", conta: "232", pedidos: [], duracaoMs: 1 });
  tudo &= ok(!alerta("conta-senha-232"), "a conta foi lida depois: o alerta se resolve sozinho");

  // rodada nova, ninguém entrou, duas recusadas: aí sim a senha de Ajustes
  novoToken();
  await evento({ tipo: "login-falhou", conta: "11", motivo: "a Shopee respondeu: senha inválida" });
  tudo &= ok(!alerta("shopee-senha"), "uma recusada só, sem ninguém ter entrado ainda: alerta só da conta");
  await evento({ tipo: "login-falhou", conta: "12", motivo: "a Shopee respondeu: senha inválida" });
  tudo &= ok(alerta("shopee-senha")?.ir === "ajustes", "duas recusadas e ninguém entrou: alerta geral, levando a Ajustes");
  await evento({ tipo: "login-ok", conta: "13" });
  tudo &= ok(!alerta("shopee-senha"), "uma conta entrou com a senha: o alerta geral se desfaz");
  await coletor.fechar();
}

sec("2b. \"Tentar de novo a conta 232\" com a rodada rodando");
{
  const { rodarFila, repetirNaRodada } = await import("../src/fila.mjs");
  const { entregarCredencial, marcarTentativa, liberarLogin } = await import("../src/credenciais.mjs");
  let vezes232 = 0, ordem = [];
  let corrigida = false;
  const processar = async (c) => {
    ordem.push(c.conta);
    if (c.conta === 232) {
      vezes232++;
      // o login.js pede a senha e começa o login
      try { entregarCredencial(232); } catch { throw new Error("credencial negada"); }
      marcarTentativa(232);
      if (!corrigida) throw new Error("conta 232: o login automático falhou — a Shopee respondeu: senha inválida");
      return "/tmp/x.json";
    }
    await new Promise((r) => setTimeout(r, c.conta === 300 ? 600 : 20));
    return "/tmp/x.json";
  };
  // 232 falha logo; a 300 demora — a rodada ainda está rodando
  const rodada = rodarFila([232, 120, 300].map((conta) => ({ conta, serial: conta })),
    { concorrencia: 1, pausaMin: 0, pausaMax: 0, processar });
  await new Promise((r) => setTimeout(r, 150));
  liberarLogin(232); marcarTentativa(232);   // os dois logins da rodada já gastos
  tudo &= ok(repetirNaRodada(120) === "nao-falhou", "conta que não falhou não volta");
  corrigida = true;                           // o Matheus trocou a senha à mão
  tudo &= ok(repetirNaRodada(232) === "na-fila", "a 232 volta para a fila desta rodada");
  tudo &= ok(repetirNaRodada(232) === "ja-na-fila", "clicar duas vezes não põe duas vezes");
  const res = await rodada;
  const r232 = res.find((x) => x.conta === 232);
  tudo &= ok(r232?.ok === true && vezes232 === 2, `a 232 foi lida na 2ª tentativa (${r232?.ok ? "ok" : r232?.erro})`);
  tudo &= ok(ordem.join(" ") === "232 120 300 232", `no fim da fila (${ordem.join(" ")})`);
  tudo &= ok(res.filter((x) => x.conta === 232).length === 1, "uma linha só da 232 no resultado (a falha saiu)");
  tudo &= ok(repetirNaRodada(232) === "sem-rodada", "com a rodada terminada, o botão começa uma rodada nova (sem-rodada)");
}

sec("3. E-mail de verificação que não chega");
{
  const { tipoDaFalha, rodarFila } = await import("../src/fila.mjs");
  const MSG = "conta 167: o login automático falhou — o e-mail de verificação da Shopee não chegou (pedido às 22:01, reenviado às 22:05, desistiu às 22:11) — o e-mail com o link de verificação não chegou em 180 s (a caixa tem 3 mensagem(ns), 3 da Shopee).";
  tudo &= ok(tipoDaFalha(MSG) === "passageira", "é falha passageira (antes: \"precisa de você\", sem tentar de novo)");
  // 2 tentativas, com a pausa longa entre elas
  const vezes = {}; const marcas = [];
  const processar = async (c) => {
    vezes[c.conta] = (vezes[c.conta] ?? 0) + 1; marcas.push([c.conta, Date.now()]);
    if (c.conta === 167) throw new Error(MSG);
    return "/tmp/x.json";
  };
  const res = await rodarFila([167, 168].map((conta) => ({ conta, serial: conta })), { concorrencia: 1, pausaMin: 0, pausaMax: 0, processar });
  tudo &= ok(vezes[167] === 2, `tentou 2 vezes, não 3 (${vezes[167]}) — a 3ª pediria um 3º login`);
  const t = marcas.filter((m) => m[0] === 167).map((m) => m[1]);
  tudo &= ok(t[1] - t[0] >= 190, `esperou a pausa do e-mail antes de tentar de novo (${t[1] - t[0]} ms ≥ 200)`);
  tudo &= ok(res.find((x) => x.conta === 167)?.ok === false && vezes[168] === 1, "falhou no fim dizendo por quê; a 168 seguiu normal");
}

sec("3b. O login.js na página \"Verificar Identidade\"");
{
  const FONTE = readFileSync(new URL("../extensao/login.js", import.meta.url), "utf8");
  const RAPIDO = 500;
  function pagina(respostasDoLink) {
    const avisos = [], pedidos = [];
    const loc = { pathname: "/verify/ivs", href: "https://shopee.com.br/verify/ivs" };
    const botaoEmail = { innerText: "Verificar via link por E-mail",
      click: () => { loc.pathname = "/verify/email-link"; } };
    const reenviar = { innerText: "Reenviar", click: () => avisos.push({ tipo: "clicou-reenviar" }), closest: () => reenviar };
    const doc = {
      title: "Shopee", body: { innerText: "Responda à notificação enviada por E-mail" },
      querySelector: (s) => (/aria-label/.test(s) && loc.pathname === "/verify/ivs" ? botaoEmail : null),
      querySelectorAll: () => (loc.pathname === "/verify/email-link" ? [reenviar] : []),
    };
    const armazenado = new Map();
    const chrome = { runtime: { sendMessage: (msg, responder) => {
      if (msg.pedido) pedidos.push(msg.pedido);
      if (msg.pedido === "login-ligado" || msg.pedido === "travar-login" || msg.pedido === "caixa") return responder?.({ ok: true });
      if (msg.pedido === "qual-conta") return responder?.({ conta: 167 });
      if (msg.pedido === "link") return setTimeout(() => responder(respostasDoLink.shift() ?? { erro: "o e-mail com o link de verificação não chegou em 180 s" }), 5);
      if (msg.pedido === "abrir-aba") { setTimeout(() => { loc.pathname = "/user/purchase"; }, 5); return responder?.({ ok: true }); }
      if (msg.tipo) avisos.push(msg);
    } } };
    const lento = (fn) => (f, t, ...a) => fn(f, Math.max(0, (t ?? 0) / RAPIDO), ...a);
    const ctx = { chrome, document: doc, location: loc, Object, Event: class {}, Promise, Date, Math, Number, String, Array, Set, Map, JSON, RegExp,
      setTimeout: lento(setTimeout), setInterval: lento(setInterval), clearInterval,
      sessionStorage: { getItem: (k) => armazenado.get(k) ?? null, setItem: (k, v) => armazenado.set(k, v), removeItem: (k) => armazenado.delete(k) } };
    ctx.globalThis = ctx;
    vm.createContext(ctx); vm.runInContext(FONTE, ctx);
    return { avisos, pedidos };
  }
  const esperarAte = async (fn, ms = 4000) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 10)); };
  const NAO = { erro: "o e-mail com o link de verificação não chegou em 180 s (a caixa tem 2 mensagem(ns), 2 da Shopee)." };

  // chega no 3º pedaço da espera (~minuto 7)
  let p = pagina([NAO, NAO, { link: "https://u1.ct.sendgrid.net/ls/click?upn=OK" }]);
  await esperarAte(() => p.avisos.some((a) => /login-ok|precisa-humano|login-falhou/.test(a.tipo)));
  tudo &= ok(p.avisos.some((a) => a.tipo === "verificacao-link-aberto") && p.avisos.some((a) => a.tipo === "login-ok"),
    "e-mail que chega no minuto 7: o robô abre o link e entra sozinho (antes: desistia aos 3 min)");
  tudo &= ok(p.avisos.some((a) => a.tipo === "clicou-reenviar"), "pediu à Shopee para reenviar, uma vez");
  tudo &= ok(!p.avisos.some((a) => a.tipo === "precisa-humano"), "sem \"precisa de você\" no meio");

  // nunca chega
  p = pagina([NAO, NAO, NAO, NAO]);
  await esperarAte(() => p.avisos.some((a) => /login-ok|precisa-humano|login-falhou/.test(a.tipo)));
  const links = p.pedidos.filter((x) => x === "link").length;
  const falhou = p.avisos.find((a) => a.tipo === "login-falhou");
  tudo &= ok(links === 3, `olha a caixa em 3 pedaços de 3 min (~10 min, o tempo da janela), nunca numa espera só (${links})`);
  tudo &= ok(falhou && /e-mail de verificação da Shopee não chegou \(pedido às \d\d:\d\d, reenviado às \d\d:\d\d, desistiu às \d\d:\d\d\)/.test(falhou.motivo),
    `desiste dizendo os horários: "${falhou?.motivo?.slice(0, 95)}…"`);
  tudo &= ok(!p.avisos.some((a) => a.tipo === "precisa-humano"), "como falha (a fila tenta de novo), não \"precisa de você\"");
}

console.log(tudo ? "\n\x1b[32m\x1b[1m  feedback de 22/10: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  feedback de 22/10: FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
