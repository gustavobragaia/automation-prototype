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
    const por = (v) => {
      setter ? setter.call(el, v) : (el.value = v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    el.focus();
    por("");        // limpa o que o gerenciador de senhas já colocou
    por(valor);
    el.blur();
  }

  const esperar = (sel, ms = 15000) => new Promise((r) => {
    const t0 = Date.now();
    const i = setInterval(() => {
      const el = typeof sel === "function" ? sel() : document.querySelector(sel);
      if (el) { clearInterval(i); r(el); }
      else if (Date.now() - t0 > ms) { clearInterval(i); r(null); }
    }, 300);
  });

  // A Shopee abre um modal de idioma por cima do formulário na primeira
  // visita. Os campos existem e são preenchíveis, mas o clique em ENTRAR
  // não chega — o modal intercepta. Sem fechar, o login trava calado.
  async function fecharModais() {
    for (let i = 0; i < 10; i++) {
      const idioma = [...document.querySelectorAll("button")]
        .find((b) => /^portugu[eê]s/i.test((b.innerText || "").trim()));
      if (!idioma) break;
      idioma.click();
      avisar("modal-idioma-fechado");
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  // A Shopee escreve o motivo na tela: senha errada, conta bloqueada,
  // excesso de tentativas. Ignorar isso e esperar 60s dá "sem desfecho",
  // que não ajuda ninguém a entender o que houve.
  const ERROS = [
    [/senha.*(inv[aá]lid|incorret)|incorrect password|wrong password/i, "senha inválida"],
    [/usu[aá]rio.*n[aã]o.*(existe|encontrad)|account does not exist/i, "conta não existe"],
    [/muitas tentativas|too many|tente novamente mais tarde/i, "excesso de tentativas"],
    [/conta.*(bloquead|suspens)|account.*(locked|banned)/i, "conta bloqueada"],
    [/c[oó]digo.*(inv[aá]lid|incorret)/i, "código de verificação inválido"],
  ];

  function erroNaTela() {
    const texto = document.body?.innerText ?? "";
    for (const [re, motivo] of ERROS) if (re.test(texto)) return motivo;
    return null;
  }

  const temVerificacaoDeImagem = () =>
    ["#NEW_CAPTCHA", "#captchaMask", "aside[aria-modal=true] canvas"].some((s) => document.querySelector(s));

  // A vez de logar. Um login por vez na rodada inteira (vários logins
  // juntos fizeram a Shopee pedir verificação por imagem). Quem perde a vez
  // ESPERA e tenta de novo. Antes desistia para sempre: na rodada de 21/10
  // na Chomps, com dezenas de sessões caídas, só uma conta entrava e as
  // outras ficavam paradas na tela de login até a fila estourar o prazo.
  // Cada pedido negado avisa o coletor, e é isso que mantém a fila esperando.
  async function esperarVez() {
    for (;;) {
      const t = await pedir("travar-login");
      if (t?.ok) return true;
      if (!/\/buyer\/login/.test(location.pathname)) return false;   // saiu do login: nada a fazer
      await new Promise((r) => setTimeout(r, 6000));
    }
  }

  async function entrar() {
    await fecharModais();
    // Abas restauradas também caem aqui; só a primeira loga.
    if (!(await esperarVez())) return;

    await fecharModais();

    const campoUsuario = await esperar(SEL.usuario);
    if (!campoUsuario) return avisar("login-falhou", { motivo: "campo de usuário não apareceu" });

    const cred = await pedir("credencial");
    // Segunda vez na mesma rodada: o login anterior não pegou. Tentar de
    // novo é o que faz a Shopee pedir verificação por imagem.
    if (cred?.repetida) return avisar("precisa-humano", { motivo: "a Shopee pediu login de novo depois que o robô já tinha entrado — entre à mão nesta janela" });
    if (!cred?.email) return avisar("login-falhou", { motivo: cred?.erro ?? "coletor não devolveu credencial" });

    const campoSenha = await esperar(SEL.senha);
    if (!campoSenha) return avisar("login-falhou", { motivo: "campo de senha não apareceu" });

    preencher(campoUsuario, cred.email);
    preencher(campoSenha, cred.senha);
    avisar("login-iniciado", { email: cred.email });

    const botao = await esperar(SEL.entrar);
    if (!botao) return avisar("login-falhou", { motivo: "botão ENTRAR não apareceu" });

    // O gerenciador de senhas do perfil repõe o telefone e a senha salva
    // DEPOIS que preenchemos, e aí o que vai para a Shopee é a credencial
    // antiga — que volta como "senha inválida". Reconferir no instante do
    // clique é a única forma de garantir o que está sendo enviado.
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 400));
      if (campoUsuario.value === cred.email && campoSenha.value === cred.senha) break;
      preencher(campoUsuario, cred.email);
      preencher(campoSenha, cred.senha);
    }

    if (campoUsuario.value !== cred.email) {
      return avisar("login-falhou", {
        motivo: `o campo voltou para "${campoUsuario.value.slice(0, 24)}" — autopreenchimento do perfil`,
      });
    }
    avisar("campo-conferido", { valor: campoUsuario.value, senhaOk: campoSenha.value === cred.senha });

    const inicio = Math.floor(Date.now() / 1000);
    // O código de verificação vai para a mesma caixa: ativa antes do clique.
    await pedir("caixa");
    await fecharModais();   // o modal pode reaparecer entre o preenchimento e o clique

    // Se outro elemento estiver por cima, o clique vai para ele e o login
    // nunca acontece — melhor descobrir agora que esperar 60s em silêncio.
    const r = botao.getBoundingClientRect();
    const porCima = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (porCima && !botao.contains(porCima) && porCima !== botao)
      avisar("aviso", { motivo: `algo cobre o botão ENTRAR: ${porCima.tagName}.${(porCima.className || "").slice(0, 30)}` });

    botao.click();

    // A partir daqui, três desfechos: entrou, pediu código, ou pediu
    // verificação de imagem.
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      await new Promise((r) => setTimeout(r, 1500));

      if (temVerificacaoDeImagem())
        return avisar("precisa-humano", { motivo: "Shopee pediu verificação de imagem" });

      const erro = erroNaTela();
      if (erro) return avisar("login-falhou", { motivo: `a Shopee respondeu: ${erro}` });

      // Sair do /buyer/login NÃO é ter entrado. A Shopee pode mandar para
      // "Verificar Identidade" (/verify/ivs) ou outra verificação; tratar
      // isso como login-ok fazia o robô voltar para Minhas Compras, cair no
      // login de novo e entrar outra vez — 6 vezes em 30 s, até o captcha.
      if (/\/verify\/ivs/.test(location.pathname)) return verificarIdentidade(inicio);
      if (/\/verify\//.test(location.pathname))
        return avisar("precisa-humano", { motivo: `a Shopee pediu uma verificação (${location.pathname})` });

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
        await pedir("travar-login");   // renova a vez: o código pode levar 90s
        const r = await pedir("otp", { desde: inicio });
        if (!r?.codigo) return avisar("login-falhou", { motivo: r?.erro ?? "código não chegou no e-mail" });
        preencher(campoCodigo, r.codigo);
        avisar("otp-preenchido");
        (await esperar(SEL.entrar, 5000))?.click();
      }
    }
    avisar("login-falhou", { motivo: "sem desfecho em 60s" });
  }

  // "Verificar Identidade" (/verify/ivs): a Shopee manda um link por e-mail.
  // O robô pede o e-mail, busca o link na mesma caixa do código e abre aqui.
  // Uma vez só; se não der, a janela fica aberta para uma pessoa.
  const achaTexto = (re) => [...document.querySelectorAll("button, a, [role=button], div, span")]
    .filter((el) => re.test((el.innerText || "").trim()))
    .sort((a, b) => (a.innerText || "").length - (b.innerText || "").length)[0] ?? null;

  async function verificarIdentidade(desde) {
    let ja = false;
    try { ja = sessionStorage.getItem("esteira-ivs") === "1"; } catch {}
    if (ja) return avisar("precisa-humano", { motivo: "a Shopee pediu de novo para confirmar a identidade por e-mail — confirme nesta janela" });
    try { sessionStorage.setItem("esteira-ivs", "1"); } catch {}

    const botao = await esperar(() => achaTexto(/^verificar via link por e-?mail$/i), 15000);
    if (!botao) return avisar("precisa-humano", { motivo: "a Shopee pediu para confirmar a identidade e o botão do e-mail não apareceu" });
    await pedir("travar-login");   // renova a vez: o e-mail pode levar 2 min
    // Ativa a caixa ANTES de a Shopee mandar: caixa não ativada perde o e-mail.
    const caixa = await pedir("caixa");
    if (caixa?.erro) return avisar("precisa-humano", { motivo: `a Shopee pediu para confirmar a identidade por e-mail, e a caixa de e-mail não respondeu: ${caixa.erro}` });
    botao.click();
    // O que a Shopee mostrou depois do clique ("enviamos um link para…",
    // ou nada). Sem isto não dá para saber se o e-mail chegou a ser pedido.
    await new Promise((r) => setTimeout(r, 4000));
    avisar("verificacao-email-pedida", { motivo: (document.body?.innerText ?? "").replace(/\s+/g, " ").slice(0, 300) });

    const r = await pedir("link", { desde });
    if (!r?.link) return avisar("precisa-humano", { motivo: `a Shopee pediu para confirmar a identidade por e-mail, e ${r?.erro ?? "o link não chegou"}` });
    avisar("verificacao-link-aberto");
    try { sessionStorage.setItem("esteira-depois-do-link", "1"); } catch {}
    location.href = r.link;
  }

  // Depois do link a Shopee pode parar numa página de "verificado". Volta
  // para Minhas Compras, que é onde a coleta acontece.
  try {
    if (sessionStorage.getItem("esteira-depois-do-link") === "1" && !/\/verify\//.test(location.pathname)) {
      sessionStorage.removeItem("esteira-depois-do-link");
      avisar("login-ok", { via: "link do e-mail" });
      if (!/\/user\/purchase/.test(location.pathname))
        setTimeout(() => { location.href = "https://shopee.com.br/user/purchase?type=7"; }, 3000);
    }
  } catch {}

  // A Shopee troca /user/purchase por /buyer/login POR DENTRO da SPA, sem
  // recarregar. Content script casado só com a URL de login nunca era
  // injetado na aba que a fila abre — ela nasce em /user/purchase.
  // Por isso este script roda em qualquer página da Shopee e observa a URL.
  let jaTentou = false;
  function talvezEntrar() {
    if (jaTentou) return;
    // Caiu direto em "Verificar Identidade", sem passar pelo nosso login.
    if (/\/verify\/ivs/.test(location.pathname)) {
      jaTentou = true;
      pedir("login-ligado").then((r) => {
        if (r?.ok === false) return avisar("precisa-humano", { motivo: "a Shopee pediu para confirmar a identidade" });
        pedir("travar-login").then(() => verificarIdentidade(Math.floor(Date.now() / 1000)))
          .catch((e) => avisar("precisa-humano", { motivo: `erro no login.js: ${e?.message ?? e}` }));
      });
      return;
    }
    if (!/\/buyer\/login/.test(location.pathname)) return;
    jaTentou = true;
    pedir("login-ligado").then((r) => {
      if (r?.ok === false) return avisar("sessao-caida");
      entrar().catch((e) =>
        avisar("login-falhou", { motivo: `erro no login.js: ${e?.message ?? e}` }));
    });
    return;
  }

  talvezEntrar();
  setInterval(talvezEntrar, 1000);
})();
