// Roda no MUNDO DA PÁGINA, automaticamente, assim que a tela de compras abre.
// Faz as duas etapas sozinha:
//   1. lista os pedidos das abas Preparando (7) e A caminho (8)
//   2. entra em cada pedido e procura o código de rastreio
// Tudo com os cookies da própria sessão. Nada de CDP.
(() => {
  const SIMULAR = true; // injeta rastreio falso onde ainda não há — teste ponta a ponta

  const publicar = (payload) => window.postMessage({ __coletorShopee: true, payload }, "*");

  const pegar = async (caminho) => {
    try {
      const r = await fetch(caminho, {
        credentials: "include",
        headers: { "x-requested-with": "XMLHttpRequest", "x-api-source": "pc" },
      });
      const corpo = await r.json().catch(() => null);
      // A Shopee devolve error:0 em caso de SUCESSO. Tratar "error presente"
      // como falha faz o robô descartar resposta boa e reportar zero pedidos.
      const sucesso = r.ok && (corpo?.error === 0 || corpo?.error == null);
      return { caminho, status: r.status, ok: sucesso, corpo };
    } catch (e) {
      return { caminho, erro: String(e) };
    }
  };

  const RE_RASTREIO = /BR\d{12}[A-Z0-9]|SPX[A-Z]*\d{6,}|[A-Z]{2}\d{9}BR/g;

  // Procura o rastreio em qualquer profundidade e devolve também o caminho
  // do campo — é isso que me diz onde o código mora de verdade.
  const acharRastreio = (o, caminho = "", saida = []) => {
    if (o == null) return saida;
    if (typeof o === "string") {
      const m = o.match(RE_RASTREIO);
      if (m) saida.push({ campo: caminho, valor: o.slice(0, 80), codigos: [...new Set(m)] });
      return saida;
    }
    if (typeof o === "object")
      for (const [k, v] of Object.entries(o)) acharRastreio(v, caminho ? `${caminho}.${k}` : k, saida);
    return saida;
  };

  const coletarIds = (o, saida = new Set()) => {
    if (o == null || typeof o !== "object") return saida;
    for (const [k, v] of Object.entries(o)) {
      if (/^order_?id$/i.test(k) && (typeof v === "number" || typeof v === "string") && String(v).length > 8) saida.add(String(v));
      if (typeof v === "object") coletarIds(v, saida);
    }
    return saida;
  };

  async function rodar() {
    const inicio = Date.now();
    const listas = [];
    for (const tipo of [7, 8])
      for (const c of [
        `/api/v4/order/get_all_order_and_checkout_list?limit=20&offset=0&list_type=${tipo}`,
        `/api/v4/order/get_order_list?limit=20&offset=0&list_type=${tipo}`,
      ]) listas.push({ tipo, ...(await pegar(c)) });

    const ids = new Set();
    for (const l of listas) if (l.ok) coletarIds(l.corpo, ids);

    const pedidos = [];
    for (const id of [...ids].slice(0, 25)) {
      const candidatos = [
        `/api/v4/order/get_order_detail?order_id=${id}`,
        `/api/v4/order/get_order_detail?order_id=${id}&order_list_tab=7`,
        `/api/v4/order/get_tracking_info?order_id=${id}`,
        `/api/v4/logistics/tracking/get_tracking_info?order_id=${id}`,
        `/api/v4/logistics/tracking_info/get?order_id=${id}`,
        `/api/v4/order/get_logistics_info?order_id=${id}`,
      ];
      const respostas = [];
      for (const c of candidatos) respostas.push(await pegar(c));

      const achados = respostas.filter((r) => r.ok).flatMap((r) => acharRastreio(r.corpo));
      let codigos = [...new Set(achados.flatMap((a) => a.codigos))];
      let simulado = false;
      if (codigos.length === 0 && SIMULAR) {
        codigos = ["BR2699999999999X"];
        simulado = true;
      }
      pedidos.push({
        // fase de descoberta: manda o corpo cru do primeiro detalhe que deu OK,
        // para mapear onde moram destinatário, endereço e rastreio
        bruto: respostas.find((r) => r.ok)?.corpo ?? null,
        orderId: id,
        codigos,
        simulado,
        camposComRastreio: achados.map((a) => a.campo),
        endpointsOk: respostas.filter((r) => r.ok).map((r) => r.caminho.split("?")[0]),
      });
      await new Promise((r) => setTimeout(r, 400)); // ritmo humano entre pedidos
    }

    // A conta vem marcada no fragmento da URL (#conta=196) na hora de abrir
    // a aba. Sem isso o coletor não sabe de qual perfil veio cada pedido.
    const conta = new URLSearchParams(location.hash.slice(1)).get("conta");

    publicar({
      tipo: "coleta",
      conta,
      pagina: location.href,
      duracaoMs: Date.now() - inicio,
      listas,
      pedidos,
      texto: document.querySelector("#main")?.innerText ?? "",
    });
  }

  // espera a SPA assentar e dispara sozinha
  setTimeout(rodar, 6000);
})();
