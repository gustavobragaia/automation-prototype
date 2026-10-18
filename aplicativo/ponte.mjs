// A única porta entre a tela e o resto do robô.
//
// Tudo o que a interface pode fazer está nesta lista, com um nome só. Se
// não está aqui, a tela não consegue fazer. É o que mantém a tela sem
// acesso ao Node, ao disco e à rede — ela só pede, nunca executa.
//
// Cada função devolve DADO, nunca objeto vivo: o que atravessa a ponte é
// serializado, e função não atravessa.

import { lerMaquina, custoGB, TETO } from "../src/maquina.mjs";
import { diagnosticar, apiAbertaSemChave } from "../src/adspower.mjs";
import { conexaoAtiva, ESCOPOS } from "../src/shopify-conexao.mjs";
import { identidadeDaLoja, escoposConcedidos } from "../src/shopify.mjs";
import { lerPendentes } from "../src/planilha.mjs";
import { pendentesAbertos, historico, adiarPendente, encerrarPendente,
         reabrirPendente } from "../src/estado.mjs";
import { lerColetas, conciliar, MOTIVOS } from "../src/conciliar.mjs";
import { rodarCiclo, descobrirContas } from "../src/ciclo.mjs";
import { iniciarConexao, conexaoEmAndamento, cancelarConexao } from "../src/shopify-oauth.mjs";
import { resolverManual, prepararManual } from "../src/manual.mjs";
import { lerAjustes, salvarAjustes, aplicarNoAmbiente } from "../src/ajustes.mjs";
import { aoEvento, emitir } from "../src/eventos.mjs";
import { pedirParada } from "../src/fila.mjs";

/** Erro que atravessa a ponte vira dado, não exceção perdida. */
const tentar = async (fn) => {
  try { return { ok: true, dado: await fn() }; }
  catch (e) { return { ok: false, erro: e.message }; }
};

