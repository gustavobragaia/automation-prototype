// Faz o login na Shopee quando a sessão caiu. Roda no mundo ISOLADO, dentro
// da própria página — sem CDP, que é o que a Shopee detecta.
//
// As credenciais NÃO ficam aqui: são pedidas ao service worker, que busca no
// coletor local com o token da rodada. Uma página web não fala com o service
// worker nem lê arquivos da extensão, então não alcança a senha.
//
// Verificação de imagem não é contornada: se aparecer, o robô para e avisa.
(() => {
  const SEL = {
    usuario: 'input[name="loginKey"]',
    senha: 'input[name="password"]',
    // a classe do botão é ofuscada e muda; o texto não
    entrar: () => [...document.querySelectorAll("button")]
      .find((b) => /^(entrar|log ?in)$/i.test((b.innerText || "").trim())),
    // campo do código de verificação
    codigo: 'input[name="otp"], input[maxlength="6"], input[inputmode="numeric"]',
  };

  const pedir = (tipo, extra = {}) =>
    new Promise((r) => chrome.runtime.sendMessage({ pedido: tipo, ...extra }, r));

  const avisar = (tipo, extra = {}) =>
    chrome.runtime.sendMessage({ tipo, pagina: location.href, ...extra });

  // Preenche de um jeito que o React enxergue: atribuir .value direto não
  // dispara o onChange, e o formulário continua achando que está vazio.
  function preencher(el, valor) {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter ? setter.call(el, valor) : (el.value = valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const esperar = (sel, ms = 15000) => new Promise((r) => {
    const t0 = Date.now();
    const i = setInterval(() => {
      const el = typeof sel === "function" ? sel() : document.querySelector(sel);
      if (el) { clearInterval(i); r(el); }
      else if (Date.now() - t0 > ms) { clearInterval(i); r(null); }
    }, 300);
  });

  const temVerificacaoDeImagem = () =>
    ["#NEW_CAPTCHA", "#captchaMask", "aside[aria-modal=true] canvas"].some((s) => document.querySelector(s));

  async function entrar() {
    // Abas restauradas também caem aqui; só a primeira loga.
    const trava = await pedir("travar-login");
    if (!trava?.ok) return;

    const campoUsuario = await esperar(SEL.usuario);
    if (!campoUsuario) return avisar("login-falhou", { motivo: "campo de usuário não apareceu" });

    const cred = await pedir("credencial");
    if (!cred?.email) return avisar("login-falhou", { motivo: cred?.erro ?? "coletor não devolveu credencial" });

    preencher(campoUsuario, cred.email);
    preencher(document.querySelector(SEL.senha), cred.senha);
    avisar("login-iniciado", { email: cred.email });

    const inicio = Math.floor(Date.now() / 1000);
    (await esperar(SEL.entrar))?.click();

    // A partir daqui, três desfechos: entrou, pediu código, ou pediu
    // verificação de imagem.
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      await new Promise((r) => setTimeout(r, 1500));

      if (temVerificacaoDeImagem())
        return avisar("precisa-humano", { motivo: "Shopee pediu verificação de imagem" });

      if (!/\/buyer\/login/.test(location.pathname)) {
        avisar("login-ok", { duracaoMs: Date.now() - t0 });
        // A Shopee devolve para onde a pessoa tentou ir, que pode ser
        // qualquer página. A coleta acontece em Minhas Compras.
        if (!/\/user\/purchase/.test(location.pathname))
          location.href = "https://shopee.com.br/user/purchase?type=7";
        return;
      }

      const campoCodigo = document.querySelector(SEL.codigo);
      if (campoCodigo && !campoCodigo.value) {
        const r = await pedir("otp", { desde: inicio });
        if (!r?.codigo) return avisar("login-falhou", { motivo: r?.erro ?? "código não chegou no e-mail" });
        preencher(campoCodigo, r.codigo);
        avisar("otp-preenchido");
        (await esperar(SEL.entrar, 5000))?.click();
      }
    }
    avisar("login-falhou", { motivo: "sem desfecho em 60s" });
  }

  if (/\/buyer\/login/.test(location.pathname)) entrar();
})();
