// Segundo passo: a Shopify volta aqui com o `code`, a gente troca pelo
// token e devolve para a máquina do cliente.
//
// O token NUNCA fica neste servidor. Ele é entregue por um POST automático
// para o aplicativo local — POST, e não redirecionamento com o token na
// URL, porque URL vai para o histórico do navegador e para o Referer.

import { lojaValida, hmacValido, destinoLocal } from "../../lib/validar.js";
import { pagina } from "./instalar.js";

export default async function handler(req, res) {
  const q = req.query ?? {};
  const segredo = process.env.SHOPIFY_CLIENT_SECRET ?? "";

  // A ordem importa: confere a assinatura ANTES de usar qualquer parâmetro.
  if (!hmacValido(q, segredo))
    return erro(res, 400, "Não consegui confirmar que esse retorno veio da Shopify",
      "Comece de novo pelo aplicativo. Se repetir, avise o suporte.");
  if (!lojaValida(q.shop))
    return erro(res, 400, "Endereço de loja inválido", "Comece de novo pelo aplicativo.");

  const destino = destinoLocal(q.state);
  if (!destino)
    return erro(res, 400, "Pedido de conexão inválido",
      "Comece pelo botão Conectar Shopify dentro do aplicativo.");
  if (typeof q.code !== "string" || !/^[\w-]{10,255}$/.test(q.code))
    return erro(res, 400, "Autorização incompleta", "Comece de novo pelo aplicativo.");

  let dados;
  try {
    const r = await fetch(`https://${q.shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_CLIENT_ID,
        client_secret: segredo,
        code: q.code,
      }),
      signal: AbortSignal.timeout(20000),
    });
    dados = await r.json();
    if (!r.ok || !dados?.access_token) throw new Error(dados?.error_description ?? `HTTP ${r.status}`);
  } catch (e) {
    return erro(res, 502, "A Shopify não devolveu o acesso",
      "Tente conectar de novo pelo aplicativo.");
  }

  // Entrega para a máquina que começou, e some daqui.
  const campos = {
    loja: q.shop,
    state: q.state,
    accessToken: dados.access_token,
    refreshToken: dados.refresh_token ?? "",
    expiresIn: String(dados.expires_in ?? ""),
    escopos: dados.scope ?? "",
  };

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(pagina(
    "Shopify conectada",
    "Pode fechar esta janela e voltar para o aplicativo.",
    `<form id="f" method="POST" action="${destino}">` +
    Object.entries(campos).map(([k, v]) =>
      `<input type="hidden" name="${k}" value="${escapar(v)}">`).join("") +
    `</form><script>document.getElementById("f").submit()</script>`,
  ));
}

const escapar = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function erro(res, codigo, titulo, texto) {
  res.statusCode = codigo;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(pagina(titulo, texto));
}
