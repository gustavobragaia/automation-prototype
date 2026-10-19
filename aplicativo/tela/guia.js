// O guia da primeira vez.
//
// Abre sozinho quando o Esteira é aberto pela primeira vez (ajustes
// `guiaConcluido`), e de novo por Ajustes → "Abrir o guia". Não é um tour de
// balões apontando botões: cada passo de configuração É a configuração. O
// AdsPower só fica "pronto" depois que o teste de conexão passou; as contas,
// depois que o robô diz que não falta nada; a Shopify, depois que a loja
// aparece conectada. Quem termina o guia sai apto a rodar — ou sabendo
// exatamente o que ficou faltando.
//
// Fala só com a ponte (window.esteira), como real.js. Nada aqui é exemplo:
// sem ponte (o protótipo aberto num navegador), o guia nem aparece.
(function(){
"use strict";
if (!window.esteira) return;

async function pedir(acao, carga){
  var r = await window.esteira.pedir(acao, carga || {});
  if (!r || !r.ok) throw new Error((r && r.erro) || "sem resposta");
  var d = r.dado;
  if (d && typeof d === "object" && "ok" in d && ("dado" in d || "erro" in d)) {
    if (!d.ok) throw new Error(d.erro);
    return d.dado;
  }
  return d;
}
var esc = function(s){ return String(s == null ? "" : s).replace(/[&<>"]/g,
  function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); };

var PASSOS = [
  { id:"oi",      rot:"Boas-vindas",         sub:"o que o Esteira faz" },
  { id:"ads",     rot:"AdsPower",            sub:"a chave da API local" },
  { id:"contas",  rot:"Contas da Shopee",    sub:"e-mail, senha e código" },
  { id:"shopify", rot:"Shopify",             sub:"conectar a loja" },
  { id:"esteira", rot:"Como a esteira anda", sub:"as 4 etapas do dia" },
  { id:"pronto",  rot:"Pronto",              sub:"conferir tudo" },
];

/* ── Ícones: os mesmos que a tela já usa, para o guia não inventar marca ── */
var MARCA_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect class="caixa" x="8" y="5.5" width="8" height="7" rx="1.3"/>' +
  '<circle cx="5.5" cy="17.5" r="2.6"/><circle cx="18.5" cy="17.5" r="2.6"/>' +
  '<path class="lona" d="M5.5 14.9h13"/><path class="lona" d="M5.5 20.1h13"/></svg>';
function icone(qual){
  if (qual === "ads") {
    var img = document.querySelector("img.ads");
    return '<span class="g-icone">' + (img ? '<img src="' + img.src + '" alt="">' : "") + '</span>';
  }
  if (qual === "shopify") {
    var lg = document.querySelector(".rotulo svg.lg path");
    return '<span class="g-icone"><svg viewBox="0 0 24 24"><path fill="#95BF47" d="' +
      (lg ? lg.getAttribute("d") : "") + '"/></svg></span>';
  }
  if (qual === "shopee") return '<span class="g-icone"><svg viewBox="0 0 24 24" fill="none" stroke="#EE4D2D" ' +
    'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 8h15l-1.2 11.2a2 2 0 0 1-2 1.8H7.7a2 2 0 0 1-2-1.8z"/>' +
    '<path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8"/></svg></span>';
  if (qual === "ok") return '<span class="g-icone"><svg viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="2.4" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>';
  return '<span class="g-icone marca-g">' + MARCA_SVG + '</span>';
}
function cabecalho(ic, olho, titulo){
  return '<div class="g-cab">' + icone(ic) + '<div><span class="eyebrow">' + olho + '</span><h1>' + titulo + '</h1></div></div>';
}
function resultado(el, tipo, html){
  el.className = "g-res" + (tipo ? " " + tipo + "-caixa" : "");
  el.innerHTML = html;
}
// O que cada passo de configuração já provou nesta abertura do guia.
var feito = { ads:false, contas:false, shopify:false };
var aqui = 0, ajustes = null, mexeu = false, raiz = null, relogio = null;

/* ── A moldura ── */
function montar(){
  raiz = document.createElement("div");
  raiz.id = "guia"; raiz.setAttribute("role","dialog"); raiz.setAttribute("aria-modal","true");
  raiz.setAttribute("aria-label","Primeiros passos no Esteira");
  raiz.innerHTML =
    '<div class="g-caixa">' +
      '<aside class="g-lado"><span class="g-lado-topo">Configuração</span>' +
        '<div class="g-barra"><i id="gBarra"></i></div><span class="g-conta" id="gConta"></span>' +
        '<ol class="g-trilho" id="gTrilho"></ol>' +
        '<p class="g-lado-pe">Dá para sair e voltar quando quiser: o guia fica em Ajustes.</p></aside>' +
      '<div class="g-corpo"><div class="g-conteudo" id="gConteudo"></div>' +
        '<div class="g-pe"><button class="btn" id="gVoltar">Voltar</button>' +
          '<button class="g-pular" id="gPular">Configurar depois</button>' +
          '<button class="btn pri" id="gSeguir">Continuar</button></div></div>' +
    '</div>' +
    '<button class="g-fechar" id="gFechar" title="Fechar o guia — ele fica em Ajustes" aria-label="Fechar o guia">' +
      '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
  document.body.appendChild(raiz);
  raiz.querySelector("#gVoltar").onclick = function(){
    if (PASSOS[aqui].id === "esteira" && tour > 0) { tour--; return pintaTour(); }
    ir(aqui - 1); };
  raiz.querySelector("#gSeguir").onclick = seguir;
  raiz.querySelector("#gPular").onclick = function(){ ir(aqui + 1); };
  raiz.querySelector("#gFechar").onclick = function(){ concluir(false); };
}

function pintaTrilho(){
  raiz.querySelector("#gTrilho").innerHTML = PASSOS.map(function(p, i){
    // Passo de configuração: verde só com a prova; passado sem prova, alerta.
    var e = i === aqui ? "agora"
          : (p.id in feito) ? (feito[p.id] ? "feita" : i < aqui ? "alerta" : "")
          : i < aqui ? "feita" : "";
    var n = e === "feita" ? '<svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>'
          : e === "alerta" ? "!" : (i + 1);
    return '<li data-e="' + e + '"><span class="n">' + n + '</span>' +
           '<span class="t">' + p.rot + '<span class="s">' + p.sub + '</span></span></li>';
  }).join("");
  raiz.querySelector("#gBarra").style.width = Math.round(aqui / (PASSOS.length - 1) * 100) + "%";
  raiz.querySelector("#gConta").textContent = "Passo " + (aqui + 1) + " de " + PASSOS.length;
}

function ir(i){
  pararEspera();
  aqui = Math.max(0, Math.min(PASSOS.length - 1, i));
  var p = PASSOS[aqui];
  var c = raiz.querySelector("#gConteudo");
  c.innerHTML = TELAS[p.id]();
  // a animação de entrada roda de novo a cada passo
  c.style.animation = "none"; void c.offsetWidth; c.style.animation = "";
  raiz.scrollTop = 0;
  raiz.querySelector("#gVoltar").hidden = aqui === 0;
  // Pular só existe nos passos de configuração: nos outros não há o que pular.
  raiz.querySelector("#gPular").hidden = !(p.id in feito);
  pintaTrilho();
  (DEPOIS[p.id] || function(){})(c);
  pintaSeguir();
  var foco = c.querySelector("input:not([type=hidden]), .btn.pri") ;
  if (foco) setTimeout(function(){ try{ foco.focus(); }catch(e){} }, 30);
}

function pintaSeguir(){
  var p = PASSOS[aqui], b = raiz.querySelector("#gSeguir");
  b.textContent = p.id === "oi" ? "Começar" : p.id === "pronto" ? "Começar a usar" : "Continuar";
  b.classList.toggle("g-roxo", p.id === "oi" || p.id === "pronto");
  // Nos passos de configuração, "Continuar" só acende depois da prova.
  b.disabled = (p.id in feito) && !feito[p.id];
}

async function seguir(){
  var p = PASSOS[aqui];
  if (p.id === "esteira" && tour < 3) { tour++; return pintaTour(); }
  if (p.id === "pronto") return concluir(true);
  ir(aqui + 1);
}

/* ── As telas de cada passo ── */
var CHECK = '<svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>';
var TELAS = {
  oi: function(){ return '' +
    '<div class="g-heroi rodando"><span class="marca">' + MARCA_SVG + '</span>' +
      '<span class="eyebrow">Primeiros passos</span><h1>Bem-vindo ao Esteira</h1></div>' +
    '<p class="g-lede">Todo dia ele pega os pedidos da planilha, abre cada conta da Shopee pelo ' +
      'AdsPower, lê o código de rastreio e escreve na Shopify. <b>Você só decide o que ele não ' +
      'conseguiu decidir sozinho.</b></p>' +
    '<div class="g-tres">' +
      '<div>' + icone("ads") + '<b>AdsPower</b><span>É por ele que o Esteira abre as contas.</span></div>' +
      '<div>' + icone("shopee") + '<b>Contas da Shopee</b><span>Para entrar sozinho quando uma sessão cair.</span></div>' +
      '<div>' + icone("shopify") + '<b>Shopify</b><span>A loja onde os rastreios são escritos.</span></div>' +
    '</div>' +
    '<span class="g-chip"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' +
      'uns 10 minutos, só desta vez</span>' +
    '<p class="nota" style="margin-top:16px">Tenha à mão:</p>' +
    '<div class="g-mao"><span class="g-chip">o AdsPower aberto</span><span class="g-chip">a senha das contas da Shopee</span>' +
      '<span class="g-chip">a chave da RapidAPI</span><span class="g-chip">o endereço da loja</span></div>';
  },

  ads: function(){
    var guardada = ajustes && ajustes.adspowerChave === "guardada";
    return cabecalho("ads", "Configuração 1 de 3", "Ligar o AdsPower") +
    '<p class="g-lede">Cada conta da Shopee mora num perfil do AdsPower, já conectada. O Esteira ' +
      'abre esses perfis pela API local do AdsPower — e para isso precisa da chave dela.</p>' +
    '<ol class="g-passos">' +
      '<li><span>Abra o <b>AdsPower</b> neste computador e espere terminar de carregar.</span></li>' +
      '<li><span>Vá em <b>Configurações → API local</b> e deixe a opção <b>ligada</b>.</span></li>' +
      '<li><span>Na mesma tela, <b>copie a chave</b> (API Key) e cole aqui embaixo.</span></li>' +
    '</ol>' +
    '<label class="campo"><span>Chave da API do AdsPower' + (guardada ? ' <b class="g-guardada">· guardada</b>' : '') + '</span>' +
      '<input id="gAdsChave" type="password" spellcheck="false" autocomplete="off" placeholder="' +
        (guardada ? "já guardada — cole outra só se quiser trocar" : "cole aqui a chave") + '">' +
      '<em>Fica só neste computador, e não aparece de novo depois de guardada.</em></label>' +
    '<button class="btn pri" id="gAdsTestar">Testar conexão</button>' +
    '<div id="gAdsRes" class="g-res" aria-live="polite"></div>' +
    '<p class="nota">O AdsPower precisa estar <b>aberto</b> sempre que o Esteira for rodar — ' +
      'a conexão some quando ele fecha.</p>';
  },

  contas: function(){
    var a = ajustes || {};
    var v = function(c){ return esc(a[c] == null || a[c] === 0 ? "" : a[c]); };
    var segredo = function(id, rot, ph, campo, ajuda){
      var g = a[campo] === "guardada";
      return '<label class="campo"><span>' + rot +
        (g ? ' <b class="g-guardada">· guardada</b>' : '') + '</span>' +
        '<input id="' + id + '" type="password" spellcheck="false" autocomplete="off" placeholder="' +
          (g ? "já guardada — digite só se quiser trocar" : ph) + '">' +
        '<em>' + ajuda + '</em></label>';
    };
    return cabecalho("shopee", "Configuração 2 de 3", "Contas da Shopee") +
    '<p class="g-lede">No dia a dia o robô não precisa disto: as contas já estão conectadas ' +
      'dentro dos perfis do AdsPower. <b>Isto é para quando uma sessão cai</b> — aí ele entra ' +
      'sozinho, como você entraria: e-mail, senha e o código que a Shopee manda por e-mail.</p>' +

    '<h3 class="g-sub">O e-mail das contas</h3>' +
    '<p class="nota" style="margin:0 0 12px">O robô não guarda um e-mail por conta: ele monta cada ' +
      'um juntando um começo, o número da conta e o domínio.</p>' +
    '<div class="par-campos">' +
      '<label class="campo"><span>Começo do e-mail</span>' +
        '<input id="gPrefixo" spellcheck="false" placeholder="ex.: minhaloja" value="' + v("emailPrefixo") + '"></label>' +
      '<label class="campo"><span>Domínio</span>' +
        '<input id="gDominio" spellcheck="false" placeholder="ex.: gmail.com" value="' + v("emailDominio") + '"></label>' +
    '</div>' +
    '<label class="g-marcar"><input type="checkbox" id="gDois"' +
      (a.emailPrefixoAlto ? " checked" : "") + '> Contas a partir de um número usam outro começo</label>' +
    '<div class="par-campos" id="gDoisCampos"' + (a.emailPrefixoAlto ? "" : " hidden") + '>' +
      '<label class="campo"><span>A partir da conta</span>' +
        '<input id="gFaixa" inputmode="numeric" placeholder="ex.: 200" value="' + v("emailFaixa") + '"></label>' +
      '<label class="campo"><span>Esse outro começo</span>' +
        '<input id="gPrefixoAlto" spellcheck="false" placeholder="ex.: outraloja" value="' + v("emailPrefixoAlto") + '"></label>' +
    '</div>' +
    '<p class="g-exemplo" id="gExemplo"></p>' +

    '<h3 class="g-sub">Senha e código</h3>' +
    segredo("gSenha", "A senha das contas", "a mesma senha de todas as contas", "shopeeSenha",
      "Fica num arquivo que só o seu usuário deste computador abre.") +
    segredo("gCodigo", "Chave da RapidAPI", "a chave da RapidAPI", "codigoChave",
      "Depois da senha, a Shopee manda um código para o e-mail da conta. É com esta chave " +
      "que o robô abre essa caixa de entrada e lê o código.") +
    '<button class="btn pri" id="gContasSalvar">Salvar</button>' +
    '<div id="gContasRes" class="g-res" aria-live="polite"></div>';
  },

  shopify: function(){
    return cabecalho("shopify", "Configuração 3 de 3", "Conectar a Shopify") +
    '<p class="g-lede">É na Shopify que os rastreios vão parar. O Esteira pede permissão à ' +
      'loja uma vez; você aprova no navegador, e pronto.</p>' +
    '<ol class="g-passos">' +
      '<li><span>Digite o endereço da loja — o que termina em <b>.myshopify.com</b>. ' +
        'Ele aparece no painel da Shopify, em Configurações → Domínios.</span></li>' +
      '<li><span>Clique em <b>Conectar</b>. O navegador abre a tela da Shopify.</span></li>' +
      '<li><span>Lá, clique em <b>Instalar</b> ou <b>Aprovar</b>. Depois, volte para cá.</span></li>' +
    '</ol>' +
    '<div class="g-linha"><label class="campo" style="margin:0;flex:1"><span>Endereço da loja</span>' +
      '<input id="gLoja" spellcheck="false" placeholder="minhaloja.myshopify.com"></label>' +
      '<button class="btn pri" id="gConectar">Conectar</button></div>' +
    '<div id="gShopRes" class="g-res" aria-live="polite"></div>';
  },

  esteira: function(){
    return '<div class="g-cab">' + icone("marca") + '<div><span class="eyebrow">Como a esteira anda</span>' +
      '<h1 id="gTourTitulo"></h1></div></div>' +
    '<div class="g-mini" id="gMini">' +
      [["1","Planilha"],["2","Coleta"],["3","Conferência"],["4","Escrita"]]
        .map(function(e, i){ return (i ? '<span class="liga"></span>' : '') +
          '<span class="etapa" data-g="' + e[0] + '"><span class="n">' + e[0] + '</span>' +
          '<span class="rot">' + e[1] + '</span></span>'; }).join("") +
    '</div>' +
    '<div class="g-ilus" id="gIlus"></div>' +
    '<div id="gTour"></div>' +
    '<p class="nota" id="gTourPe"></p>';
  },

  pronto: function(){
    var item = function(k, ic, t){ return '<li data-c="' + k + '">' + icone(ic) +
      '<div><span class="t">' + t + '</span><span class="d">conferindo…</span></div>' +
      '<span class="est andando"><span class="pt"></span>testando</span></li>'; };
    return '<div class="g-selo" id="gSelo" hidden></div>' +
    '<span class="eyebrow">Pronto</span>' +
    '<h1 id="gProntoTitulo" style="margin-bottom:14px">Conferindo…</h1>' +
    '<ul class="g-confere" id="gConfere">' + item("ads", "ads", "AdsPower") +
      item("contas", "shopee", "Contas da Shopee") + item("shopify", "shopify", "Shopify") + '</ul>' +
    '<p class="g-lede" id="gProntoTexto"></p>' +
    '<p class="nota">Este guia fica em <b>Ajustes → Abrir o guia</b>, se precisar ver de novo. ' +
      'Tudo o que você configurou aqui também pode ser trocado em Ajustes.</p>';
  },
};

/* ── O passeio pela esteira: quatro quadros, cada um com uma miniatura ── */
// Os dados das miniaturas são de mentira e parecem de mentira de propósito:
// pedido #1001, conta 12, rastreio BR000…. Nenhum cliente de verdade.
var tour = 0;
var QUADROS = [
  { t:"A planilha do dia",
    i:'<div class="il-solta">solte a planilha aqui' +
        '<div class="il-arq"><i></i><span>pedidos-do-dia.xlsx<small>4 pedidos · 2 contas</small></span></div></div>',
    c:"<p class='g-lede'>Exporte da Shopify os pedidos pagos do dia e <b>arraste o arquivo</b> para a etapa 1. " +
      "O robô vê quais pedidos estão sem rastreio e em qual conta da Shopee cada um foi comprado. Se o " +
      "formato não bater, baixe o <b>modelo</b> na própria etapa.</p>" },
  { t:"A coleta na Shopee",
    i:'<div class="il-contas">' +
        '<div class="il-conta"><b>Conta 12</b><span class="est ok d"><span class="pt"></span>39 pedidos</span></div>' +
        '<div class="il-conta"><b>Conta 15</b><span class="bar"><i></i></span><span class="est andando d"><span class="pt"></span>lendo</span></div>' +
        '<div class="il-conta"><b>Conta 18</b><span class="est at d"><span class="pt"></span>precisa de você</span></div></div>',
    c:"<p class='g-lede'>Clique em <b>Iniciar coleta</b>. O robô abre cada conta no perfil dela do AdsPower, " +
      "várias ao mesmo tempo, e lê os rastreios. <b>Nada é escrito nesta etapa.</b> Se a Shopee pedir para " +
      "provar que é uma pessoa, o Esteira <b>toca um som</b> e mostra qual conta espera você — as outras continuam.</p>" },
  { t:"A conferência",
    i:'<div class="il-cartao"><div class="topo-c"><b>#1004</b><span class="ter">conta 15</span>' +
        '<span class="il-tag">dois candidatos</span></div>' +
        '<div class="il-opc">BR000000001X<span class="ter" style="font-family:var(--ui)">R$ 31,90</span></div>' +
        '<div class="il-opc sim">BR000000002X<span class="u">usar esse</span></div></div>',
    c:"<p class='g-lede'>O que casou certinho passa direto. Aqui só aparece o que deixou o robô em dúvida: " +
      "o cliente não estava na conta da planilha, o nome não confere, ou dois pedidos empataram. Você " +
      "escolhe, cola o rastreio à mão, ou deixa para amanhã — e dá para desfazer.</p>" },
  { t:"A escrita na Shopify",
    i:'<div class="il-lista">' + ["#1001","#1002","#1003"].map(function(n, k){
        return '<div class="il-ped"><b>' + n + '</b><code>BR00000000' + (k + 3) + 'X</code><span class="ck">' + CHECK + '</span></div>';
      }).join("") + '</div>',
    c:"<p class='g-lede'>Confira a lista e clique em <b>Escrever na Shopify</b>. Cada pedido recebe o seu " +
      "rastreio e fica como enviado. É o único passo que não se desfaz com um clique — por isso ele espera " +
      "você. Quando confiar no resultado, dá para ligar <b>Escrever sem me perguntar</b> em Ajustes.</p>" },
];
function pintaTour(){
  var q = QUADROS[tour];
  raiz.querySelector("#gTourTitulo").textContent = (tour + 1) + " · " + q.t;
  raiz.querySelector("#gIlus").innerHTML = q.i;
  raiz.querySelector("#gTour").innerHTML = q.c;
  raiz.querySelectorAll("#gMini .etapa").forEach(function(el, i){
    el.dataset.e = i === tour ? "agora" : i < tour ? "feita" : "";
    el.querySelector(".n").innerHTML = i < tour ? CHECK : (i + 1);
  });
  raiz.querySelector("#gTourPe").innerHTML = tour < 3
    ? "Quadro " + (tour + 1) + " de 4."
    : "No alto da tela ficam também <b>Contas</b> (cada conta e o perfil dela) e <b>Histórico</b> " +
      "(toda rodada guardada — para quando perguntarem por que um pedido ficou sem rastreio).";
  raiz.querySelector("#gSeguir").textContent = tour < 3 ? "Próximo" : "Continuar";
}

/* ── O que cada passo faz depois de aparecer ── */
var lista = function(xs){ return '<ul class="g-resolver">' + xs.map(function(x){ return "<li>" + esc(x) + "</li>"; }).join("") + '</ul>'; };
var DEPOIS = {
  ads: function(c){
    var botao = c.querySelector("#gAdsTestar"), res = c.querySelector("#gAdsRes");
    if (feito.ads) resultado(res, "ok", '<span class="est ok"><span class="pt"></span>Conectado ao AdsPower</span>');
    botao.onclick = async function(){
      botao.disabled = true;
      resultado(res, "", '<span class="est andando"><span class="pt"></span>Testando…</span>');
      try {
        var chave = c.querySelector("#gAdsChave").value.trim();
        if (chave) { ajustes = await pedir("ajustes:salvar", { adspowerChave: chave }); mexeu = true;
                     c.querySelector("#gAdsChave").value = ""; }
        var d = await comPrazo(pedir("adspower:diagnosticar", {}), 20000);
        feito.ads = !!d.ok;
        if (d.ok) resultado(res, "ok", '<span class="est ok"><span class="pt"></span>' + esc(d.titulo) + '</span>' +
            (d.verificado && d.verificado.length ? '<p class="nota">Conferido: ' + esc(d.verificado.join(", ")) + '.</p>' : "") +
            (d.comoResolver && d.comoResolver.length ? '<p class="nota">' + esc(d.comoResolver.join(" ")) + '</p>' : ""));
        else resultado(res, "er", '<span class="est er"><span class="pt"></span>' + esc(d.titulo) + '</span>' + lista(d.comoResolver || []));
      } catch (e) {
        feito.ads = false;
        resultado(res, "er", '<span class="est er"><span class="pt"></span>' +
          (e.message === "prazo" ? "O AdsPower não respondeu em 20 segundos" : "Não consegui testar") + '</span>' +
          lista([e.message === "prazo" ? "Confira se o AdsPower está aberto e terminou de carregar, e teste de novo." : e.message]));
      } finally { botao.disabled = false; pintaTrilho(); pintaSeguir(); }
    };
  },

  contas: function(c){
    var $ = function(i){ return c.querySelector("#" + i); };
    var res = $("gContasRes");
    var exemplo = function(){
      var pre = $("gPrefixo").value.trim(), dom = $("gDominio").value.trim().replace(/^@/, "");
      var dois = $("gDois").checked, faixa = Number($("gFaixa").value) || 0, alto = $("gPrefixoAlto").value.trim();
      if (!pre || !dom) { $("gExemplo").innerHTML = ""; return; }
      var linha = function(n, p){ return "a conta <b>" + n + "</b> entra como <code>" + esc(p + n + "@" + dom) + "</code>"; };
      var t = "Assim: " + linha(12, pre);
      if (dois && faixa > 0 && alto) t += ", e " + linha(faixa + 5, alto);
      $("gExemplo").innerHTML = t + ".";
    };
    ["gPrefixo","gDominio","gFaixa","gPrefixoAlto"].forEach(function(i){ $(i).addEventListener("input", exemplo); });
    $("gDois").addEventListener("change", function(){ $("gDoisCampos").hidden = !$("gDois").checked; exemplo(); });
    exemplo();
    if (feito.contas) resultado(res, "ok", '<span class="est ok"><span class="pt"></span>Tudo preenchido</span>');

    $("gContasSalvar").onclick = async function(){
      var b = $("gContasSalvar"); b.disabled = true;
      var dois = $("gDois").checked;
      var m = {
        emailPrefixo: $("gPrefixo").value.trim(),
        emailDominio: $("gDominio").value.trim().replace(/^@/, ""),
        emailPrefixoAlto: dois ? $("gPrefixoAlto").value.trim() : "",
        emailFaixa: dois ? (Number($("gFaixa").value.trim()) || 0) : 0,
      };
      // Segredo vazio quer dizer "não mexi": manda só o que foi digitado.
      if ($("gSenha").value) m.shopeeSenha = $("gSenha").value;
      if ($("gCodigo").value.trim()) m.codigoChave = $("gCodigo").value.trim();
      try {
        ajustes = await pedir("ajustes:salvar", m); mexeu = true;
        $("gSenha").value = ""; $("gCodigo").value = "";
        var falta = ajustes.falta || [];
        feito.contas = !falta.length;
        if (feito.contas) resultado(res, "ok", '<span class="est ok"><span class="pt"></span>Guardado. Nada faltando.</span>');
        else resultado(res, "at", '<span class="est at"><span class="pt"></span>Guardei o que você preencheu. Ainda falta:</span>' + lista(falta));
        // os rótulos "· guardada" acompanham o que acabou de ser salvo
        ["shopeeSenha","codigoChave"].forEach(function(k, i){
          var inp = $(i ? "gCodigo" : "gSenha");
          if (ajustes[k] !== "guardada") return;
          inp.placeholder = "já guardada — digite só se quiser trocar";
          var span = inp.parentNode.querySelector("span");
          if (!span.querySelector(".g-guardada")) span.insertAdjacentHTML("beforeend", ' <b class="g-guardada">· guardada</b>');
        });
      } catch (e) {
        resultado(res, "er", '<span class="est er"><span class="pt"></span>Não consegui guardar</span>' + lista([e.message]));
      } finally { b.disabled = false; pintaTrilho(); pintaSeguir(); }
    };
  },

  shopify: function(c){
    var res = c.querySelector("#gShopRes"), botao = c.querySelector("#gConectar"), loja = c.querySelector("#gLoja");
    var conectada = function(e){
      feito.shopify = true;
      resultado(res, "ok", '<span class="est ok"><span class="pt"></span>Conectada: ' + esc(e.loja || e.dominio) +
        '</span><p class="nota">' + esc(e.dominio || "") + (e.faltando && e.faltando.length
          ? " · faltam " + e.faltando.length + " permissões — dá para aprovar de novo em Ajustes." : "") + '</p>');
      botao.textContent = "Trocar de loja"; botao.classList.remove("pri"); pintaTrilho(); pintaSeguir();
    };
    pedir("shopify:estado").then(function(e){ if (e.conectada) { loja.value = e.dominio || ""; conectada(e); } })
      .catch(function(){});
    botao.onclick = async function(){
      var l = loja.value.trim();
      if (!l) { resultado(res, "at", '<span class="est at"><span class="pt"></span>Digite o endereço da loja primeiro.</span>'); return loja.focus(); }
      botao.disabled = true; feito.shopify = false; pintaSeguir();
      try {
        if (botao.textContent === "Trocar de loja") await pedir("shopify:desconectar").catch(function(){});
        await pedir("shopify:conectar", { loja: l });
        mexeu = true;
        resultado(res, "", '<span class="est andando"><span class="pt"></span>Esperando você aprovar no navegador…</span>' +
          '<p class="nota">Abrimos a tela da Shopify no seu navegador. Aprove lá e volte para cá — esta tela ' +
          'percebe sozinha. <button class="g-link" id="gShopCancelar">Cancelar</button></p>');
        c.querySelector("#gShopCancelar").onclick = function(){
          pararEspera(); pedir("shopify:cancelar").catch(function(){});
          resultado(res, "", ""); botao.disabled = false; };
        esperar(function(e){ botao.disabled = false; conectada(e); },
                function(){ botao.disabled = false;
                  resultado(res, "er", '<span class="est er"><span class="pt"></span>A Shopify não confirmou a conexão</span>' +
                    lista(["Se você recusou ou fechou a tela da Shopify, clique em Conectar de novo.",
                           "Confira se o endereço termina em .myshopify.com."])); });
      } catch (e) {
        botao.disabled = false;
        resultado(res, "er", '<span class="est er"><span class="pt"></span>Não consegui abrir a Shopify</span>' + lista([e.message]));
      }
    };
  },

  esteira: function(){ tour = 0; pintaTour(); },

  pronto: async function(c){
    var linha = function(k, ok, d){
      var li = c.querySelector('[data-c="' + k + '"]');
      li.querySelector(".est").className = "est " + (ok ? "ok" : "at");
      li.querySelector(".est").innerHTML = '<span class="pt"></span>' + (ok ? "pronto" : "falta");
      li.querySelector(".d").innerHTML = d;
    };
    var r = await Promise.all([
      comPrazo(pedir("adspower:diagnosticar", {}), 20000).catch(function(e){ return { ok:false, titulo: e.message === "prazo" ? "não respondeu" : e.message }; }),
      pedir("ajustes:ler").catch(function(){ return { falta:["não consegui ler os ajustes"] }; }),
      pedir("shopify:estado").catch(function(){ return { conectada:false }; }),
    ]);
    if (!raiz || PASSOS[aqui].id !== "pronto") return;   // a pessoa saiu antes de terminar
    var falta = r[1].falta || [];
    var ok = { ads: !!r[0].ok, contas: !falta.length, shopify: !!r[2].conectada };
    feito.ads = ok.ads; feito.contas = ok.contas; feito.shopify = ok.shopify;
    linha("ads", ok.ads, ok.ads ? "conectado e respondendo" : esc(r[0].titulo) + ' · <button class="g-link" data-volta="1">configurar</button>');
    linha("contas", ok.contas, ok.contas ? "e-mail, senha e código guardados"
      : "falta " + esc(falta.join(", ")) + ' · <button class="g-link" data-volta="2">configurar</button>');
    linha("shopify", ok.shopify, ok.shopify ? esc(r[2].loja || r[2].dominio)
      : 'não conectada · <button class="g-link" data-volta="3">configurar</button>');
    c.querySelectorAll("[data-volta]").forEach(function(b){ b.onclick = function(){ ir(Number(b.dataset.volta)); }; });
    var tudo = ok.ads && ok.contas && ok.shopify;
    var selo = c.querySelector("#gSelo");
    selo.className = "g-selo" + (tudo ? "" : " at"); selo.hidden = false;
    selo.innerHTML = tudo ? '<svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>'
                          : '<svg viewBox="0 0 24 24"><path d="M12 7v6M12 17h.01"/></svg>';
    c.querySelector("#gProntoTitulo").textContent = tudo ? "Tudo pronto" : "Quase lá";
    c.querySelector("#gProntoTexto").innerHTML = tudo
      ? "O Esteira está pronto para a primeira rodada. Comece arrastando a planilha do dia para a <b>etapa 1</b>."
      : "Dá para começar a usar, mas <b>a rodada não começa</b> enquanto faltar alguma coisa acima. " +
        "Você pode configurar agora ou depois, em Ajustes.";
    pintaTrilho();
  },
};

function comPrazo(p, ms){
  return Promise.race([p, new Promise(function(_, nao){ setTimeout(function(){ nao(new Error("prazo")); }, ms); })]);
}
function pararEspera(){ if (relogio) { clearInterval(relogio); relogio = null; } }
function esperar(sim, nao){
  pararEspera();
  // Igual a real.js: a aprovação acontece no navegador e ninguém avisa esta
  // tela. Pergunta de segundo em segundo, e para quando a loja aparece OU
  // quando a tentativa deixou de existir (recusada, expirada, cancelada).
  relogio = setInterval(async function(){
    try {
      var e = await pedir("shopify:estado");
      if (e.conectada) { pararEspera(); return sim(e); }
      if (!(await pedir("shopify:conectando"))) { pararEspera(); nao(); }
    } catch (x) { pararEspera(); nao(); }
  }, 1000);
}

/* ── Abrir e fechar ── */
async function abrir(){
  if (raiz) return;
  try { ajustes = await pedir("ajustes:ler"); } catch (e) { ajustes = {}; }
  montar();
  document.documentElement.classList.add("com-guia");
  ir(0);
}
async function concluir(terminou){
  pararEspera();
  try { await pedir("ajustes:salvar", { guiaConcluido: true }); } catch (e) {}
  raiz.remove(); raiz = null;
  document.documentElement.classList.remove("com-guia");
  // O resto da tela leu os ajustes e a loja quando abriu. Se o guia mudou
  // alguma coisa, recarrega — mais simples e mais honesto que remendar
  // campo por campo, e o guia não volta porque já ficou marcado.
  if (mexeu) return location.reload();
  if (terminou) { var b = document.querySelector('[data-etapa="1"]'); if (b) b.click(); }
}

window.GUIA = { abrir: abrir };
document.addEventListener("click", function(e){
  if (e.target.closest("#bAbrirGuia")) abrir();
});

pedir("ajustes:ler").then(function(a){ if (!a.guiaConcluido) abrir(); })
  .catch(function(e){ console.error("[esteira] guia:", e.message); });
})();
