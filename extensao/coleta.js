// Roda no MUNDO DA PÁGINA, automaticamente, assim que a tela de compras abre.
// Faz as duas etapas sozinha:
//   1. lista os pedidos das abas Preparando (7) e A caminho (8)
//   2. entra em cada pedido e procura o código de rastreio
// Tudo com os cookies da própria sessão. Nada de CDP.
(() => {
  // Rastreio falso serviu para o vídeo de demonstração. Ligado por engano
  // em produção, escreveria um código inventado num pedido real.
  const SIMULAR = false;

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
    // Códigos reais das abas, lidos do HTML da própria página:
    //   6=Tudo  9=A Pagar  7=Preparando  8=A caminho
    //   3=Finalizado  4=Cancelado  12=Reembolso
    // "Tudo" primeiro porque supor a aba certa já nos custou duas rodadas:
    // pedi 7 e vieram pedidos concluídos. Os outros dois ficam como reforço,
    // e a deduplicação por order_id cuida da sobreposição.
    //
    // PAGINAÇÃO. Antes isto era uma chamada só, com offset=0: todas as contas
    // voltavam com exatamente 20 pedidos e o que passasse disso sumia sem
    // aviso nenhum. Agora avança o offset enquanto a página trouxer id novo.
    const LIMITE = 20;
    const MAX_PAGINAS = Number(self.MAX_PAGINAS ?? 10);   // teto: 200 pedidos por aba
    const MAX_DETALHES = Number(self.MAX_DETALHES ?? 60);

    const listas = [];
    const ids = new Set();

    for (const tipo of [6, 8, 7]) {
      for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
        const offset = pagina * LIMITE;
        const antes = ids.size;
        let respondeu = false;

        for (const c of [
          `/api/v4/order/get_all_order_and_checkout_list?limit=${LIMITE}&offset=${offset}&list_type=${tipo}`,
          `/api/v4/order/get_order_list?limit=${LIMITE}&offset=${offset}&list_type=${tipo}`,
        ]) {
          const r = { tipo, pagina, ...(await pegar(c)) };
          listas.push(r);
          if (r.ok) { respondeu = true; coletarIds(r.corpo, ids); }
        }

        // nenhuma resposta, ou a página não trouxe nada novo: acabou esta aba
        if (!respondeu || ids.size === antes) break;
        await new Promise((r) => setTimeout(r, 200)); // ritmo humano entre páginas
      }
    }

    const pedidos = [];
    for (const id of [...ids].slice(0, MAX_DETALHES)) {
      // Só o get_order_detail responde — os outros dois eram 2 chamadas
      // desperdiçadas por pedido, e com 25 pedidos isso estourava o prazo
      // da fila. Ficam como reserva, usados apenas se o primeiro falhar.
      // (o teto de detalhes é MAX_DETALHES; a lista já vem do mais novo
      //  para o mais antigo, então os do dia estão sempre no começo)
      const respostas = [await pegar(`/api/v4/order/get_order_detail?order_id=${id}`)];
      if (!respostas[0].ok)
        for (const c of [
          `/api/v4/order/get_order_detail?order_id=${id}&order_list_tab=7`,
          `/api/v4/order/get_tracking_info?order_id=${id}`,
        ]) {
          respostas.push(await pegar(c));
          if (respostas.at(-1).ok) break;
        }

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
      await new Promise((r) => setTimeout(r, 250)); // ritmo humano entre pedidos
    }

    // A conta vem marcada no fragmento da URL (#conta=196) na hora de abrir
    // a aba. Sem isso o coletor não sabe de qual perfil veio cada pedido.
    const conta = new URLSearchParams(location.hash.slice(1)).get("conta");

    // Sessão caída não é coleta vazia: é outra coisa. Reportar como coleta
    // fazia a fila dar a conta por concluída no meio do login.
    //
    // A Shopee tem mais de um jeito de dizer "não está logado", e o antigo
    // (error 19, ou cair em /buyer/login) não é mais o único. Na rodada de
    // 21/10 as contas 125 e 150 voltaram assim — e viraram "coleta com zero
    // pedidos", que a conferência mostrou como 12 "não achado na conta":
    //   - 403 com { is_login: false, error: 90309999 } em todas as listas,
    //     a página parada em /user/purchase (conta 150);
    //   - página /verify/traffic/error?is_logged_in=false, "Login Necessário"
    //     (conta 125).
    const semSessao = (l) =>
      l.corpo?.error === 19 || l.corpo?.error === 90309999 || l.corpo?.is_login === false ||
      l.status === 401 || l.status === 403 || /authenticate/i.test(l.corpo?.error_msg ?? "");
    const nenhumaListaRespondeu = !listas.some((l) => l.ok);
    const naoAutenticado =
      /\/buyer\/login/.test(location.pathname) || /\/verify\//.test(location.pathname) ||
      (nenhumaListaRespondeu && listas.some(semSessao));
    // "Verificar Identidade" é do login.js (ele busca o link no e-mail).
    // Mandar para o /buyer/login daqui recomeçava o login do zero.
    if (/\/verify\/ivs/.test(location.pathname)) return;
    if (naoAutenticado) {
      const motivo = /\/verify\//.test(location.pathname)
        ? "a Shopee mostrou a página de verificação de tráfego (sessão caiu)"
        : "a Shopee respondeu que a conta não está logada";
      // Uma ida ao login por aba. Se voltou do login e AINDA não tem
      // sessão, não é caso de tentar de novo: é bloqueio, e precisa de uma
      // pessoa — insistir é o que faz a Shopee endurecer com a conta.
      let jaFoi = false;
      try { jaFoi = sessionStorage.getItem("esteira-foi-ao-login") === "1"; } catch {}
      if (jaFoi) {
        publicar({ tipo: "precisa-humano", motivo: `${motivo}, mesmo depois de entrar`, pagina: location.href });
        return;
      }
      publicar({ tipo: "nao-autenticado", motivo, pagina: location.href });
      if (/\/buyer\/login/.test(location.pathname)) return;   // o login.js já está aqui
      try { sessionStorage.setItem("esteira-foi-ao-login", "1"); } catch {}
      // O login automático (login.js) só age em /buyer/login. Sem ir até lá,
      // ninguém tentava entrar e a conta ficava "sem pedidos".
      setTimeout(() => {
        location.href = "https://shopee.com.br/buyer/login?next=" +
          encodeURIComponent("https://shopee.com.br/user/purchase?type=7");
      }, 1500);
      return;
    }
    // Coleta boa: a próxima queda de sessão nesta aba pode tentar o login.
    try { sessionStorage.removeItem("esteira-foi-ao-login"); } catch {}

    // Nenhuma lista respondeu, mas também não foi sessão: não é "zero
    // pedidos". Publicar isso como coleta faz a conferência acusar todos os
    // pedidos da conta de "não achado".
    if (nenhumaListaRespondeu) {
      publicar({ tipo: "coleta-falhou",
        motivo: `nenhuma lista de pedidos respondeu (${[...new Set(listas.map((l) => l.status ?? l.erro))].join(", ")})`,
        pagina: location.href });
      return;
    }

    publicar({
      tipo: "coleta",
      conta,
      listasBrutas: listas.filter((l) => l.ok).map((l) => ({ caminho: l.caminho, corpo: l.corpo })),
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
