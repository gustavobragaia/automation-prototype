// A caixa de e-mail na verificação da Shopee — conta 167, 21/10/2026.
//
// O e-mail com o link chegou às 16:01:38. O robô desistiu às 16:04 dizendo
// que "não chegou em 120s": ele aceitava só e-mail com horário DEPOIS do
// pedido, e o horário do pedido vinha do relógio do computador do cliente.
// Com o relógio adiantado, o e-mail que estava lá parecia velho.
//
// Aqui a RapidAPI é de mentira (com o cabeçalho Date do servidor, como a de
// verdade), o relógio é de mentira (para esperar 3 min em milissegundos), e
// o e-mail é o REAL da Shopee, limpo (scripts/fixtures/email-shopee-verificacao.html).
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "esteira-caixa-"));
process.env.TRABALHO_DIR = dir; process.env.ESTADO_DIR = join(dir, "estado");
process.env.RECURSOS_DIR = new URL("..", import.meta.url).pathname;
process.env.RAPIDAPI_KEY = "chave-de-teste";
process.env.SHOPEE_SENHA = "s"; process.env.SHOPEE_PREFIXO = "c"; process.env.SHOPEE_EMAIL_DOMINIO = "givmail.com";

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

const EMAIL = readFileSync(new URL("./fixtures/email-shopee-verificacao.html", import.meta.url), "utf8");
const NOVO_LOGIN = "<p>Detectamos um novo login na sua conta Shopee.</p>";
const LINK_CERTO = "https://u1.ct.sendgrid.net/ls/click?upn=CONFIRMAR";

// ── uma RapidAPI de mentira: a caixa, o relógio do servidor e a contagem ──
let caixa = [], corpos = {}, servidorMs = 0, chamadas = { listar: 0, ler: 0, ativar: 0 };
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (url, opcoes = {}) => {
  const u = String(url);
  if (!u.includes("rapidapi.com")) return fetchOriginal(url, opcoes);
  const resposta = (corpo) => new Response(JSON.stringify(corpo), { status: 200,
    headers: { "content-type": "application/json", date: new Date(servidorMs).toUTCString(),
               "x-ratelimit-requests-remaining": "4000", "x-ratelimit-requests-limit": "5000" } });
  if (u.includes("/messages/")) { chamadas.ler++; return resposta({ html: corpos[decodeURIComponent(u.split("/messages/")[1])] }); }
  if ((opcoes.method ?? "GET") === "POST") { chamadas.ativar++; return resposta({ ok: true }); }
  chamadas.listar++; return resposta(caixa);
};
const zerar = () => { caixa = []; corpos = {}; chamadas = { listar: 0, ler: 0, ativar: 0 }; };
const msg = (uid, epochS, assunto, html, de = '"Shopee" <info@security.shopee.com.br>') => {
  caixa.push({ uid, created_at_epoch: epochS, subject: assunto, from: de }); corpos[uid] = html;
};

// relógio de mentira: cada pausa avança o tempo; ganchos disparam em instantes
function relogioDeTeste(inicioMs) {
  let agora = inicioMs; const ganchos = [];
  return {
    agora: () => agora,
    pausa: async (ms) => { agora += ms; for (const g of ganchos.filter((g) => !g.feito && agora >= g.em)) { g.feito = true; g.fn(); } },
    em: (msDepois, fn) => ganchos.push({ em: inicioMs + msDepois, fn, feito: false }),
  };
}

const { esperarMensagem, extrairLink, fotoDaCaixa, desvioDoRelogio } = await import("../src/otp.mjs");
const caixaDe = "chompspee167@givmail.com";

sec("1. Conta 167: relógio do computador 2 min adiantado");
{
  zerar();
  const verdade = Date.parse("2026-10-21T19:00:00Z");      // hora certa (servidor)
  servidorMs = verdade;
  msg("antigo-1", verdade / 1000 - 3600, "Alerta de segurança: falha em tentativa de login", NOVO_LOGIN, '"Shopee" <info@mail.shopee.com.br>');
  const foto = await fotoDaCaixa(caixaDe);                  // a foto, antes do "Entrar"
  // o computador do cliente está 2 min ADIANTADO: o "desde" dele é 2 min no futuro
  const desdeDoCliente = Math.floor((verdade + 120_000) / 1000);
  const t = relogioDeTeste(verdade);
  t.em(20_000, () => msg("verifica-1", verdade / 1000 + 20, "Verificação necessária: nova tentativa de login em sua conta da Shopee", EMAIL));
  const r = await esperarMensagem(caixaDe, { antes: foto, desdeEpoch: desdeDoCliente, extrair: extrairLink,
    oQue: "o link", pausa: t.pausa, relogio: t.agora });
  tudo &= ok(r.achado === LINK_CERTO, "com a foto da caixa, o link é achado mesmo com o relógio 2 min adiantado");

  // como era na 0.1.6: só o filtro de horário, com o relógio do cliente
  zerar(); servidorMs = verdade;
  msg("verifica-1", verdade / 1000 + 20, "Verificação necessária: nova tentativa de login em sua conta da Shopee", EMAIL);
  const t2 = relogioDeTeste(verdade);
  let erro = null;
  try { await esperarMensagem(caixaDe, { antes: null, desdeEpoch: desdeDoCliente + 300, extrair: extrairLink,
          oQue: "o link", pausa: t2.pausa, relogio: t2.agora }); } catch (e) { erro = e; }
  tudo &= ok(erro?.naoChegou === true, "sem a foto, só pelo horário (como na 0.1.6): \"não chegou\" com o e-mail na caixa — o erro da 167");
}

