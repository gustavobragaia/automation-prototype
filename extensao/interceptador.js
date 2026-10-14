// Roda no MUNDO DA PÁGINA. Envolve fetch e XHR para ver as respostas que a
// própria Shopee busca. Nada de CDP: do ponto de vista do site, é só a
// página rodando normalmente.
(() => {
  const INTERESSA = /\/api\/v4\/.*(order|purchase|logistic|tracking)/i;

  const publicar = (url, corpo) => {
    window.postMessage({ __coletorShopee: true, url, corpo }, "*");
  };

  const fetchOriginal = window.fetch;
  window.fetch = async function (...args) {
    const res = await fetchOriginal.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url ?? "";
      if (INTERESSA.test(url)) {
        res.clone().json().then((c) => publicar(url, c)).catch(() => {});
      }
    } catch {}
    return res;
  };

  const abrirOriginal = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (metodo, url, ...resto) {
    this.__url = url;
    this.addEventListener("load", () => {
      try {
        if (INTERESSA.test(this.__url ?? "")) publicar(this.__url, JSON.parse(this.responseText));
      } catch {}
    });
    return abrirOriginal.call(this, metodo, url, ...resto);
  };
})();
