// Mundo da página, só em /verify/*: grava os pedidos que a tela
// "Verificar Identidade" faz à Shopee.
//
// O clique do robô em "Verificar via link por E-mail" não fazia a página
// mudar nem o e-mail sair (21/10), e não se sabia por quê. Com isto, quando
// uma pessoa clica, fica registrado qual pedido o botão manda — endereço,
// método e o corpo — para o robô poder mandar o mesmo. Nada de senha passa
// por aqui; mesmo assim só sai o caminho e o formato do corpo, cortado.
(() => {
  const publicar = (payload) => window.postMessage({ __coletorShopee: true, payload }, "*");
  const curto = (b) => { try { return typeof b === "string" ? b.slice(0, 600) : b ? JSON.stringify(b).slice(0, 600) : null; } catch { return null; } };
  const anota = (metodo, url, corpo, status, resposta) => {
    try {
      const u = new URL(url, location.href);
      if (!/shopee\.com\.br$/.test(u.hostname) || !/\/api\//.test(u.pathname)) return;
      publicar({ tipo: "ivs-rede", motivo: `${metodo} ${u.pathname} → ${status}`,
        caminho: u.pathname + u.search, metodo, corpo: curto(corpo), status, resposta: curto(resposta), pagina: location.href });
    } catch {}
  };
  const fetchOriginal = window.fetch;
  window.fetch = async function (entrada, opcoes = {}) {
    const url = typeof entrada === "string" ? entrada : entrada?.url;
    const r = await fetchOriginal.apply(this, arguments);
    r.clone().text().then((t) => anota(opcoes.method ?? "GET", url, opcoes.body, r.status, t)).catch(() => {});
    return r;
  };
  const abrir = XMLHttpRequest.prototype.open, enviar = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__esteira = { m, u }; return abrir.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (corpo) {
    this.addEventListener("loadend", () => anota(this.__esteira?.m ?? "GET", this.__esteira?.u ?? "", corpo, this.status, this.responseText));
    return enviar.apply(this, arguments);
  };
})();
