// Tentar de novo — o que a fila faz com a conta que falha.
//
// Rodada de 21/10 na Chomps: contas falhavam por algo passageiro (a página
// demorou, o login travou no meio) e ficavam de fora até alguém rodar tudo de
// novo. Agora a conta que falha por algo PASSAGEIRO volta para o fim da fila,
// até 3 tentativas; a que precisa de uma PESSOA não repete (repetir login é o
// que levou a Shopee a pedir captcha), e vai para o alerta com o botão
// "Tentar de novo só essas".
//
// Roda a fila de verdade (src/fila.mjs) com um "processar" de mentira que
// falha do jeito que cada cenário pede, usando as mensagens REAIS de erro
// que saíram nas rodadas de 21/10.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "esteira-retry-"));
process.env.TRABALHO_DIR = dir;
process.env.ESTADO_DIR = join(dir, "estado");
process.env.RECURSOS_DIR = new URL("..", import.meta.url).pathname;
process.env.PAUSA_REPETIR_MS = "60";
process.env.SHOPEE_SENHA = "s"; process.env.SHOPEE_PREFIXO = "c"; process.env.SHOPEE_EMAIL_DOMINIO = "x.com";

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

const { rodarFila, tipoDaFalha, pedirParada } = await import("../src/fila.mjs");
const { aoEvento, limparOuvintes } = await import("../src/eventos.mjs");
const { novoToken, entregarCredencial, marcarTentativa, liberarLogin } = await import("../src/credenciais.mjs");

// As mensagens que saíram de verdade nas rodadas de 21/10.
const REAIS = {
  prazo: "conta 124: nada chegou ao coletor em 150s",
  coletaFalhou: "conta 122: a coleta não leu nenhum pedido — nenhuma lista de pedidos respondeu (502)",
  loginDeNovo: "conta 121: o login automático falhou — a Shopee pediu login de novo depois que o robô já tinha entrado",
  adspower: "conta 130: o AdsPower não abriu o perfil (code -1)",
  captcha: "conta 142: a Shopee pediu uma pessoa — Shopee pediu verificação de imagem",
  ninguem: "conta 149: a Shopee pediu uma pessoa e ninguém resolveu em 10 min — a Shopee pediu para confirmar a identidade",
  senha: "conta 11: o login automático falhou — a Shopee respondeu: senha inválida",
  cota: "conta 121: o login automático falhou — a cota da RapidAPI acabou (HTTP 429) — troque a chave em Ajustes",
  desligado: "conta 150: a sessão da Shopee caiu e o login automático está desligado",
};

sec("1. Qual falha repete e qual vai para uma pessoa");
for (const k of ["prazo", "coletaFalhou", "loginDeNovo", "adspower"])
  tudo &= ok(tipoDaFalha(REAIS[k]) === "passageira", `passageira, tenta de novo: "${REAIS[k].slice(9, 70)}…"`);
for (const k of ["captcha", "ninguem", "senha", "cota", "desligado"])
  tudo &= ok(tipoDaFalha(REAIS[k]) === "pessoa", `pessoa, não repete: "${REAIS[k].slice(9, 70)}…"`);

// ── um "processar" de mentira: cada conta tem um roteiro de resultados ──
function roteiro(planos) {
  const ordem = [];
  const vezes = {};
  const processar = async (c, { tentativa }) => {
    vezes[c.conta] = (vezes[c.conta] ?? 0) + 1;
    ordem.push(`${c.conta}#${tentativa}`);
    await new Promise((r) => setTimeout(r, 5));
    const passo = planos[c.conta][vezes[c.conta] - 1] ?? planos[c.conta].at(-1);
    if (passo === "ok") return `/tmp/conta-${c.conta}.json`;
    throw new Error(passo);
  };
  return { processar, ordem, vezes };
}
const eventos = [];
aoEvento((e) => eventos.push(e));
const rodar = (contas, r, extra = {}) => rodarFila(contas.map((conta) => ({ conta, serial: conta })),
  { concorrencia: 1, pausaMin: 0, pausaMax: 0, processar: r.processar, ...extra });

sec("2. Falha passageira: volta para o FIM da fila e passa na 2ª");
{
  eventos.length = 0;
  const r = roteiro({ 124: [REAIS.prazo, "ok"], 133: ["ok"], 128: ["ok"] });
  const t0 = Date.now();
  const res = await rodar([124, 133, 128], r);
  const c124 = res.find((x) => x.conta === 124);
  tudo &= ok(c124?.ok === true && c124.tentativas === 2, `a 124 foi lida na 2ª tentativa (${c124?.ok ? "ok" : c124?.erro})`);
  tudo &= ok(r.ordem.join(" ") === "124#1 133#1 128#1 124#2",
    `a 2ª tentativa vai para o fim, depois das outras (${r.ordem.join(" ")})`);
  tudo &= ok(res.every((x) => x.ok) && res.length === 3, "as três terminam lidas, cada uma uma vez no resultado");
  tudo &= ok(eventos.some((e) => e.tipo === "conta:repetindo" && e.conta === 124 && e.tentativa === 2 && e.de === 3),
    "a tela recebe \"vai tentar de novo · 2ª de 3\"");
  tudo &= ok(!eventos.some((e) => e.tipo === "conta:falhou"), "nenhuma conta aparece como falha na tela");
  void t0;
}

