// Ponte entre a página e o coletor local. Fica aqui, e não no content
// script, porque páginas web não conseguem falar com o service worker —
// é isso que mantém a senha fora do alcance de uma aba qualquer.

importScripts("sessao.js");   // define self.COLETOR_TOKEN, gerado por rodada

const COLETOR = "http://127.0.0.1:3000";

chrome.runtime.onMessage.addListener((msg, remetente, responder) => {
  // Pedidos que esperam resposta (credencial, código de verificação).
  if (msg?.pedido) {
    const url = new URL(`${COLETOR}/${msg.pedido === "otp" ? "otp" : "credencial"}`);
    url.searchParams.set("conta", msg.conta ?? "");
    url.searchParams.set("token", self.COLETOR_TOKEN ?? "");
    if (msg.desde) url.searchParams.set("desde", msg.desde);

    fetch(url)
      .then((r) => r.json())
      .then(responder)
      .catch((e) => responder({ erro: String(e) }));
    return true;   // mantém o canal aberto para a resposta assíncrona
  }

  // Avisos de mão única (coleta, login-ok, precisa-humano...).
  fetch(`${COLETOR}/captura`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...msg, aba: remetente.tab?.id, em: Date.now() }),
  }).catch(() => {});
});
