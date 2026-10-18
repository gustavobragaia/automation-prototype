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

/* ── Esta máquina ── */
async function maquina(){ TELA.maquina(await pedir("maquina:ler")); }

/* ── Ajustes guardados: a chave do AdsPower e o endereço ── */
async function ajustes(){
  var a = await pedir("ajustes:ler");
  var chave = document.getElementById("adsChave"), base = document.getElementById("adsBase");
  // A chave salva NUNCA volta inteira do robô. O campo mostra um marcador do
  // mesmo tamanho só pra dizer "tem uma guardada"; se o cliente digitar por
  // cima, aí sim vai a nova. Enquanto estiver no marcador, mandamos
  // "guardada" e o robô usa a dele.
  if (a.adspowerChave === "guardada") {
    chave.value = "••••••••••••••••••••";
    chave.dataset.guardada = "1";
    chave.addEventListener("focus", function(){
      if (this.dataset.guardada) { this.value = ""; delete this.dataset.guardada; }
    });
  }
  if (a.adspowerBase) base.value = a.adspowerBase;
  var gravar = function(){
    pedir("ajustes:salvar", {
      adspowerChave: chave.dataset.guardada ? undefined : chave.value,
      adspowerBase: base.value,
    }).catch(function(e){ console.error("[esteira] ajustes:", e.message); });
  };
  chave.addEventListener("change", gravar);
  base.addEventListener("change", gravar);
}

/* ── AdsPower: o botão testa de verdade ── */
function adspower(){
  function chaveAtual(){
    var c = document.getElementById("adsChave");
    return c.dataset.guardada ? "guardada" : c.value;
  }
  GANCHOS.testarAds = async function(){
    try {
      var d = await pedir("adspower:diagnosticar", {
        chave: chaveAtual(),
        base:  (document.getElementById("adsBase") ||{}).value,
      });
      TELA.diagnostico({
        ok: d.ok, titulo: d.titulo, provado: d.verificado,
        passos: d.comoResolver, abertaSemChave: d.abertaSemChave,
      });
    } catch (e) {
      TELA.diagnostico({ ok:false, titulo:"Não consegui testar", passos:[e.message] });
    }
  };
}

/* ── Shopify ── */
async function shopify(){
  GANCHOS.conectarShopify = async function(loja){
    try { await pedir("shopify:conectar", { loja: loja }); esperarShopify(); }
    catch (e) { TELA.shopify("desconectada"); TELA.avisar("Não consegui abrir a Shopify", e.message); }
  };
  GANCHOS.cancelarShopify = function(){ pararEspera(); pedir("shopify:cancelar").catch(function(){}); };
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
  if (!e.conectada) return TELA.shopify("desconectada");
  TELA.shopify("conectada", {
    loja: e.loja || e.dominio, dominio: e.dominio,
    escopos: (e.escopos||[]).length, faltando: e.faltando || [],
    permanente: !e.expiraEm, quando: quandoTxt(e.conectadoEm),
  });
}

/* ── Planilha: o diálogo do sistema, e leitura de verdade ── */
function planilha(){
  GANCHOS.esquecerPlanilha = function(caminho){
    if (caminho) pedir("planilha:esquecer", { caminho: caminho })
      .catch(function(e){ console.error("[esteira] esquecer:", e.message); });
  };
  GANCHOS.escolherPlanilha = async function(){
    var caminhos = await window.esteira.escolherPlanilha();
    for (var i = 0; i < caminhos.length; i++) await ler(caminhos[i]);
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
  "conta:falhou": "falhou",
};
function rodada(){
  // A escuta começa antes de qualquer rodada: o coletor sobe junto com o app
  // e já emite por conta própria enquanto o cliente ainda está na etapa 1.
  window.esteira.aoEvento(function(e){
    if (e.tipo === "rodada:inicio") return TELA.rodada.montar(e.contas || []);
    if (e.tipo === "rodada:fim") return TELA.rodada.terminar(e);
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
      TELA.avisar("A rodada não terminou", e.message);
      console.error("[esteira] rodada:", e.message);
    } finally { botao.disabled = false; }
  };

  GANCHOS.pararRodada = async function(){
    var b = document.getElementById("bParar");
    b.disabled = true; b.textContent = "Parando…";
    try { await pedir("rodada:parar"); }
    catch (e) { console.error("[esteira] parar:", e.message); }
    // O botão não volta: a rodada vai terminar sozinha e o "rodada:fim"
    // devolve a tela ao estado parado. Dizer "parado" antes disso seria
    // mentira — as contas que já abriram ainda estão lá.
  };
}
function paraleloEscolhido(){
  var b = document.querySelector('#seg button[aria-pressed="true"]');
  return b ? Number(b.dataset.n) : undefined;
}

/* ── Aviso pelo sistema operacional, não pelo navegador ── */
function avisos(){
  var doNavegador = TELA.avisar;
  TELA.avisar = function(t, c){ doNavegador(t, c); window.esteira.avisar(t, c); };
}

(async function(){
  var partes = [["ajustes",ajustes],["máquina",maquina],["AdsPower",adspower],["Shopify",shopify],
                ["planilha",planilha],["rodada",rodada],["avisos",avisos]];
  for (var i = 0; i < partes.length; i++) {
    try { await partes[i][1](); trocou.push(partes[i][0]); }
    catch (e) { falhou.push(partes[i][0] + ": " + e.message); }
  }
  console.info("[esteira] de verdade: " + trocou.join(", "));
  var selo = document.querySelector(".selo-proto");
  if (!selo) return;
  if (falhou.length) {
    console.warn("[esteira] seguiram com exemplo — " + falhou.join(" | "));
    selo.textContent = falhou.length + " em dados de exemplo";
    selo.title = falhou.join("\n");
  } else selo.remove();
})();
})();