sec("3. Precisa de uma pessoa: NÃO repete");
{
  eventos.length = 0;
  const r = roteiro({ 142: [REAIS.captcha], 133: ["ok"] });
  const res = await rodar([142, 133], r);
  const c = res.find((x) => x.conta === 142);
  tudo &= ok(r.vezes[142] === 1, `captcha: tentou 1 vez só (${r.vezes[142]}) — repetir login piora a conta`);
  tudo &= ok(c.ok === false && c.natureza === "pessoa" && c.tentativas === 1, "sai como falha do tipo \"pessoa\"");
  for (const k of ["senha", "cota", "ninguem"]) {
    const r2 = roteiro({ 11: [REAIS[k]] });
    await rodar([11], r2);
    tudo &= ok(r2.vezes[11] === 1, `${k}: 1 tentativa só`);
  }
}

sec("4. Passageira que não passa: 3 tentativas, depois desiste dizendo");
{
  eventos.length = 0;
  const r = roteiro({ 122: [REAIS.coletaFalhou] });
  const res = await rodar([122], r);
  tudo &= ok(r.vezes[122] === 3, `tentou 3 vezes (${r.vezes[122]})`);
  tudo &= ok(res.length === 1 && res[0].ok === false && res[0].tentativas === 3, "uma falha só no resultado, com tentativas: 3");
  const f = eventos.find((e) => e.tipo === "conta:falhou");
  tudo &= ok(f?.tentativas === 3 && /nenhuma lista/.test(f.erro), "a tela mostra a falha com o motivo e \"3 tentativas\"");
  // o defeito que este teste pegou: um campo "tipo" nos dados apagava o tipo do evento
  tudo &= ok(eventos.every((e) => /^(conta|alerta|rodada):/.test(e.tipo)), "todo evento chega à tela com o tipo certo (\"conta:falhou\", não \"passageira\")");
}

sec("5. Espera a pausa antes de repetir, sem segurar as outras");
{
  process.env.PAUSA_REPETIR_MS = "400";
  const r = roteiro({ 124: [REAIS.prazo, "ok"], 133: ["ok"] });
  const marcas = [];
  const proc = r.processar;
  r.processar = async (c, o) => { marcas.push([c.conta, o.tentativa, Date.now()]); return proc(c, o); };
  const t0 = Date.now();
  await rodar([124, 133], r);
  const primeira = marcas.find((m) => m[0] === 124 && m[1] === 1)[2];
  const segunda = marcas.find((m) => m[0] === 124 && m[1] === 2)[2];
  const da133 = marcas.find((m) => m[0] === 133)[2];
  tudo &= ok(segunda - primeira >= 390, `a 124 esperou a pausa antes da 2ª tentativa (${segunda - primeira} ms ≥ 400)`);
  tudo &= ok(da133 - t0 < 200, `a 133 não esperou a pausa da 124 (${da133 - t0} ms)`);
  process.env.PAUSA_REPETIR_MS = "60";
}

sec("6. Com 2 navegadores ao mesmo tempo, a repetição também funciona");
{
  const r = roteiro({ 1: ["ok"], 2: [REAIS.prazo, REAIS.prazo, "ok"], 3: ["ok"] });
  const res = await rodar([1, 2, 3], r, { concorrencia: 2 });
  tudo &= ok(res.length === 3 && res.every((x) => x.ok), `as 3 lidas (${res.map((x) => x.conta + (x.ok ? "✓" : "✗")).join(" ")})`);
  tudo &= ok(r.vezes[2] === 3, `a 2 foi repetida até passar na 3ª (${r.vezes[2]} vezes)`);
}

sec("7. Parar no meio: ninguém é repetido");
{
  const r = roteiro({ 124: [REAIS.prazo, "ok"], 133: ["ok"] });
  const proc = r.processar;
  r.processar = async (c, o) => { if (c.conta === 124) pedirParada(); return proc(c, o); };
  const res = await rodar([124, 133], r);
  tudo &= ok(r.vezes[124] === 1 && !r.vezes[133], `parada pedida: a 124 não volta e a 133 nem abre (${JSON.stringify(r.vezes)})`);
  tudo &= ok(res.length === 1 && res[0].ok === false, "a 124 fica como falha (não sumiu)");
}

sec("8. Login: no máximo 2 por conta na rodada, o 2º só depois de um retry");
{
  novoToken();
  const pega = () => { try { entregarCredencial(121); return true; } catch { return false; } };
  tudo &= ok(pega(), "1ª tentativa: recebe a senha");
  marcarTentativa(121);
  tudo &= ok(!pega(), "o login não pegou e a Shopee pede de novo: senha negada (sem loop)");
  liberarLogin(121);
  tudo &= ok(pega(), "a fila tenta de novo no fim: recebe a senha mais uma vez");
  marcarTentativa(121);
  liberarLogin(121);
  tudo &= ok(!pega(), "3ª tentativa: negada mesmo com retry — nunca mais de 2 logins na rodada");
}

sec("9. O alerta do fim da rodada traz \"Tentar de novo só essas\"");
{
  const { alertarFalhas } = await import("../src/ciclo.mjs");
  alertarFalhas([
    { conta: 142, erro: REAIS.captcha, natureza: "pessoa", tentativas: 1 },
    { conta: 122, erro: REAIS.coletaFalhou, natureza: "passageira", tentativas: 3 },
  ], 33);
  const alertas = JSON.parse(readFileSync(join(dir, "estado", "alertas.json"), "utf8"));
  const a = alertas.find((x) => x.id === "rodada-falhas");
  tudo &= ok(a && JSON.stringify(a.rerodar) === "[142,122]", `o botão leva exatamente as contas que faltaram (${JSON.stringify(a?.rerodar)})`);
  tudo &= ok(/2 de 33/.test(a.titulo) && /precisam de você|resolva na janela/i.test(a.acao), "diz quantas e o que fazer antes de rodar de novo");
}

limparOuvintes();
console.log(tudo ? "\n\x1b[32m\x1b[1m  tentar de novo: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  tentar de novo: FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
