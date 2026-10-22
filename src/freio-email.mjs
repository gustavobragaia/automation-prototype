// O freio dos logins: o ritmo em que a Shopee aceita mandar e-mail.
//
// Rodada de 2 dias da Chomps, 21/10/2026 (o diagnóstico do Matheus): às
// 18h30, 23 verificações e todas certas. Depois de ~35 numa hora, os e-mails
// da Shopee passaram a chegar com 15-30 min de atraso, ou nunca — das 19h30
// às 22h30, 53 de 74 falharam. Às 23h, 19 de 19 certas de novo. A conta 246
// recebeu o link às 19:40:48, 6 s antes de a janela fechar; a 222 nunca
// recebeu. Não era a caixa nem o robô: era volume.
//
// Então os logins (cada um pode virar um e-mail de verificação) têm:
//   - ritmo: no máximo LIMITE_HORA logins por hora, abaixo de onde travou;
//   - freio: 2 e-mails seguidos que não chegam param os logins por
//     PAUSA_FREIO_MS. Depois, UMA conta de teste: se o e-mail dela chega,
//     volta ao normal; se não, freia de novo.
// Conta com sessão viva não passa por aqui: continua sendo lida.
//
// O estado fica em arquivo: o aperto da Shopee não acaba porque o app reabriu.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { emEstado } from "./caminhos.mjs";

const LIMITE_HORA = () => Number(process.env.LIMITE_LOGINS_HORA ?? 25);
const PAUSA_FREIO_MS = () => Number(process.env.PAUSA_FREIO_MS ?? 45 * 60_000);
const SEGUIDOS_PARA_FREAR = 2;
const HORA = 3600_000;
// A conta de teste tem este tempo para dizer se o e-mail chegou (a espera
// inteira do login.js é ~10 min); depois disso, outra pode tentar.
const TESTE_VALE_MS = 15 * 60_000;

const arquivo = () => emEstado("freio-email.json");
const vazio = () => ({ logins: [], seguidos: 0, freadoAte: 0, teste: null });

function ler() {
  try { return { ...vazio(), ...JSON.parse(readFileSync(arquivo(), "utf8")) }; } catch { return vazio(); }
}
function gravar(s) {
  try { mkdirSync(dirname(arquivo()), { recursive: true }); writeFileSync(arquivo(), JSON.stringify(s, null, 2)); } catch {}
}

/**
 * Esta conta pode começar um login agora?
 * @returns {{ok:true, teste?:boolean} | {ok:false, ate:number, motivo:string}}
 */
export function podeLogar(conta, agora = Date.now()) {
  const s = ler();
  const n = Number(conta);
  if (s.freadoAte > agora)
    return { ok: false, ate: s.freadoAte, motivo: "os e-mails de verificação da Shopee pararam de chegar; os logins estão pausados" };
  if (s.freadoAte) {
    // Passou a pausa: só a conta de teste loga, até se saber se o e-mail chega.
    if (s.teste && s.teste.conta !== n && agora - s.teste.em < TESTE_VALE_MS)
      return { ok: false, ate: s.teste.em + TESTE_VALE_MS, motivo: `a conta ${s.teste.conta} está testando se os e-mails da Shopee voltaram a chegar` };
    if (!s.teste || s.teste.conta !== n) { s.teste = { conta: n, em: agora }; gravar(s); }
    return { ok: true, teste: true };
  }
  const naHora = s.logins.filter((t) => agora - t < HORA).sort((a, b) => a - b);
  if (naHora.length >= LIMITE_HORA())
    return { ok: false, ate: naHora[naHora.length - LIMITE_HORA()] + HORA,
             motivo: `${naHora.length} logins na última hora — acima disso a Shopee atrasa os e-mails` };
  return { ok: true };
}

/** Um login começou (o robô clicou em Entrar). */
export function registrarLogin(agora = Date.now()) {
  const s = ler();
  s.logins = [...s.logins.filter((t) => agora - t < HORA), agora];
  gravar(s);
}

/** O e-mail da Shopee (link ou código) chegou: o caminho está livre. */
export function emailChegou() {
  const s = ler();
  const estavaFreado = Boolean(s.freadoAte);
  s.seguidos = 0; s.freadoAte = 0; s.teste = null;
  gravar(s);
  return { soltou: estavaFreado };
}

/** O e-mail não chegou nem na espera longa. Devolve se o freio puxou agora. */
export function emailNaoChegou(agora = Date.now()) {
  const s = ler();
  // Depois de um freio a contagem continua em 2+ (só um e-mail que chega
  // zera): então o e-mail da conta de teste que não chega freia de novo.
  s.seguidos++;
  if (s.seguidos >= SEGUIDOS_PARA_FREAR) {
    s.freadoAte = agora + PAUSA_FREIO_MS(); s.teste = null;
    gravar(s);
    return { freou: true, ate: s.freadoAte };
  }
  gravar(s);
  return { freou: false };
}

export function situacaoDoFreio(agora = Date.now()) {
  const s = ler();
  return { freadoAte: s.freadoAte > agora ? s.freadoAte : 0, testando: s.teste?.conta ?? null,
           loginsNaHora: s.logins.filter((t) => agora - t < HORA).length, seguidos: s.seguidos };
}

export function zerarFreio() { gravar(vazio()); }
