// Mundo isolado: repassa o que a coleta publicou para o service worker.
window.addEventListener("message", (ev) => {
  if (ev.source !== window || !ev.data?.__coletorShopee) return;
  chrome.runtime.sendMessage(ev.data.payload);
});
