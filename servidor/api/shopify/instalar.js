// Primeiro passo: manda o lojista para a tela de permissões da Shopify.
//
// Quem chama é o aplicativo na máquina do cliente, abrindo o navegador em
//   https://esteira.cloud/shopify/instalar?loja=X&state=Y
// O `state` carrega a porta do app local, e é por ele que o token volta
// para a máquina certa no fim.

import { lojaValida, lerEstado } from "../../lib/validar.js";

const ESCOPOS = [
  "read_orders", "write_orders",
  "read_fulfillments", "write_fulfillments",
  "read_assigned_fulfillment_orders", "write_assigned_fulfillment_orders",
  "read_merchant_managed_fulfillment_orders", "write_merchant_managed_fulfillment_orders",
].join(",");

export default function handler(req, res) {
  const { loja, state } = req.query ?? {};

  if (!lojaValida(loja))
    return erro(res, 400, "Endereço de loja inválido",
      "Esperado algo como minhaloja.myshopify.com.");
  if (!lerEstado(state))
    return erro(res, 400, "Pedido de conexão inválido",
      "Comece pelo botão Conectar Shopify dentro do aplicativo.");

  const u = new URL(`https://${loja}/admin/oauth/authorize`);
  u.searchParams.set("client_id", process.env.SHOPIFY_CLIENT_ID ?? "");
  u.searchParams.set("scope", ESCOPOS);
  u.searchParams.set("redirect_uri", `${process.env.BASE_URL}/shopify/callback`);
  u.searchParams.set("state", state);

  res.statusCode = 302;
  res.setHeader("Location", u.toString());
  res.setHeader("Cache-Control", "no-store");
  res.end();
}

function erro(res, codigo, titulo, texto) {
  res.statusCode = codigo;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(pagina(titulo, texto));
}

export function pagina(titulo, texto, extra = "") {
  return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title>
<style>
 body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fbfbfc;color:#16161a;
  font:15px/1.6 -apple-system,"Segoe UI",Roboto,sans-serif;padding:24px}
 .c{max-width:38ch;text-align:center}
 h1{font-size:19px;margin:0 0 10px;letter-spacing:-.02em}
 p{margin:0;color:#63637a;font-size:14px}
 @media(prefers-color-scheme:dark){body{background:#08090a;color:#f1f1f5}p{color:#9797a6}}
</style>
<div class="c"><h1>${titulo}</h1><p>${texto}</p></div>${extra}`;
}
