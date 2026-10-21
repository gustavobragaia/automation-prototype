// Ponte entre a página e o coletor local. Fica aqui, e não no content
// script, porque páginas web não conseguem falar com o service worker —
// é isso que mantém a senha fora do alcance de uma aba qualquer.

importScripts("sessao.js");   // define self.COLETOR_TOKEN, gerado por rodada

const COLETOR = "http://127.0.0.1:3000";

// DUAS travas, em camadas:
//   1. aqui, entre as abas DESTE perfil — barata, sem ida ao coletor. O
//      perfil restaura as abas da sessão anterior e todas caem no
//      /buyer/login, então sem isto eram 4 logins simultâneos.
//   2. no coletor, entre PERFIS — este service worker não enxerga os outros
//      navegadores abertos pela fila, e é lá que mora a rodada inteira.
// A aba que ganha a 1 ainda precisa ganhar a 2.
let donoDoLogin = null;
let travadoEm = 0;
const TRAVA_VALE_MS = 120_000;  // dona que não concluiu em 2 min perde a vez (igual ao coletor)

// A aba restaurada costuma chegar primeiro e pegar a trava; logo depois a
// fila a fecha, e a trava ficava presa numa aba morta — nenhuma outra
// conseguia logar.
chrome.tabs?.onRemoved?.addListener((id) => {
  if (id === donoDoLogin) {
    donoDoLogin = null; travadoEm = 0;
    travaGlobal("soltar").catch(() => {});   // aba morta não segura a rodada
  }
});

const contar = (tipo, extra = {}) =>
  fetch(`${COLETOR}/captura`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipo, conta: self.COLETOR_CONTA ?? null, em: Date.now(), ...extra }),
  }).catch(() => {});

const travaGlobal = (acao) => {
  const u = new URL(`${COLETOR}/trava-login`);
  u.searchParams.set("conta", self.COLETOR_CONTA ?? "");
  u.searchParams.set("token", self.COLETOR_TOKEN ?? "");
  u.searchParams.set("acao", acao);
  return fetch(u).then((r) => r.json());
};

// Desfechos do login. Soltar a vez aqui é o que faz a fila andar; sem isto
// os outros perfis só entrariam quando a trava expirasse.
const FIM_DO_LOGIN = new Set(["login-ok", "login-falhou", "precisa-humano"]);

chrome.runtime.onMessage.addListener((msg, remetente, responder) => {
  if (msg?.pedido === "login-ligado") {
    responder({ ok: self.LOGIN_AUTOMATICO !== false });
    return true;
  }

  if (msg?.pedido === "qual-conta") {
    responder({ conta: self.COLETOR_CONTA ?? null });
    return true;
  }

  if (msg?.pedido === "travar-login") {
    const aba = remetente.tab?.id ?? 0;
    const expirou = donoDoLogin !== null && Date.now() - travadoEm > TRAVA_VALE_MS;
    if (donoDoLogin === null || expirou) { donoDoLogin = aba; travadoEm = Date.now(); }

    if (donoDoLogin !== aba) {        // perdeu para outra aba do mesmo perfil
      contar("login-cedido", { aba, de: "aba" });
      responder({ ok: false });
      return true;
    }

    // ganhou aqui dentro; agora disputa com os outros perfis
    travaGlobal("pedir")
      .then((r) => {
        const meu = r?.meu === true;
        if (!meu) { donoDoLogin = null; travadoEm = 0; }   // devolve a vez local
        // Avisa dos dois lados: sem isto, trava negada era indistinguível
        // de content script que nem rodou.
        contar(meu ? "login-assumido" : "login-cedido",
               { aba, de: meu ? null : "rodada", dono: r?.dono ?? null });
        responder({ ok: meu });
      })
      .catch((e) => { contar("login-cedido", { aba, de: "erro", erro: String(e) });
                      responder({ ok: false }); });
    return true;   // resposta assíncrona
  }

  // O link de confirmação do e-mail abre numa aba própria, ao lado: a aba que
  // pediu a verificação é a que termina o login, e não pode sair do lugar.
  if (msg?.pedido === "abrir-aba") {
    chrome.tabs.create({ url: msg.url, active: false }, (aba) => {
      responder({ ok: true });
      setTimeout(() => chrome.tabs.remove(aba.id).catch?.(() => {}), 20_000);
    });
    return true;
  }

  // Pedidos que esperam resposta (credencial, código de verificação).
  if (msg?.pedido) {
    const rota = ["otp", "link", "caixa"].includes(msg.pedido) ? msg.pedido : "credencial";
    const url = new URL(`${COLETOR}/${rota}`);
    url.searchParams.set("conta", self.COLETOR_CONTA ?? "");
    url.searchParams.set("token", self.COLETOR_TOKEN ?? "");
    if (msg.desde) url.searchParams.set("desde", msg.desde);

    fetch(url)
      .then((r) => r.json())
      .then(responder)
      .catch((e) => responder({ erro: String(e) }));
    return true;   // mantém o canal aberto para a resposta assíncrona
  }

  if (msg?.tipo && FIM_DO_LOGIN.has(msg.tipo)) {
    donoDoLogin = null; travadoEm = 0;
    travaGlobal("soltar").catch(() => {});
  }

  // Avisos de mão única (coleta, login-ok, precisa-humano...).
  fetch(`${COLETOR}/captura`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // A conta vem daqui, não da página: o fragmento da URL morre no
    // redirect para o login, e era de lá que ela saía antes.
    body: JSON.stringify({ ...msg, conta: self.COLETOR_CONTA ?? null, aba: remetente.tab?.id, em: Date.now() }),
  }).catch(() => {});
});

// Avisa que subiu. Sem isso, "extensão não injetada" e "Shopee bloqueando"
// têm exatamente o mesmo sintoma: silêncio.
fetch(`${COLETOR}/captura`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ tipo: "extensao-viva", conta: self.COLETOR_CONTA ?? null,
                         temToken: Boolean(self.COLETOR_TOKEN), em: Date.now() }),
}).catch(() => {});
