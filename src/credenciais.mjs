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
import { writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { emailDaConta } from "./tracking.mjs";

const ARQ_TOKEN = resolve("extensao/sessao.js");
let tokenAtual = null;

export function novoToken() {
  tokenAtual = randomBytes(24).toString("hex");
  writeFileSync(ARQ_TOKEN, `// gerado por rodada — não versionar\nself.COLETOR_TOKEN = ${JSON.stringify(tokenAtual)};\n`);
  return tokenAtual;
}

export const tokenValido = (t) => Boolean(tokenAtual) && t === tokenAtual;

export function limparToken() {
  tokenAtual = null;
  try { writeFileSync(ARQ_TOKEN, "self.COLETOR_TOKEN = null;\n"); } catch {}
}

/** A senha é única para todas as contas; o e-mail vem do padrão. */
export function credencialDaConta(conta) {
  const senha = process.env.SHOPEE_SENHA;
  if (!senha) throw new Error("SHOPEE_SENHA não configurada");
  return { email: emailDaConta(Number(conta)), senha };
}
