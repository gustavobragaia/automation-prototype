// As duas rotas do cenário B, em Cloudflare Workers.
//
//   GET /shopify/instalar?loja=&state=   manda para a tela de permissões
//   GET /shopify/callback                troca o code pelo token
//
// O token NUNCA fica aqui: é entregue por POST automático para o aplicativo
// na máquina do cliente. POST, e não redirecionamento com o token na URL,
// porque URL vai para o histórico do navegador e para o Referer.

import { lojaValida, hmacValido, destinoLocal, lerEstado } from "../lib/validar.js";
import { pagina, escapar } from "../lib/pagina.js";

const ESCOPOS = [
  "read_orders", "write_orders",
  "read_fulfillments", "write_fulfillments",
  "read_assigned_fulfillment_orders", "write_assigned_fulfillment_orders",
  "read_merchant_managed_fulfillment_orders", "write_merchant_managed_fulfillment_orders",
].join(",");

const SEGURANCA = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

const html = (corpo, status = 200) =>
  new Response(corpo, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...SEGURANCA } });

const erro = (status, titulo, texto) => html(pagina(titulo, texto), status);

export default {
  async fetch(request, env) {
    const u = new URL(request.url);

    // O .cloud não força HTTPS como o .app faria; forçamos aqui.
    if (u.protocol === "http:") {
      u.protocol = "https:";
      return Response.redirect(u.toString(), 301);
    }
    if (request.method !== "GET")
      return erro(405, "Método não aceito", "Esta página só responde a GET.");

    if (u.pathname === "/shopify/instalar") return instalar(u, env);
    if (u.pathname === "/shopify/callback") return callback(u, env);
    if (u.pathname === "/") return html(pagina("Esteira",
      "Servidor de conexão da Esteira. Comece pelo aplicativo instalado na sua máquina."));

    return erro(404, "Página não encontrada", "Comece pelo aplicativo.");
  },
};

function instalar(u, env) {
  const loja = u.searchParams.get("loja");
  const state = u.searchParams.get("state");

  if (!lojaValida(loja))
    return erro(400, "Endereço de loja inválido", "Esperado algo como minhaloja.myshopify.com.");
  if (!lerEstado(state))
    return erro(400, "Pedido de conexão inválido",
      "Comece pelo botão Conectar Shopify dentro do aplicativo.");

  const alvo = new URL(`https://${loja}/admin/oauth/authorize`);
  alvo.searchParams.set("client_id", env.SHOPIFY_CLIENT_ID ?? "");
  alvo.searchParams.set("scope", ESCOPOS);
  alvo.searchParams.set("redirect_uri", `${env.BASE_URL}/shopify/callback`);
  alvo.searchParams.set("state", state);

  return new Response(null, { status: 302, headers: { Location: alvo.toString(), ...SEGURANCA } });
}

async function callback(u, env) {
  const q = Object.fromEntries(u.searchParams);
  const segredo = env.SHOPIFY_CLIENT_SECRET ?? "";

  // A ordem importa: confere a assinatura ANTES de usar qualquer parâmetro.
  if (!(await hmacValido(q, segredo)))
    return erro(400, "Não consegui confirmar que esse retorno veio da Shopify",
      "Comece de novo pelo aplicativo. Se repetir, avise o suporte.");
  if (!lojaValida(q.shop))
    return erro(400, "Endereço de loja inválido", "Comece de novo pelo aplicativo.");

  const destino = destinoLocal(q.state);
  if (!destino)
    return erro(400, "Pedido de conexão inválido",
      "Comece pelo botão Conectar Shopify dentro do aplicativo.");
  if (typeof q.code !== "string" || !/^[\w-]{10,255}$/.test(q.code))
    return erro(400, "Autorização incompleta", "Comece de novo pelo aplicativo.");

  let dados;
  try {
    const r = await fetch(`https://${q.shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: env.SHOPIFY_CLIENT_ID,
        client_secret: segredo,
        code: q.code,
      }),
    });
    dados = await r.json();
    if (!r.ok || !dados?.access_token) throw new Error("sem token");
  } catch {
    return erro(502, "A Shopify não devolveu o acesso", "Tente conectar de novo pelo aplicativo.");
  }

  const campos = {
    loja: q.shop,
    state: q.state,
    accessToken: dados.access_token,
    refreshToken: dados.refresh_token ?? "",
    expiresIn: String(dados.expires_in ?? ""),
    escopos: dados.scope ?? "",
  };

  return html(pagina(
    "Shopify conectada",
    "Pode fechar esta janela e voltar para o aplicativo.",
    `<form id="f" method="POST" action="${destino}">` +
    Object.entries(campos).map(([k, v]) =>
      `<input type="hidden" name="${k}" value="${escapar(v)}">`).join("") +
    `</form><script>document.getElementById("f").submit()</script>`,
  ));
}
