// Credenciais das contas Shopee, e o token que protege a entrega delas.
//
// O coletor escuta em 127.0.0.1 e a extensão precisa buscar e-mail e senha
// de algum lugar. Sem proteção, QUALQUER página aberta no navegador poderia
// pedir — basta saber a URL. Por isso:
//
//   1. o token é gerado por rodada e gravado dentro da pasta da extensão,
//      que páginas web não conseguem ler (sem web_accessible_resources);
//   2. quem busca é o service worker, não o content script: páginas não
//      conseguem falar com ele;
//   3. o coletor recusa qualquer requisição com Origin de site.

import { randomBytes } from "node:crypto";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { emailDaConta } from "./tracking.mjs";

const BASE_EXT = resolve("extensao");
const DIR_RODADA = resolve("extensao-rodada");
let tokenAtual = null;

export function novoToken() {
  tokenAtual = randomBytes(24).toString("hex");
  rmSync(DIR_RODADA, { recursive: true, force: true });
  return tokenAtual;
}

/**
 * Uma cópia da extensão por conta. O fragmento da URL (#conta=231) não
 * sobrevive ao redirect da Shopee para a tela de login — e era assim que a
 * extensão descobria de quem era o perfil. Gravando a conta dentro da
 * própria extensão, ela sabe quem é independente de para onde a página vá.
 *
 * Cópia por conta, e não arquivo compartilhado, porque a fila roda várias
 * ao mesmo tempo e todas leriam o mesmo valor.
 */
export function extensaoDaConta(conta) {
  const destino = join(DIR_RODADA, `conta-${conta}`);
  mkdirSync(DIR_RODADA, { recursive: true });
  rmSync(destino, { recursive: true, force: true });
  cpSync(BASE_EXT, destino, { recursive: true });
  writeFileSync(join(destino, "sessao.js"),
    `// gerado por rodada — não versionar\n` +
    `self.COLETOR_TOKEN = ${JSON.stringify(tokenAtual)};\n` +
    `self.COLETOR_CONTA = ${JSON.stringify(String(conta))};\n`);
  return destino;
}

export const tokenValido = (t) => Boolean(tokenAtual) && t === tokenAtual;

export function limparToken() {
  tokenAtual = null;
  try { rmSync(DIR_RODADA, { recursive: true, force: true }); } catch {}
}

/** A senha é única para todas as contas; o e-mail vem do padrão. */
export function credencialDaConta(conta) {
  const senha = process.env.SHOPEE_SENHA;
  if (!senha) throw new Error("SHOPEE_SENHA não configurada");
  return { email: emailDaConta(Number(conta)), senha };
}
