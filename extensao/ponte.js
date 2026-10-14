// Mundo isolado: recebe o que o interceptador publicou e repassa ao
// service worker, que é quem fala com o coletor local.
window.addEventListener("message", (ev) => {
  if (ev.source !== window || !ev.data?.__coletorShopee) return;
  chrome.runtime.sendMessage({
    tipo: "captura",
    url: ev.data.url,
    corpo: ev.data.corpo,
    pagina: location.href,
  });
});

// Também manda o texto da tela, como rede de segurança caso a Shopee
// passe a renderizar os pedidos no servidor.
const mandarTexto = () => {
  const t = document.querySelector("#main")?.innerText ?? "";
  if (t.length > 150) chrome.runtime.sendMessage({ tipo: "tela", texto: t, pagina: location.href });
};
setTimeout(mandarTexto, 8000);
setTimeout(mandarTexto, 20000);
