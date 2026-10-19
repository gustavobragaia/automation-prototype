// A conexão com a Shopify, isolada do resto do código.
//
// Existe para que trocar o CENÁRIO A pelo B seja trocar de "modo" aqui, e
// nada mais no projeto. Quem consome só chama `tokenDaConexao(c)`.
//
//   modo "credenciais"  (cenário A, em uso hoje)
//     O lojista cria o app no Dev Dashboard DELE e nos passa client_id +
//     client_secret. Trocamos por um token de 24h via client_credentials.
//     Funciona só porque app e loja estão na mesma organização.
//
//   modo "oauth"        (cenário B, quando tivermos domínio)
//     O app é NOSSO, com custom distribution. O lojista clica em um link,
//     autoriza, e nosso endpoint HTTPS troca o `code` por access_token +
//     refresh_token. Aqui só cuidamos da renovação.
//
// O arquivo guarda segredo em texto puro, com permissão 0600. Na fase do
// aplicativo isso migra para o keychain do sistema operacional (ver DECISOES.md).

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { emEstado } from "./caminhos.mjs";

const ARQUIVO = process.env.SHOPIFY_CONEXAO_ARQUIVO ?? emEstado("conexao-shopify.json");

// Escopos mínimos para ler pedidos abertos e criar fulfillment com rastreio.
export const ESCOPOS = [
  "read_orders",
  "write_orders",
  "read_fulfillments",
  "write_fulfillments",
  "read_assigned_fulfillment_orders",
  "write_assigned_fulfillment_orders",
  "read_merchant_managed_fulfillment_orders",
  "write_merchant_managed_fulfillment_orders",
];

export function normalizarLoja(valor) {
  if (!valor) return null;
  // aceita "loja", "loja.myshopify.com", "https://loja.myshopify.com/admin"
  let s = String(valor).trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  if (!s.includes(".")) s = `${s}.myshopify.com`;
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s) ? s : null;
}

// ─── Persistência ────────────────────────────────────────────────────────────

export function lerConexao() {
  if (!existsSync(ARQUIVO)) return null;
  try {
    return JSON.parse(readFileSync(ARQUIVO, "utf8"));
  } catch {
    return null;
  }
}

export function salvarConexao(c) {
  mkdirSync(dirname(ARQUIVO), { recursive: true });
  writeFileSync(ARQUIVO, JSON.stringify(c, null, 2));
  try { chmodSync(ARQUIVO, 0o600); } catch {}
  return c;
}

export function apagarConexao() {
  if (existsSync(ARQUIVO)) writeFileSync(ARQUIVO, "null");
  // o acesso da loja antiga não pode sobreviver na memória
  cache.clear();
}

/**
 * A conexão em uso: a salva pelo "conectar", ou, se não houver, a montada a
 * partir do .env — é o que mantém os scripts antigos rodando sem mudança.
 */
export function conexaoAtiva() {
  const salva = lerConexao();
  if (salva?.loja) return salva;

  const loja = normalizarLoja(process.env.SHOPIFY_LOJA);
  if (!loja) return null;
  if (process.env.SHOPIFY_TOKEN)
    return { loja, modo: "token-fixo", accessToken: process.env.SHOPIFY_TOKEN, origem: "env" };
  if (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET)
    return {
      loja,
      modo: "credenciais",
      clientId: process.env.SHOPIFY_CLIENT_ID,
      clientSecret: process.env.SHOPIFY_CLIENT_SECRET,
      origem: "env",
    };
  return null;
}

// ─── Token ───────────────────────────────────────────────────────────────────

// Margem antes do vencimento: renova um pouco antes para não cair no meio de
// uma rodada de 300 pedidos.
const MARGEM_MS = 5 * 60 * 1000;

const cache = new Map(); // loja -> { token, expiraEm }

/** Devolve um access token válido para a conexão, renovando se preciso. */
export async function tokenDaConexao(c = conexaoAtiva()) {
  if (!c?.loja) throw new Error("nenhuma loja Shopify conectada — rode: npm run conectar");

  if (c.modo === "token-fixo") return c.accessToken;

  const guardado = cache.get(c.loja);
  if (guardado && Date.now() < guardado.expiraEm) return guardado.token;

  // token ainda válido salvo em disco (sobrevive a reinício do processo)
  if (c.accessToken && c.expiraEm && Date.now() < c.expiraEm - MARGEM_MS) {
    cache.set(c.loja, { token: c.accessToken, expiraEm: c.expiraEm - MARGEM_MS });
    return c.accessToken;
  }

  const novo = c.modo === "oauth" ? await renovarOAuth(c) : await trocarCredenciais(c);

  cache.set(c.loja, { token: novo.accessToken, expiraEm: novo.expiraEm - MARGEM_MS });
  if (c.origem !== "env") salvarConexao({ ...c, ...novo, renovadoEm: new Date().toISOString() });
  return novo.accessToken;
}

/**
 * Prova um ID + chave AGORA, sempre perguntando à Shopify — nunca pelo
 * cache. Sem isso, trocar de loja e colar uma chave errada passava: o
 * acesso da conexão anterior, guardado na memória para a mesma loja,
 * respondia no lugar da chave nova. Quem chama só grava depois disto.
 */
export async function provarCredenciais(c) {
  cache.delete(c.loja);
  const novo = await trocarCredenciais(c);
  cache.set(c.loja, { token: novo.accessToken, expiraEm: novo.expiraEm - MARGEM_MS });
  return novo;
}
export function esquecerToken(loja) { if (loja) cache.delete(loja); else cache.clear(); }

/** Cenário A: client_credentials. Token de ~24h, sem refresh token. */
async function trocarCredenciais(c) {
  if (!c.clientId || !c.clientSecret)
    throw new Error("conexão em modo credenciais sem client_id/client_secret");

  const j = await postOAuth(c.loja, {
    grant_type: "client_credentials",
    client_id: c.clientId,
    client_secret: c.clientSecret,
  });
  return { accessToken: j.access_token, expiraEm: Date.now() + Number(j.expires_in ?? 86400) * 1000 };
}

/**
 * Cenário B: refresh_token. Access token vale 1h, refresh vale 90 dias.
 * Ainda não exercitado contra a Shopify — depende do app com custom
 * distribution, que depende do domínio.
 */
async function renovarOAuth(c) {
  if (!c.refreshToken) throw new Error("conexão OAuth sem refresh_token — o lojista precisa reautorizar");

  const j = await postOAuth(c.loja, {
    grant_type: "refresh_token",
    client_id: c.clientId,
    refresh_token: c.refreshToken,
  });
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? c.refreshToken,
    expiraEm: Date.now() + Number(j.expires_in ?? 3600) * 1000,
  };
}

async function postOAuth(loja, corpo) {
  // Formulário, e não JSON: é o formato da documentação da Shopify para
  // este endpoint (client_credentials e refresh_token). JSON também passava
  // na loja de teste, mas isso é tolerância deles, não contrato.
  const r = await fetch(`https://${loja}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(corpo).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    // a mensagem da Shopify aqui é o que diz se o problema é escopo, segredo
    // errado ou app fora da organização da loja
    throw new Error(`Shopify recusou o token (HTTP ${r.status}): ${JSON.stringify(j).slice(0, 300)}`);
  }
  return j;
}
