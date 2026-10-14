// Sonda v2 — roda dentro da página da Shopee, com os cookies da sessão.
// Etapa 1: descobre o endpoint que LISTA os pedidos (abas Preparando=7, A caminho=8)
// Etapa 2: pega um id real dessa lista e descobre o endpoint de DETALHE,
//          que é onde mora o código de rastreio.
(async () => {
  const COLETOR = "http://127.0.0.1:3000/captura";

  const aviso = (t, cor) => {
    const d = document.createElement("div");
    d.textContent = t;
    d.style.cssText = `position:fixed;z-index:999999;right:16px;bottom:16px;padding:12px 16px;
      background:${cor};color:#fff;font:14px/1.4 system-ui;border-radius:6px;max-width:420px;
      box-shadow:0 4px 16px rgba(0,0,0,.3);white-space:pre-line`;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 20000);
  };

  const pegar = async (caminho) => {
    try {
      const r = await fetch(caminho, {
        credentials: "include",
        headers: { "x-requested-with": "XMLHttpRequest", "x-api-source": "pc" },
      });
      const corpo = await r.json().catch(() => null);
      return { caminho, status: r.status, ok: r.ok && corpo?.error == null, corpo };
    } catch (e) {
      return { caminho, erro: String(e) };
    }
  };

  // ── etapa 1: lista ────────────────────────────────────────────────
  const listas = [];
  for (const tipo of [7, 8]) {
    for (const c of [
      `/api/v4/order/get_all_order_and_checkout_list?limit=10&offset=0&list_type=${tipo}`,
      `/api/v4/order/get_all_order_and_checkout_list?limit=10&offset=0&list_type=${tipo}&return_simple_order=true`,
      `/api/v4/order/get_order_list?limit=10&offset=0&list_type=${tipo}`,
    ]) listas.push(await pegar(c));
  }

  // ── acha ids de pedido em qualquer lugar do JSON ──────────────────
  const idsDe = (o, achados = new Set()) => {
    if (o == null || typeof o !== "object") return achados;
    for (const [k, v] of Object.entries(o)) {
      if (/^(order_?id|orderid|checkout_?id|order_sn|shop_?order_?id)$/i.test(k) && (typeof v === "number" || typeof v === "string"))
        achados.add(`${k}=${v}`);
      if (typeof v === "object") idsDe(v, achados);
    }
    return achados;
  };

  const ids = new Set();
  for (const l of listas) if (l.ok) idsDe(l.corpo, ids);
  const pares = [...ids];

  // ── etapa 2: detalhe, usando o primeiro order_id encontrado ───────
  const detalhes = [];
  const oid = pares.find((p) => /^order_?id=/i.test(p))?.split("=")[1];
  if (oid) {
    for (const c of [
      `/api/v4/order/get_order_detail?order_id=${oid}`,
      `/api/v4/order/get_order_detail?order_id=${oid}&order_list_tab=7`,
      `/api/v4/order/get_tracking_info?order_id=${oid}`,
      `/api/v4/logistics/tracking/get_tracking_info?order_id=${oid}`,
      `/api/v4/order/get_shipping_info?order_id=${oid}`,
    ]) detalhes.push(await pegar(c));
  }

  const pacote = {
    tipo: "sonda",
    pagina: location.href,
    listas,
    ids: pares.slice(0, 40),
    orderIdUsado: oid ?? null,
    detalhes,
    texto: document.querySelector("#main")?.innerText ?? document.body.innerText,
  };

  try {
    await fetch(COLETOR, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pacote) });
    const okL = listas.filter((l) => l.ok).length, okD = detalhes.filter((d) => d.ok).length;
    aviso(`Sonda enviada\nlistas OK: ${okL}/${listas.length}\nids achados: ${pares.length}\ndetalhe OK: ${okD}/${detalhes.length}`, "#0D4F4B");
  } catch (e) {
    aviso(`Coletor local não respondeu. Ele está rodando?\n${e}`, "#A8442C");
  }
  console.log("[sonda]", pacote);
})();
