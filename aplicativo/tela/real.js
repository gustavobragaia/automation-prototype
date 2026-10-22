// Liga a tela ao robô de verdade.
//
// Carregado DEPOIS da tela, de propósito: ela roda sozinha com dados de
// exemplo (é assim que o protótipo abre num navegador), e este arquivo troca
// gancho por gancho pelo de verdade. Só mexe pelas portas de `window.TELA` e
// `window.GANCHOS` — nada de alcançar variável interna nem remendar HTML.
//
// Se um pedaço falhar, a tela continua de pé com o exemplo em vez de ficar em
// branco: num app que o cliente abre de manhã, tela desatualizada é menos
// ruim que tela vazia. O que falhou vai pro console e pro selo do cabeçalho.
(function(){
"use strict";
if (!window.esteira) { console.info("[esteira] sem ponte — dados de exemplo"); return; }
// Antes de qualquer coisa: a tela não sabe em que janela está. No macOS a
// barra de título fica escondida e os botões do sistema caem em cima da
// marca — o CSS abre espaço quando sabe disso.
try { document.documentElement.dataset.janela = window.esteira.plataforma || ""; } catch (e) {}

var TELA = window.TELA, GANCHOS = window.GANCHOS;
if (!TELA || !GANCHOS) { console.error("[esteira] a tela não expôs TELA/GANCHOS"); return; }

async function pedir(acao, carga){
  var r = await window.esteira.pedir(acao, carga || {});
  if (!r || !r.ok) throw new Error((r && r.erro) || "sem resposta");
  var d = r.dado;
  // a ponte embrulha duas vezes quando a ação passa por `tentar`
  if (d && typeof d === "object" && "ok" in d && ("dado" in d || "erro" in d)) {
    if (!d.ok) throw new Error(d.erro);
    return d.dado;
  }
  return d;
}

var trocou = [], falhou = [];

/* ── O estado das conexões, no pé da barra lateral ── */
// Só aparece depois de um teste de verdade: o do AdsPower roda sozinho ao
// abrir (e de novo a cada "Testar conexão"), o da Shopify vem da loja salva.
// null = ainda não testou; nada é dito antes disso.
var conexao = { ads: null, shop: null };
function pintaConexao(){
  var el = document.getElementById("ladoStatus");
  if (!el || (conexao.ads === null && conexao.shop === null)) return;
  var falta = [];
  if (conexao.ads === false) falta.push("AdsPower não responde");
  if (conexao.shop === false) falta.push("Shopify não conectada");
  var tudo = conexao.ads === true && !!conexao.shop;
  el.hidden = false;
  el.className = "lado-status " + (falta.length ? "at" : tudo ? "ok" : "");
  el.innerHTML = '<span class="pt"></span><span>' + (falta.length
    ? "<b>Falta conectar</b><br>" + falta.join(" · ")
    : tudo ? "<b>Tudo conectado</b><br>AdsPower · " + String(conexao.shop).replace(/[<>&]/g, "")
    : "Conferindo as conexões…") + "</span>";
}

/* ── Esta máquina ── */
async function maquina(){ TELA.maquina(await pedir("maquina:ler")); }

/* ── Ajustes guardados: a chave do AdsPower e o endereço ── */
async function ajustes(){
  var a = await pedir("ajustes:ler");
  var $ = function(i){ return document.getElementById(i); };

  // Cada segredo é salvo sozinho, no momento em que a pessoa clica em
  // Salvar. Não entra no "salva tudo" dos outros campos: assim nunca há
  // como mandar de volta um valor que a tela não tem — ela nunca o teve.
  GANCHOS.salvarSegredo = function(qual, valor, pronto){
    var m = {}; m[qual] = valor;
    pedir("ajustes:salvar", m)
      .then(function(novo){ pronto(); TELA.ajustes(novo); })
      .catch(function(e){ TELA.avisar("Não consegui guardar", e.message); });
  };

  GANCHOS.lerSegredo = function(qual, pronto){
    pedir("ajustes:verSegredo", qual).then(pronto).catch(function(){ pronto(""); });
  };

  var simples = [["shPrefixo","emailPrefixo"],["shPrefixoAlto","emailPrefixoAlto"],
                 ["shDominio","emailDominio"],["shFaixa","emailFaixa"],
                 ["adsBase","adspowerBase"]];
  simples.forEach(function(par){
    if (a[par[1]] != null) $(par[0]).value = a[par[1]];
  });
  // "0" não é uma faixa: quer dizer que não há segundo começo de e-mail.
  if (!(Number(a.emailFaixa) > 0)) $("shFaixa").value = "";
  TELA.ajustes(a);

  var gravar = function(){
    var m = {};
    simples.forEach(function(par){ m[par[1]] = $(par[0]).value.trim(); });
    m.emailFaixa = Number($("shFaixa").value.trim()) || 0;
    m.loginAutomatico = $("chLogin").getAttribute("aria-pressed") === "true";
    pedir("ajustes:salvar", m)
      .then(function(novo){ TELA.ajustes(novo); })
      // Antes só ia para o console: a pessoa mudava o campo, nada era
      // guardado, e ela descobria no dia seguinte.
      .catch(function(e){ TELA.avisar("Não consegui guardar o ajuste", e.message); });
  };
  simples.forEach(function(par){ $(par[0]).addEventListener("change", gravar); });
  $("chLogin").addEventListener("click", function(){ setTimeout(gravar, 0); });

  GANCHOS.guardarPreferencia = function(m){
    pedir("ajustes:salvar", m)
      .catch(function(e){ TELA.avisar("Não consegui guardar o ajuste", e.message); });
  };
}

/* ── AdsPower: o botão testa de verdade ── */
function adspower(){
  // Um teste que não responde não pode girar para sempre. 20 segundos é
  // muito mais que os ~2s de sempre, e bem menos que os minutos que o
  // AdsPower pode levar quando trava sincronizando.
  var PRAZO_MS = 20000;
  GANCHOS.testarAds = async function(){
    var botao = document.getElementById("bTestarAds");
    botao.disabled = true;
    try {
      var prazo = new Promise(function(_, nao){
        setTimeout(function(){ nao(new Error("prazo")); }, PRAZO_MS); });
      var d = await Promise.race([pedir("adspower:diagnosticar", {
        base:  (document.getElementById("adsBase") ||{}).value,
      }), prazo]);
      conexao.ads = !!d.ok; pintaConexao();
      TELA.diagnostico({
        ok: d.ok, titulo: d.titulo, provado: d.verificado,
        passos: d.comoResolver, abertaSemChave: d.abertaSemChave,
      });
    } catch (e) {
      if (e.message === "prazo")
        TELA.diagnostico({ ok:false, titulo:"O AdsPower não respondeu em 20 segundos",
          passos:["Confira se o AdsPower está aberto e terminou de carregar.",
                  "Se ele estiver sincronizando perfis, espere acabar e teste de novo.",
                  "Se continuar, feche e abra o AdsPower."] });
      else
        TELA.diagnostico({ ok:false, titulo:"Não consegui testar", passos:[e.message] });
    } finally { botao.disabled = false; }
  };
}

/* ── Shopify ── */
async function shopify(){
  GANCHOS.conectarShopify = async function(loja){
    try { await pedir("shopify:conectar", { loja: loja }); esperarShopify(); }
    catch (e) { TELA.shopify("desconectada"); TELA.avisar("Não consegui abrir a Shopify", e.message); }
  };
  GANCHOS.cancelarShopify = function(){ pararEspera(); pedir("shopify:cancelar").catch(function(){}); };
  // o pé da barra lateral não pode continuar dizendo "conectada"
  GANCHOS.desconectarShopify = function(){
    return pedir("shopify:desconectar").then(function(r){ conexao.shop = false; pintaConexao(); return r; });
  };
  // Rejeita com a frase da ponte; a tela mostra no próprio cartão.
  GANCHOS.conectarCredenciais = async function(loja, clientId, clientSecret){
    await pedir("shopify:conectarCredenciais", { loja: loja, clientId: clientId, clientSecret: clientSecret });
    await mostrarShopify();
  };
  await mostrarShopify();
}
function quandoTxt(iso){
  if (!iso) return "—";
  var d = new Date(iso); if (isNaN(d)) return "—";
  var hm = ("0"+d.getHours()).slice(-2) + ":" + ("0"+d.getMinutes()).slice(-2);
  var hoje = new Date(); hoje.setHours(0,0,0,0);
  // dia local, não UTC: toISOString joga a data pro dia anterior no Brasil
  return d >= hoje ? "hoje, " + hm
    : ("0"+d.getDate()).slice(-2) + "/" + ("0"+(d.getMonth()+1)).slice(-2) + ", " + hm;
}
var relogio = null;
function pararEspera(){ if (relogio) { clearInterval(relogio); relogio = null; } }
function esperarShopify(){
  pararEspera();
  // A aprovação acontece no navegador; esta tela não tem como ser avisada,
  // então pergunta de segundo em segundo. Dois jeitos de terminar: a loja
  // aparece conectada, ou a tentativa deixou de existir (recusada, expirada
  // ou cancelada) — sem o segundo caso a tela ficaria girando pra sempre.
  relogio = setInterval(async function(){
    try {
      if ((await pedir("shopify:estado")).conectada) { pararEspera(); return mostrarShopify(); }
      if (!(await pedir("shopify:conectando"))) { pararEspera(); TELA.shopify("desconectada"); }
    } catch (e) { pararEspera(); TELA.shopify("desconectada");
                  console.error("[esteira] shopify:", e.message); }
  }, 1000);
}
async function mostrarShopify(){
  var e = await pedir("shopify:estado");
  conexao.shop = e.conectada ? (e.loja || e.dominio) : false; pintaConexao();
  if (!e.conectada) return TELA.shopify("desconectada");
  TELA.shopify("conectada", {
    loja: e.loja || e.dominio, dominio: e.dominio,
    escopos: (e.escopos||[]).length, faltando: e.faltando || [],
    // Só o token fixo e o OAuth sem prazo são permanentes. No modo
    // "credenciais" (ID + chave) o acesso vale 24h e o robô renova sozinho —
    // dizer "não expira" aí seria mentira.
    permanente: e.modo !== "credenciais" && !e.expiraEm, modo: e.modo,
    quando: quandoTxt(e.conectadoEm),
  });
}

/* ── Planilha: o diálogo do sistema, e leitura de verdade ── */
function planilha(){
  GANCHOS.esquecerPlanilha = function(caminho){
    if (caminho) pedir("planilha:esquecer", { caminho: caminho })
      .catch(function(e){ TELA.avisar("Não consegui tirar a planilha da rodada", e.message); });
  };
  GANCHOS.escolherPlanilha = async function(){
    var caminhos = await window.esteira.escolherPlanilha();
    for (var i = 0; i < caminhos.length; i++) await ler(caminhos[i]);
  };
  GANCHOS.soltarPlanilha = async function(arquivos){
    for (var i = 0; i < arquivos.length; i++) {
      var caminho = window.esteira.caminhoDoArquivo(arquivos[i]);
      if (!caminho) {
        TELA.avisar("Não consegui ler esse arquivo",
                    "Tente pelo botão, escolhendo o arquivo na janela do sistema.");
        continue;
      }
      await ler(caminho);
    }
  };
}
async function ler(caminho){
  var nome = caminho.split(/[\\/]/).pop();
  try {
    var r = await pedir("planilha:ler", { caminho: caminho });
    TELA.planilha(nome, {
      caminho: caminho,
      linhas: r.total, pedidos: r.pendentes, contas: r.contas.length,
      ja: Math.max(0, r.total - r.pendentes - (r.ignorados||0)),
      lista: r.contas.map(function(c){ return c.conta; }),
      semConta: r.semConta || [],
    });
  } catch (e) {
    console.error("[esteira] planilha " + nome + ":", e.message);
    TELA.avisar("Não consegui ler " + nome, e.message);
  }
}

/* ── A rodada de verdade ── */
var ESTADO_DO_EVENTO = {
  "conta:abrindo": "abrindo", "conta:aberta": "abrindo", "conta:logando": "logando",
  "conta:humano": "humano", "conta:lendo": "lendo", "conta:feita": "feita",
  "conta:falhou": "falhou", "conta:repetindo": "repetindo", "conta:adiada": "adiada",
};
function rodada(){
  // A escuta começa antes de qualquer rodada: o coletor sobe junto com o app
  // e já emite por conta própria enquanto o cliente ainda está na etapa 1.
  window.esteira.aoEvento(function(e){
    if (e.tipo === "escrita:progresso") return TELA.escritaProgresso(e);
    if (e.tipo === "rodada:inicio") return TELA.rodada.montar(e.contas || []);
    if (e.tipo === "rodada:fim") {
      TELA.rodada.terminar(e);
      // A conciliação já rodou junto com a coleta; agora a lista é real.
      if (!e.erro) { carregarConferencia(); carregarEscrita(); }
      recarregar();
      return;
    }
    var estado = ESTADO_DO_EVENTO[e.tipo];
    if (!estado) return;
    TELA.rodada.conta(e.conta, estado, e);
    // Só este caso merece som: a rodada parou e não anda sem uma pessoa.
    if (e.tipo === "conta:humano")
      TELA.avisar("A conta " + e.conta + " precisa de você",
                  e.motivo || "A Shopee pediu verificação.");
  });

  GANCHOS.rodar = async function(){
    if (await pedir("rodada:emCurso")) return;
    var botao = document.getElementById("bRodar");
    botao.disabled = true;
    document.getElementById("bParar").textContent = "Parar";
    try {
      // Quais contas e qual perfil de cada uma: sai da planilha cruzada com
      // os perfis do AdsPower, não de um palpite da tela.
      var contas = await pedir("rodada:contas", []);
      if (!contas.length) throw new Error("nenhuma conta para abrir nesta planilha");
      await pedir("rodada:iniciar", {
        contas: contas,
        escrever: document.getElementById("chDireto").getAttribute("aria-pressed") === "true",
        concorrencia: paraleloEscolhido(),
      });
    } catch (e) {
      // A rodada já mandou "rodada:fim", então a tela não fica girando;
      // aqui é só dizer por quê.
      TELA.rodada.terminar({ erro: e.message });
      TELA.erroNaRodada(e.message);
      TELA.avisar("A rodada não terminou", e.message);
      console.error("[esteira] rodada:", e.message);
    } finally { botao.disabled = false; }
  };

  // "Tentar de novo só essas", no alerta do fim da rodada: as mesmas
  // planilhas, só as contas que não foram lidas. As outras não são abertas de
  // novo, e o que já foi lido delas continua valendo na conferência.
  GANCHOS.rerodar = async function(numeros){
    // Com a fila desta rodada ainda andando, a conta volta para o fim dela
    // (a pessoa corrigiu a senha à mão e não quer esperar o fim). Sem fila
    // andando, começa uma rodada só com essas.
    try {
      var r = await pedir("rodada:repetir", { contas: numeros });
      if (r.naFila.length) TELA.avisar("De volta à fila",
        (r.naFila.length > 1 ? "As contas " + r.naFila.join(", ") + " voltaram" : "A conta " + r.naFila[0] + " voltou") +
        " para o fim da fila desta rodada.");
      var POR_QUE = { "ja-na-fila": "já está na fila ou abrindo agora", "nao-falhou": "não falhou nesta rodada" };
      r.fora.filter(function(f){ return f.motivo !== "sem-rodada"; }).forEach(function(f){
        TELA.avisar("Conta " + f.conta + " não voltou para a fila", POR_QUE[f.motivo] || f.motivo);
      });
      numeros = r.fora.filter(function(f){ return f.motivo === "sem-rodada"; }).map(function(f){ return f.conta; });
      if (!numeros.length) return;
    } catch (e) { return TELA.avisar("Não consegui pôr de volta na fila", e.message); }
    if (await pedir("rodada:emCurso")) return TELA.avisar("A coleta desta rodada já terminou", "Clique de novo quando a rodada acabar.");
    try {
      var todas = await pedir("rodada:contas", []);
      var contas = todas.filter(function(c){ return numeros.indexOf(Number(c.conta)) >= 0; });
      if (!contas.length) throw new Error("essas contas não estão nas planilhas escolhidas");
      document.querySelector('[data-etapa="2"]')?.click();
      await pedir("rodada:iniciar", {
        contas: contas,
        escrever: document.getElementById("chDireto").getAttribute("aria-pressed") === "true",
        concorrencia: paraleloEscolhido(),
      });
    } catch (e) {
      TELA.rodada.terminar({ erro: e.message });
      TELA.avisar("Não consegui tentar de novo", e.message);
    }
  };

  GANCHOS.pararRodada = async function(){
    var b = document.getElementById("bParar");
    b.disabled = true; b.textContent = "Parando…";
    try { await pedir("rodada:parar"); }
    catch (e) { TELA.avisar("Não consegui parar a rodada", e.message);
                b.disabled = false; b.textContent = "Parar"; }
    // O botão não volta: a rodada vai terminar sozinha e o "rodada:fim"
    // devolve a tela ao estado parado. Dizer "parado" antes disso seria
    // mentira — as contas que já abriram ainda estão lá.
  };
}
function paraleloEscolhido(){
  var b = document.querySelector('#seg button[aria-pressed="true"]');
  return b ? Number(b.dataset.n) : undefined;
}

/* ── A escrita em lote (etapa 4) ── */
function escrita(){
  GANCHOS.escrever = async function(){
    const r = await pedir("escrita:executar", {});
    recarregar();          // o histórico ganhou os escritos de agora
    // Depois de escrever, as duas listas mudam: quem entrou saiu da
    // conferência, quem a Shopify recusou entrou nela.
    carregarConferencia();
    return r;
  };
}
// `quieto`: ao só abrir a etapa, sem planilha escolhida ainda não é erro.
async function carregarEscrita(quieto){
  try { TELA.escrita(await pedir("escrita:listar")); }
  catch (e) {
    if (quieto && /nenhuma planilha/.test(e.message)) return;
    TELA.avisar("Não consegui montar a etapa 4", e.message);
  }
}
// O que já foi atendido na Shopify (resolvido por fora) sai da conferência.
// `quieto`: ao abrir a etapa, sem loja conectada ou sem rede, não é erro —
// a conferência só fica como estava.
var limpando = false;
GANCHOS.limparConferencia = async function(quieto){
  if (limpando) return;
  limpando = true;
  var botao = document.getElementById("bLimparConf");
  if (!quieto) { botao.disabled = true; botao.textContent = "Conferindo na Shopify…"; }
  try {
    var r = await pedir("conferencia:limparShopify");
    if (r.sairam.length) { TELA.confNaShopify(r.sairam); await carregarConferencia(true); recarregar(); }
    else if (!quieto) TELA.avisar("Nada para limpar", "Nenhum pedido da conferência está atendido na Shopify.");
  } catch (e) {
    console.error("[esteira] limpar conferência:", e.message);
    if (!quieto) TELA.avisar("Não consegui conferir na Shopify", e.message);
  } finally {
    limpando = false;
    botao.disabled = false; botao.textContent = "Conferir na Shopify e limpar";
  }
};
GANCHOS.desfazerLimpeza = async function(pedidos){
  var falhou = [];
  for (var i = 0; i < pedidos.length; i++) {
    try { await pedir("conferencia:desfazer", { pedido: pedidos[i] }); } catch (e) { falhou.push(pedidos[i]); }
  }
  TELA.confNaShopify([]);
  await carregarConferencia(true); recarregar();
  if (falhou.length) TELA.avisar("Não deu para desfazer todos", falhou.join(", "));
};
GANCHOS.aoAbrirEtapa = function(t){
  if (t === "3") carregarConferencia(true).then(function(){ return GANCHOS.limparConferencia(true); });
  if (t === "4") carregarEscrita(true);
};

/* ── A conferência ── */
function conferencia(){
  // Decidir pode ESCREVER na Shopify ("colei o rastreio"): o histórico
  // recarrega depois, como na escrita em lote. Antes só recarregava ao
  // reabrir o app.
  GANCHOS.decidir = async function(pedido, ordem){
    var r = await pedir("conferencia:decidir", {
      pedido: pedido, decisao: ordem.decisao, texto: ordem.texto,
      conta: ordem.conta, motivo: ordem.motivo, ate: ordem.ate,
    });
    recarregar();
    return r;
  };
  GANCHOS.conferirColado = async function(pedido, texto){
    var r = await pedir("manual:conferir", { pedido: pedido, texto: texto });
    if (!r || !r.ok) return { ok: false, erro: (r && r.erro) || "a Shopify não respondeu" };
    return { ok: true, pedido: r.alvo && r.alvo.pedido, nome: r.alvo && r.alvo.nome,
             cep: r.alvo && r.alvo.cep, codigos: r.codigos, transportadora: r.transportadora };
  };
  GANCHOS.desfazer = async function(pedido){
    var r = await pedir("conferencia:desfazer", { pedido: pedido });
    recarregar();
    return r;
  };
}

// Depois de uma rodada, a lista de quem precisa de você sai do robô.
async function carregarConferencia(quieto){
  try {
    TELA.conferencia(await pedir("conferencia:listar"));
  } catch (e) {
    if (quieto && /nenhuma planilha/.test(e.message)) return;
    console.error("[esteira] conferência:", e.message);
    TELA.avisar("Não consegui montar a conferência", e.message);
  }
}

/* ── As áreas que eram inventadas ── */
// Antes de qualquer coisa, tudo de exemplo sai da tela. Depois cada área
// se enche com o que o robô tem — e uma área vazia diz que está vazia.
async function arranque(){
  TELA.limparExemplos();
  var fontes = [
    ["vindos de dias anteriores", "pendentes:atrasados", TELA.atrasados],
    ["histórico", "historico:dias", TELA.historico],
    ["contas", "contas:listar", TELA.contas],
  ];
  var falhas = [];
  for (var i = 0; i < fontes.length; i++) {
    try { fontes[i][2](await pedir(fontes[i][1])); }
    catch (e) { falhas.push(fontes[i][0] + ": " + e.message); }
  }
  // Uma área que não carregou não pode ficar parecendo vazia de verdade.
  if (falhas.length) TELA.avisar("Parte da tela não carregou", falhas.join(" · "));
}
GANCHOS.proximaRodada = async function(){
  // As planilhas de ontem saem da lista do robô — senão a próxima rodada
  // abriria as contas delas de novo — e a etapa 1 recarrega da carteira.
  try { await pedir("planilha:esquecer", {}); } catch (e) {}
  recarregar();
};
// Ao abrir a aba Histórico, ela é lida de novo: o que foi escrito por
// qualquer caminho aparece sem precisar fechar o app.
document.querySelector('[data-tela="historico"]')?.addEventListener("click", function(){
  pedir("historico:dias").then(TELA.historico).catch(function(){});
});

async function recarregar(){
  try { TELA.atrasados(await pedir("pendentes:atrasados")); } catch (e) {}
  try { TELA.historico(await pedir("historico:dias")); } catch (e) {}
  try { TELA.contas(await pedir("contas:listar")); } catch (e) {}
}

/* ── Arquivos que a pessoa baixa ── */
function arquivos(){
  GANCHOS.baixarModelo = async function(){
    var caminho = await window.esteira.salvarComo("modelo-esteira.xlsx", "xlsx");
    if (!caminho) return;                            // desistiu: nada a dizer
    try {
      await pedir("planilha:modelo", { caminho: caminho });
      TELA.avisar("Modelo salvo", caminho.split(/[\\/]/).pop());
    } catch (e) { TELA.avisar("Não consegui salvar o modelo", e.message); }
  };
  GANCHOS.exportar = async function(o){
    var caminho = await window.esteira.salvarComo(o.nome, o.formato);
    if (!caminho) return;
    try {
      var r = await pedir("historico:exportar",
        { caminho: caminho, desde: o.desde, ate: o.ate, formato: o.formato });
      TELA.avisar("Exportado", r.linhas + " pedido" + (r.linhas === 1 ? "" : "s") +
                  " em " + caminho.split(/[\\/]/).pop());
    } catch (e) { TELA.avisar("Não consegui exportar", e.message); }
  };
}

/* ── Versão nova (atualização automática, só no Windows) ── */
function atualizacao(){
  var api = window.esteira.atualizacao; if (!api) return;
  var $ = function(i){ return document.getElementById(i); };
  var pinta = function(e){
    var caixa = $("ladoAtualiza"); if (!caixa || !e) return;
    if (e.estado !== "baixando" && e.estado !== "pronta") { caixa.hidden = true; return; }
    caixa.hidden = false;
    var pronta = e.estado === "pronta";
    $("atuTitulo").textContent = pronta ? "Versão " + e.versao + " pronta" : "Baixando a versão " + e.versao;
    $("atuTexto").textContent = pronta
      ? "Reinicie para usar. Se preferir, ela entra sozinha quando você fechar o Esteira."
      : "Em segundo plano — dá para continuar usando.";
    $("atuBarra").hidden = pronta;
    $("atuProgresso").style.width = (e.porcento || 0) + "%";
    $("bAtualizar").hidden = !pronta;
  };
  api.aoMudar(pinta);
  api.estado().then(pinta).catch(function(){});
  $("bAtualizar").onclick = async function(){
    var b = this; b.disabled = true; b.textContent = "Reiniciando…";
    var r = await api.reiniciar().catch(function(e){ return { ok:false, erro:e.message }; });
    if (!r || !r.ok) {
      b.disabled = false; b.textContent = "Reiniciar e atualizar";
      TELA.avisar("Ainda não dá para atualizar", (r && r.erro) || "tente de novo em instantes");
    }
  };
}

/* ── Alertas: o sino no topo da barra lateral ── */
async function alertas(){
  TELA.alertas(await pedir("alertas:ler"));
  var resolvidos = function(){ pedir("alertas:resolvidos").then(TELA.alertasResolvidos).catch(function(){}); };
  resolvidos();
  GANCHOS.exportarDiagnostico = async function(){
    var hoje = new Date().toISOString().slice(0, 10);
    var caminho = await window.esteira.salvarComo("diagnostico-esteira-" + hoje + ".txt", "txt");
    if (!caminho) return;
    try { await pedir("diagnostico:exportar", { caminho: caminho });
          TELA.avisar("Diagnóstico salvo", "Mande o arquivo " + caminho.split(/[\\/]/).pop() + " para o suporte."); }
    catch (e) { TELA.avisar("Não consegui exportar o diagnóstico", e.message); }
  };
  GANCHOS.dispensarAlerta = function(id){
    pedir("alertas:dispensar", id).then(function(l){ TELA.alertas(l); resolvidos(); })
      .catch(function(e){ TELA.avisar("Não consegui dispensar o alerta", e.message); });
  };
  window.esteira.aoEvento(function(e){
    if (e.tipo === "alerta:resolvido") { TELA.alertaResolvido(e.id); return resolvidos(); }
    if (e.tipo !== "alerta:novo") return;
    TELA.alertaNovo(e.alerta, e.novo);
    // Erro novo merece aviso do sistema; "precisa de você" já tem o seu.
    if (e.novo && e.alerta.nivel === "erro")
      TELA.avisar(e.alerta.titulo, e.alerta.acao || e.alerta.texto || "");
  });
}

/* ── Aviso pelo sistema operacional, não pelo navegador ── */
function avisos(){
  var doNavegador = TELA.avisar;
  TELA.avisar = function(t, c){ doNavegador(t, c); window.esteira.avisar(t, c); };
}

(async function(){
  // Primeiro tudo que só LIGA botões (instantâneo), depois o que CARREGA
  // (vai à ponte e espera). Na ordem antiga, um clique em "Testar conexão"
  // durante a abertura caía no comportamento do protótipo — que mostra um
  // "Conectado ao AdsPower" inventado.
  var partes = [
    // só ligam botões: instantâneos, rodam todos no mesmo instante, antes
    // que qualquer clique ou arrastar consiga acontecer
    ["AdsPower",adspower],["arquivos",arquivos],["planilha",planilha],["rodada",rodada],
    ["conferência",conferencia],["escrita",escrita],["avisos",avisos],["atualização",atualizacao],
    // carregam: vão à ponte e esperam
    ["arranque",arranque],["ajustes",ajustes],["máquina",maquina],["Shopify",shopify],["alertas",alertas]];
  for (var i = 0; i < partes.length; i++) {
    try { await partes[i][1](); trocou.push(partes[i][0]); }
    catch (e) { falhou.push(partes[i][0] + ": " + e.message); }
  }
  console.info("[esteira] de verdade: " + trocou.join(", "));
  // O AdsPower é testado em segundo plano: a tela já está de pé.
  pedir("adspower:diagnosticar", {})
    .then(function(d){ conexao.ads = !!d.ok; pintaConexao();
      // o mesmo resultado vai para o cartão do AdsPower em Ajustes
      TELA.diagnostico({ ok: d.ok, titulo: d.titulo, provado: d.verificado,
        passos: d.comoResolver, abertaSemChave: d.abertaSemChave }); })
    .catch(function(){ conexao.ads = false; pintaConexao(); });
  var selo = document.querySelector(".selo-proto");
  if (!selo) return;
  if (falhou.length) {
    console.warn("[esteira] seguiram com exemplo — " + falhou.join(" | "));
    selo.textContent = falhou.length + " em dados de exemplo";
    selo.title = falhou.join("\n");
  } else selo.remove();
})();
})();