sec("2. \"Novo login\" e \"falha em tentativa\" chegando antes do e-mail certo");
{
  zerar(); servidorMs = Date.now();
  const foto = await fotoDaCaixa(caixaDe);
  const t = relogioDeTeste(Date.now());
  t.em(10_000, () => msg("alerta-1", 1, "Alerta de Segurança: Novo login na sua conta Shopee", NOVO_LOGIN, '"Shopee" <info@mail.shopee.com.br>'));
  t.em(15_000, () => msg("falha-1", 2, "Alerta de segurança: falha em tentativa de login", NOVO_LOGIN, '"Shopee" <info@mail.shopee.com.br>'));
  t.em(70_000, () => msg("verifica-2", 3, "Verificação necessária: nova tentativa de login em sua conta da Shopee", EMAIL));
  const r = await esperarMensagem(caixaDe, { antes: foto, extrair: extrairLink, oQue: "o link", pausa: t.pausa, relogio: t.agora });
  tudo &= ok(r.achado === LINK_CERTO, "pula os dois alertas sem link e espera o certo (antes: desistia no 1º)");
  tudo &= ok(chamadas.ler === 3, `cada e-mail é aberto uma vez só (${chamadas.ler} aberturas para 3 e-mails)`);
}

sec("3. E-mail que demora: chega aos 150 s");
{
  zerar(); servidorMs = Date.now();
  const foto = await fotoDaCaixa(caixaDe);
  const t = relogioDeTeste(Date.now());
  t.em(150_000, () => msg("verifica-3", 3, "Verificação necessária", EMAIL));
  const r = await esperarMensagem(caixaDe, { antes: foto, extrair: extrairLink, oQue: "o link", pausa: t.pausa, relogio: t.agora });
  tudo &= ok(r.achado === LINK_CERTO, "achado (a espera vai até 3 min; antes eram 2)");
}

sec("4. E-mail que nunca chega: quanto gasta e o que diz");
{
  zerar();
  const verdade = Date.parse("2026-10-21T19:00:00Z");
  servidorMs = verdade;
  const foto = await fotoDaCaixa(caixaDe);
  const listarAntes = chamadas.listar;
  const t = relogioDeTeste(Date.now());
  // o servidor está 2 min ATRÁS do relógio daqui → este computador adiantado
  servidorMs = Date.now() - 120_000;
  let erro = null, consultas = 0;
  try { await esperarMensagem(caixaDe, { antes: foto, extrair: extrairLink, oQue: "o link", pausa: t.pausa, relogio: t.agora,
          aCadaConsulta: () => consultas++ }); } catch (e) { erro = e; }
  const gastas = chamadas.listar - listarAntes;
  tudo &= ok(erro?.naoChegou && gastas <= 13, `desiste em 3 min com ${gastas} consultas (máximo 13)`);
  tudo &= ok(/não chegou em 180 s/.test(erro?.message) && /a caixa tem 0 mensagem/.test(erro?.message), "diz quanto esperou e o que havia na caixa");
  tudo &= ok(/relógio deste computador está 1\d\d s adiantado/.test(erro?.message),
    `e diz que o relógio está adiantado (desvio medido: ${Math.round(desvioDoRelogio() / 1000)} s)`);
  tudo &= ok(consultas === gastas, `avisa a fila a cada consulta (${consultas}), para ela não fechar a janela`);
}

sec("5. A fila não fecha a janela durante uma espera longa (com reenvio, ~6 min)");
{
  const { prazoDaConta } = await import("../src/fila.mjs");
  const comecou = 0; let fechou = null;
  // marcas a cada 20 s, como a espera manda, por 6 minutos
  for (let t = 30_000; t <= 390_000; t += 1000) {
    const ultimaMarca = Math.floor((t - 30_000) / 20_000) * 20_000 + 30_000;
    const p = prazoDaConta({ comecou, agora: t, timeoutMs: 150_000, marca: { tipo: "verificacao-esperando-email", em: ultimaMarca } });
    if (p.desistir || t >= p.limite) { fechou = t; break; }
  }
  tudo &= ok(fechou === null, "nenhum momento em que a fila desista ou estoure o prazo");
  // sem as marcas (só o aviso do clique, como no rascunho): estoura antes do fim da espera
  const p = prazoDaConta({ comecou, agora: 30_000 + 190_000, timeoutMs: 150_000, marca: { tipo: "verificacao-email-pedida", em: 30_000 } });
  tudo &= ok(30_000 + 190_000 >= p.limite, "sem a marca a cada consulta, a fila estourava em 180 s, antes dos 190 s da espera (furo 2.B)");
}

sec("6. Uma foto da caixa por login (furo 2.C)");
{
  zerar(); servidorMs = Date.now();
  const { iniciarColetor } = await import("../src/coletor.mjs");
  const { novoToken } = await import("../src/credenciais.mjs");
  const coletor = await iniciarColetor({ porta: 3917 });
  // o token sai de dentro do módulo de credenciais
  const cred = await import("../src/credenciais.mjs");
  novoToken();
  const token = readFileSync(join(cred.extensaoDaConta(167), "sessao.js"), "utf8").match(/COLETOR_TOKEN = "([^"]+)"/)?.[1];
  const caixa = (conta) => fetchOriginal(`http://127.0.0.1:3917/caixa?conta=${conta}&token=${token}`).then((r) => r.json());
  const a = await caixa(167);
  const b = await caixa(167);
  tudo &= ok(a.ok && b.reaproveitada === true, "a 2ª pedida (antes de \"Verificar\") reaproveita a foto");
  tudo &= ok(chamadas.ativar + chamadas.listar === 2, `2 consultas no total, não 4 (${chamadas.ativar + chamadas.listar})`);
  await coletor.fechar();
}

globalThis.fetch = fetchOriginal;
console.log(tudo ? "\n\x1b[32m\x1b[1m  caixa de e-mail: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  caixa de e-mail: FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
