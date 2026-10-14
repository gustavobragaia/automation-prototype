const COLETOR = "http://127.0.0.1:3000/captura";

chrome.runtime.onMessage.addListener((msg, remetente) => {
  fetch(COLETOR, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...msg, aba: remetente.tab?.id, em: Date.now() }),
  }).catch(() => {}); // coletor desligado não pode quebrar a navegação
});
