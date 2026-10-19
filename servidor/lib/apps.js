// Qual app da Shopify atende cada loja.
//
// Por que mais de um: um app com distribuição personalizada só pode ser
// instalado na loja para a qual foi feito. O app principal (ainda sem
// distribuição) só instala em loja de desenvolvimento — e foi isso que
// barrou a loja real do primeiro cliente com "o app pode não estar
// disponível para esta loja". Então cada cliente com app próprio é listado
// aqui, e o resto segue no app principal.
//
//   SHOPIFY_LOJAS = '{"loja-do-cliente.myshopify.com": "CHOMPS"}'   (var)
//   SHOPIFY_CLIENT_ID_CHOMPS                                         (var)
//   SHOPIFY_CLIENT_SECRET_CHOMPS                                     (secret)
//
// Loja fora da lista usa SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET.
//
// Falha FECHADO: se a loja está na lista e as credenciais do app dela
// faltam, a resposta é null — nunca o app principal. Cair no app de outro
// cliente "para funcionar" esconderia a configuração errada atrás de um
// erro da Shopify, e misturaria o acesso de dois clientes num app só.

const CHAVE = /^[A-Z0-9_]{1,40}$/;

export function appDaLoja(loja, env = {}) {
  let mapa;
  try { mapa = JSON.parse(env.SHOPIFY_LOJAS || "{}"); }
  catch { return null; }                       // lista quebrada: ninguém passa
  if (!mapa || typeof mapa !== "object" || Array.isArray(mapa)) return null;

  const chave = Object.prototype.hasOwnProperty.call(mapa, loja) ? mapa[loja] : null;
  if (chave !== null && (typeof chave !== "string" || !CHAVE.test(chave))) return null;

  const sufixo = chave ? `_${chave}` : "";
  const clientId = env[`SHOPIFY_CLIENT_ID${sufixo}`];
  const segredo = env[`SHOPIFY_CLIENT_SECRET${sufixo}`];
  if (!clientId || !segredo) return null;
  return { clientId, segredo, app: chave ?? "principal" };
}
