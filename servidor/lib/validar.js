// As validações do retorno do OAuth. Ficam num arquivo só porque são a
// ÚNICA coisa entre um link forjado e o token de acesso da loja de alguém.
//
// Usa WebCrypto, não `node:crypto`: o mesmo arquivo roda no Cloudflare
// Worker e nos testes em Node, sem flag de compatibilidade e sem segunda
// implementação. Duas implementações da mesma regra já custaram caro aqui.

// `shop` entra numa URL que a gente mesma monta. Sem este formato, um
// `shop=evil.com` faria a troca de token acontecer no servidor do atacante.
const LOJA = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function lojaValida(shop) {
  return typeof shop === "string" && shop.length <= 100 && LOJA.test(shop);
}

const bytes = (s) => new TextEncoder().encode(s);

/** Comparação de tempo constante: com `===` o segredo vaza aos poucos. */
function iguais(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * Confere o HMAC que a Shopify manda no retorno.
 *
 * Regras da Shopify: tira `hmac` e `signature`, ordena as chaves, monta
 * `k=v&k=v` e assina com o client secret.
 */
export async function hmacValido(params, segredo) {
  if (!params || typeof params.hmac !== "string" || !segredo) return false;

  const base = Object.keys(params)
    .filter((k) => k !== "hmac" && k !== "signature")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");

  const chave = await crypto.subtle.importKey(
    "raw", bytes(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const assinatura = await crypto.subtle.sign("HMAC", chave, bytes(base));
  const hex = [...new Uint8Array(assinatura)]
    .map((b) => b.toString(16).padStart(2, "0")).join("");

  return iguais(hex, params.hmac);
}

/** O `state` liga o retorno ao pedido que NÓS fizemos. */
export function novoEstado(porta) {
  const p = Number(porta);
  if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new Error("porta inválida");
  const n = crypto.getRandomValues(new Uint8Array(24));
  const nonce = [...n].map((b) => b.toString(16).padStart(2, "0")).join("");
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
