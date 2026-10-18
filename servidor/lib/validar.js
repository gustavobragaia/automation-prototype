// As validações do retorno do OAuth. Ficam num arquivo só porque são a
// ÚNICA coisa entre um link forjado e o token de acesso da loja de alguém.
//
// A Shopify assina os parâmetros do retorno com o client secret. Quem não
// confere a assinatura aceita qualquer requisição que chegue na URL — e a
// URL é pública.

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

// `shop` entra numa URL que a gente mesma monta. Sem este formato, um
// `shop=evil.com` faria a troca de token acontecer no servidor do atacante.
const LOJA = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function lojaValida(shop) {
  return typeof shop === "string" && shop.length <= 100 && LOJA.test(shop);
}

/**
 * Confere o HMAC que a Shopify manda no retorno.
 *
 * Regras da Shopify: tira `hmac` e `signature`, ordena as chaves, monta
 * `k=v&k=v` e assina com o client secret.
 */
export function hmacValido(params, segredo) {
  if (!params || typeof params.hmac !== "string" || !segredo) return false;

  const base = Object.keys(params)
    .filter((k) => k !== "hmac" && k !== "signature")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");

  const esperado = createHmac("sha256", segredo).update(base).digest("hex");
  const a = Buffer.from(esperado, "utf8");
  const b = Buffer.from(params.hmac, "utf8");
  // comparação de tempo constante: comparar com === vaza o segredo aos poucos
  return a.length === b.length && timingSafeEqual(a, b);
}

/** O `state` liga o retorno ao pedido que NÓS fizemos. */
export function novoEstado(porta) {
  const nonce = randomBytes(24).toString("hex");
  const p = Number(porta);
  if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new Error("porta inválida");
  return `${p}.${nonce}`;
}

export function lerEstado(state) {
  if (typeof state !== "string" || state.length > 200) return null;
  const m = state.match(/^(\d{4,5})\.([0-9a-f]{48})$/);
  if (!m) return null;
  const porta = Number(m[1]);
  if (porta < 1024 || porta > 65535) return null;
  return { porta, nonce: m[2] };
}

/** Só devolve o token para a máquina que começou — e só para o localhost dela. */
export function destinoLocal(state) {
  const e = lerEstado(state);
  return e ? `http://127.0.0.1:${e.porta}/shopify/pronto` : null;
}