export function construir({ aoLog = () => {}, aoEvento: enviar, porta = 3000 } = {}) {
  // Os eventos do robô viram eventos da janela. Inscreve uma vez, no
  // arranque: o coletor sobe antes da rodada e emite por conta própria.
  if (enviar) aoEvento(enviar);
  let rodadaEmCurso = null;
  // As planilhas que o cliente escolheu nesta sessão, na ordem. A rodada
  // sai daqui e não de PLANILHA no ambiente: quem instala o app não tem .env.
  let planilhas = [];

  // A linha da conciliação é interna. A tela recebe só o que desenha — e os
  // dois lados da comparação quando o motivo for divergência de nome, que é
  // o único em que a pessoa precisa ver Shopee e Shopify um ao lado do outro.
  const montarPendencia = (l) => ({
    pedido: l.p.pedido, conta: l.conta, nome: l.p.nome, valor: l.p.valor ?? null,
    dias: l.p.dias ?? 1,
    motivo: { codigo: l.motivo.codigo, grupo: l.motivo.grupo,
              rotulo: l.motivo.rotulo ?? l.motivo.codigo,
              texto: l.motivo.texto, acao: l.motivo.acao },
    // sugerirContas devolve { conta, pedido } — o rastreio está dentro do
    // pedido. Sem ele a tela diz "esse cliente aparece na conta 128" e não
    // mostra o código, que é metade do motivo de a sugestão existir.
    sugestoes: (l.motivo.sugestoes ?? []).map((x) => ({
      conta: x.conta, codigos: x.pedido?.codigos ?? [],
      valor: x.pedido?.valor ?? null, cep: x.pedido?.cep ?? null })),
    candidatos: l.estado === "ambiguo"
      ? (l.motivo.candidatos ?? []).map((c) => ({
          codigos: c.codigos ?? [], valor: c.valor ?? null, cep: c.cep ?? null }))
      : [],
    lados: l.motivo.codigo === "nome-nao-confere"
      ? { shopee: l.motivo.shopee ?? null, shopify: l.motivo.shopify ?? null }
      : null,
  });

  // Data local: toISOString joga para ontem durante a noite inteira no Brasil,
  // e "deixar para amanhã" viraria "deixar para hoje".
  const amanha = () => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
           "-" + String(d.getDate()).padStart(2, "0");
  };

  return {
    // ── ajustes que o cliente escolhe uma vez ─────────────────────────
    "ajustes:ler": async () => {
      const a = lerAjustes();
      // a chave nunca volta inteira pra tela; só o bastante pra ela mostrar
      // que existe uma salva. Quem precisa dela de verdade é o robô, aqui.
      return { ...a, adspowerChave: a.adspowerChave ? "guardada" : "" };
    },
    "ajustes:salvar": (mudancas) => tentar(async () => {
      const a = salvarAjustes(mudancas ?? {});
      aplicarNoAmbiente(a);
      return { ...a, adspowerChave: a.adspowerChave ? "guardada" : "" };
    }),

    // ── estado da máquina e das conexões ──────────────────────────────
    "maquina:ler": async () => ({ ...lerMaquina(), teto: TETO, custoPorNavegador: custoGB(1) }),

    "adspower:diagnosticar": (cfg) => tentar(async () => {
      // "guardada" quer dizer que a tela não mexeu no campo: usa a de verdade.
      const a = lerAjustes();
      const c = { ...(cfg ?? {}) };
      if (!c.chave || c.chave === "guardada") c.chave = a.adspowerChave;
      if (!c.base) c.base = a.adspowerBase;
      const d = await diagnosticar(c);
      return { ...d, abertaSemChave: d.ok ? await apiAbertaSemChave(c) : false };
    }),

    "shopify:estado": () => tentar(async () => {
      const c = conexaoAtiva();
      if (!c?.loja) return { conectada: false };
      const loja = await identidadeDaLoja({ conexao: c });
      const concedidos = await escoposConcedidos({ conexao: c });
      return {
        conectada: true, loja: loja.name, dominio: loja.myshopifyDomain,
        modo: c.modo, expiraEm: c.expiraEm ?? null, conectadoEm: c.conectadoEm ?? null,
        escopos: concedidos ?? [],
        faltando: concedidos ? ESCOPOS.filter((e) => !concedidos.includes(e)) : [],
      };
    }),

    "shopify:conectar": ({ loja }) => tentar(async () => {
      const c = iniciarConexao(loja, { porta, abrir: true });
      c.pronto.catch(() => {});   // o resultado chega por evento, não aqui
      return { url: c.url, loja: c.loja };
    }),
    "shopify:conectando": async () => conexaoEmAndamento(),
    "shopify:cancelar": async () => { cancelarConexao(); return true; },

    // ── planilha e carteira ───────────────────────────────────────────
    "planilha:ler": ({ caminho, aba }) => tentar(async () => {
      const r = await lerPendentes(caminho, { aba });
      if (!planilhas.includes(caminho)) planilhas.push(caminho);
      return {
        aba: r.aba, total: r.total, pendentes: r.pendentes.length,
        contas: r.contas.map((c) => ({ conta: c.conta, pedidos: c.pedidos.length })),
        ignorados: r.ignorados.length,
      };
    }),
    "pendentes:listar": async () => pendentesAbertos(),
    "pendentes:adiar": async ({ pedido, ate }) => adiarPendente(pedido, ate),
    "pendentes:encerrar": async (opts) => encerrarPendente(opts.pedido, opts),

    // ── conciliação, sem tocar na Shopify ─────────────────────────────
    "conferencia:listar": ({ caminho, aba } = {}) => tentar(async () => {
      // Sem caminho, vale o que o cliente escolheu na etapa 1 — o mesmo
      // conjunto que a rodada abriu. Pedir o arquivo de novo aqui faria a
      // conferência olhar uma planilha e a rodada, outra.
      const fontes = caminho ? [caminho] : planilhas;
      if (!fontes.length) throw new Error("nenhuma planilha escolhida ainda");

      const contas = [];
      for (const f of fontes) contas.push(...(await lerPendentes(f, { aba })).contas);
      const { linhas, resumo } = conciliar(contas, lerColetas());

      // A conciliação relê a planilha, que não sabe das decisões de hoje.
      // Sem este filtro, um pedido resolvido à mão reapareceria na lista um
      // segundo depois, como se nada tivesse acontecido.
      const abertos = new Map(pendentesAbertos().map((p) => [p.pedido, p]));
      // Some da lista quem já foi tratado hoje. São três casos:
      //   · fora da carteira  -> resolvido ou adiado
      //   · conta trocada     -> a pessoa já decidiu; volta na próxima
      //                          RODADA, na conta nova, não aqui agora
      // Sem o segundo caso, corrigir a conta deixa o item na tela com o
      // mesmo motivo de antes, e a pessoa decide duas vezes a mesma coisa.
      const naCarteira = (l) => {
        const p = abertos.get(l.p.pedido);
        return Boolean(p) && Number(p.conta) === Number(l.conta);
      };

      return {
        resumo,
        pendencias: linhas.filter((l) => l.motivo?.grupo === "precisa")
                          .filter(naCarteira).map(montarPendencia),
        sozinhos: linhas.filter((l) => l.motivo?.grupo === "sozinho")
                        .filter(naCarteira).map(montarPendencia),
      };
    }),
    "motivos:vocabulario": async () => MOTIVOS,

    // Uma decisão da conferência, qualquer que seja. Porta única para a tela
    // não precisar saber qual ação do robô corresponde a cada botão, e para
    // toda decisão passar pelo mesmo lugar.
    //
    // `reversivel` diz se o "Desfazer" da tela pode existir: colar o
    // rastreio criou um fulfillment na Shopify, e isso não se desfaz daqui.
    "conferencia:decidir": ({ pedido, decisao, texto, conta, motivo, ate }) => tentar(async () => {
      if (!pedido) throw new Error("sem número de pedido");
      switch (decisao) {
        case "colar": {
          // O olho humano já aconteceu: `manual:conferir` mostrou o lado da
          // Shopify e a pessoa clicou em escrever.
          const r = await resolverManual(pedido, texto, { confirmado: true });
          if (!r.ok) throw new Error(r.erro ?? "não deu para escrever");
          return { reversivel: false, volta: false, escrito: r.escrito };
        }
        case "conta": {
          const n = Number(conta);
          if (!Number.isInteger(n) || n <= 0) throw new Error("número de conta inválido");
          if (!encerrarPendente(pedido, { desfecho: "conta", conta: n,
                nota: `conta corrigida à mão para ${n}` }))
            throw new Error("esse pedido não está na carteira");
          return { reversivel: true, volta: true, conta: n };
        }
        case "encerrar": {
          if (!encerrarPendente(pedido, { desfecho: motivo ?? "encerrado", nota: texto ?? null }))
            throw new Error("esse pedido já saiu da carteira");
          return { reversivel: true, volta: false };
        }
        case "adiar": {
          const quando = ate ?? amanha();
          if (!adiarPendente(pedido, quando))
            throw new Error("esse pedido não está na carteira");
          return { reversivel: true, volta: true, ate: quando };
        }
        default:
          throw new Error(`decisão desconhecida: ${decisao}`);
      }
    }),

    // Desfazer o que dá para desfazer: devolve o pedido à carteira de hoje.
    "conferencia:desfazer": ({ pedido }) => tentar(async () => {
      if (!reabrirPendente(pedido)) throw new Error("esse pedido não dá mais para desfazer");
      return true;
    }),

    // ── a rodada ──────────────────────────────────────────────────────
    "planilha:esquecer": async ({ caminho }) => {
      planilhas = caminho ? planilhas.filter((p) => p !== caminho) : [];
      return planilhas.length;
    },

    "rodada:contas": (args) => tentar(async () => {
      if (Array.isArray(args) && args.length) return descobrirContas(args, { aoLog });
      if (!planilhas.length) throw new Error("nenhuma planilha escolhida ainda");

      // O cliente pode subir mais de uma planilha no mesmo dia. Uma conta que
      // aparece em duas é uma conta só: abrir o mesmo perfil duas vezes na
      // mesma rodada é o caminho mais curto para a Shopee pedir verificação.
      const porConta = new Map();
      for (const planilha of planilhas)
        for (const c of await descobrirContas([], { aoLog, planilha, ignorarRecorte: true }))
          if (!porConta.has(c.conta)) porConta.set(c.conta, c);
      return [...porConta.values()];
    }),
    "rodada:emCurso": async () => Boolean(rodadaEmCurso),
    "rodada:parar": async () => {
      if (!rodadaEmCurso) return false;
      pedirParada();
      aoLog("parada pedida — as contas que já abriram terminam, o resto fica de fora");
      return true;
    },
    "rodada:iniciar": ({ contas, escrever = false, concorrencia }) => tentar(async () => {
      if (rodadaEmCurso) throw new Error("já existe uma rodada em andamento");
      if (concorrencia) process.env.CONCORRENCIA = String(concorrencia);
      rodadaEmCurso = rodarCiclo({ contas, escrever, aoLog })
        .finally(() => { rodadaEmCurso = null; });
      try {
        return await rodadaEmCurso;
      } catch (e) {
        // Sem isto, uma rodada que estoura deixa a tela girando para sempre:
        // o "rodada:fim" do ciclo fica para trás do throw.
        emitir("rodada:fim", { erro: e.message, contas: (contas ?? []).length,
                               coletadas: 0, falhas: (contas ?? []).length });
        throw e;
      }
    }),

    // ── escrita manual ────────────────────────────────────────────────
    "manual:conferir": ({ pedido, texto }) => tentar(() => prepararManual(pedido, texto)),
    "manual:escrever": ({ pedido, texto, notificar }) =>
      tentar(() => resolverManual(pedido, texto, { confirmado: true, notificar })),

    // ── histórico ─────────────────────────────────────────────────────
    "historico:listar": async ({ limite = 60 } = {}) => historico(limite),
  };
}
