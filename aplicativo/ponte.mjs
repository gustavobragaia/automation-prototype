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
import { escreverRastreios } from "../src/escrita.mjs";
import { transportadoraDe } from "../src/shopify.mjs";
import { guardarPendentes, baixarPendentes } from "../src/estado.mjs";
import { pendentesAbertos, historico, adiarPendente, encerrarPendente,
         reabrirPendente } from "../src/estado.mjs";
import { lerColetas, conciliar, MOTIVOS } from "../src/conciliar.mjs";
import { lerDetalhe } from "../src/armazenamento/detalhe.mjs";
import { rodarCiclo, descobrirContas } from "../src/ciclo.mjs";
import { iniciarConexao, conexaoEmAndamento, cancelarConexao } from "../src/shopify-oauth.mjs";
import { resolverManual, prepararManual } from "../src/manual.mjs";
import { lerAjustes, salvarAjustes, aplicarNoAmbiente, SEGREDOS,
         faltaConfigurar } from "../src/ajustes.mjs";
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
  let escritaEmCurso = false;

  const semSegredos = (a) => {
    const fora = { ...a };
    for (const s of SEGREDOS) fora[s] = a[s] ? "guardada" : "";
    return fora;
  };
  // "guardada" é o que a tela devolve quando a pessoa não encostou no campo.
  // Salvar isso literalmente trocaria a senha pela palavra "guardada".
  const limparGuardados = (m) => {
    const fora = { ...m };
    for (const s of SEGREDOS) if (fora[s] === "guardada") delete fora[s];
    return fora;
  };
  // A aba que cada planilha usa de fato, descoberta ao lê-la. Guardar é o
  // que impede a rodada de procurar a aba de OUTRO arquivo — foi assim que
  // o .env do projeto derrubou uma rodada com "aba não encontrada".
  const abas = new Map();
  const abaDe = (caminho) => abas.get(caminho);

  // A etapa 4 olha o mesmo material da rodada: as planilhas que o cliente
  // escolheu, cruzadas com o que o coletor trouxe. Ler de outro lugar faria
  // a tela mostrar uma coisa e a escrita fazer outra.
  const contasEColetas = async () => {
    if (!planilhas.length) throw new Error("nenhuma planilha escolhida ainda");
    const contas = [];
    for (const f of planilhas) contas.push(...(await lerPendentes(f, { aba: abaDe(f) })).contas);
    return { contas, coletas: lerColetas() };
  };

  // A pendência como ela está guardada, enriquecida com o que a conciliação
  // de hoje souber a mais. Ela pode vir sem linha nenhuma: um pedido que
  // atravessou de ontem não está na planilha de hoje, e nem por isso some.
  const montarDaCarteira = (p, l) => {
    const det = lerDetalhe(p.detalhe) ?? {};
    const m = MOTIVOS[p.motivo] ?? {};
    const doMotivo = l?.motivo;
    return {
      pedido: p.pedido, conta: p.conta, nome: p.nome, valor: p.valor ?? null,
      dias: p.dias ?? 1,
      motivo: {
        codigo: p.motivo, grupo: p.grupo ?? m.grupo ?? "precisa",
        rotulo: m.rotulo ?? p.motivo, texto: m.texto ?? "", acao: m.acao ?? "",
      },
      // O detalhe guardado vale mais que o recalculado: ele é o que a
      // rodada viu no momento de decidir, inclusive o lado da Shopify.
      sugestoes: (det.sugestoes ?? (doMotivo?.sugestoes ?? []).map((x) => ({
        conta: x.conta, codigos: x.pedido?.codigos ?? [] }))),
      candidatos: det.candidatos ?? doMotivo?.candidatos ?? [],
      lados: (det.shopee != null || det.shopify != null)
        ? { shopee: { nome: det.shopee }, shopify: { nome: det.shopify } }
        : null,
      erro: det.erro ?? null,
    };
  };

  // Data local: toISOString joga para ontem durante a noite inteira no Brasil,
  // e "deixar para amanhã" viraria "deixar para hoje".
  const amanha = () => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
           "-" + String(d.getDate()).padStart(2, "0");
  };

  return {
    // ── ajustes que o cliente escolhe uma vez ─────────────────────────
    // Nenhum segredo volta inteiro para a tela — nem a senha da Shopee, nem
    // as chaves. Ela recebe só "guardada", o bastante para mostrar que
    // existe um valor salvo. Quem precisa do valor é o robô, aqui dentro.
    "ajustes:ler": async () => {
      const a = lerAjustes();
      return { ...semSegredos(a), falta: faltaConfigurar(a) };
    },
    "ajustes:salvar": (mudancas) => tentar(async () => {
      const a = salvarAjustes(limparGuardados(mudancas ?? {}));
      aplicarNoAmbiente(a);
      return { ...semSegredos(a), falta: faltaConfigurar(a) };
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
      abas.set(caminho, r.aba);
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
      for (const f of fontes) contas.push(...(await lerPendentes(f, { aba: aba ?? abaDe(f) })).contas);
      const { linhas, resumo } = conciliar(contas, lerColetas());

      // Quem manda na lista é a CARTEIRA, não a conciliação.
      //
      // A conciliação só enxerga o lado Shopee: ela nunca compara com a
      // Shopify. Então tudo que a etapa de escrita barra — nome que não
      // confere, pedido que não existe na loja, entrega já fechada, recusa
      // da Shopify — ficava invisível na conferência, mesmo estando na
      // carteira. A pessoa não via, e nunca saberia por que não foi escrito.
      //
      // A carteira também é o que sabe das decisões de hoje e dos pedidos
      // que atravessaram de ontem, que a planilha de hoje não traz.
      const deHoje = new Map();
      for (const l of linhas) deHoje.set(l.p.pedido, l);

      const itens = pendentesAbertos().filter((p) => {
        const l = deHoje.get(p.pedido);
        // A conta da carteira diferente da conciliação de hoje quer dizer
        // que a pessoa acabou de corrigi-la. Ela já decidiu: o pedido volta
        // na próxima RODADA, procurando na conta certa, e não agora com o
        // mesmo motivo de antes — senão ela decide duas vezes a mesma coisa.
        //
        // Some só enquanto a planilha discordar. Na rodada seguinte a
        // conciliação já roda sob a conta nova, e se ainda houver problema
        // o pedido reaparece normalmente.
        return !(l && Number(p.conta) !== Number(l.conta));
      }).map((p) => montarDaCarteira(p, deHoje.get(p.pedido)));

      return {
        resumo,
        pendencias: itens.filter((i) => i.motivo.grupo === "precisa"),
        sozinhos: itens.filter((i) => i.motivo.grupo !== "precisa"),
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
        for (const c of await descobrirContas([],
               { aoLog, planilha, ignorarRecorte: true, aba: abaDe(planilha) }))
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
      // Antes de abrir o primeiro navegador. Uma rodada que começa e morre
      // na terceira conta já abriu duas, mexeu em duas sessões e gastou
      // dez minutos — tudo para descobrir algo que dava para saber agora.
      const falta = faltaConfigurar();
      if (falta.length)
        throw new Error("antes de rodar, preencha em Ajustes → Contas da Shopee: " +
                        falta.join("; "));
      if (concorrencia) process.env.CONCORRENCIA = String(concorrencia);
      // As planilhas que a pessoa escolheu vão junto: sem isto a rodada
      // relê o PLANILHA do ambiente, que no app é o .env do projeto.
      rodadaEmCurso = rodarCiclo({ contas, escrever, planilhas, aoLog })
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

    // ── escrita em lote (etapa 4) ─────────────────────────────────────
    //
    // A rodada corre com `escrever: false` quando o cliente não ligou o
    // "escrever sem me perguntar". Então a etapa 4 é o momento em que ele
    // olha o que vai sair e aprova — e é aqui que sai.
    "escrita:listar": () => tentar(async () => {
      const { planejado, resumo, pulados } = await contasEColetas()
        .then(({ contas, coletas }) => escreverRastreios(contas, coletas,
          { escrever: false, aoLog }));
      return {
        resumo, pulados,
        itens: planejado.map((p) => ({
          pedido: p.l.p.pedido, conta: p.l.conta,
          nome: p.alvo?.nome ?? p.l.p.nome,
          codigos: (p.codigos ?? []).map((c) => (typeof c === "string" ? c : c.code)),
          transportadora: transportadoraDe(
            (p.codigos ?? []).map((c) => (typeof c === "string" ? c : c.code))),
        })),
      };
    }),

    "escrita:executar": ({ notificar = false } = {}) => tentar(async () => {
      if (escritaEmCurso) throw new Error("a escrita já está acontecendo");
      escritaEmCurso = true;
      try {
        const { contas, coletas } = await contasEColetas();
        const r = await escreverRastreios(contas, coletas,
          { escrever: true, notificar, aoLog });

        // A carteira anda nos dois sentidos, igual à rodada: entra quem
        // ficou pendente, sai quem a Shopify aceitou. `gravados`, não
        // `planejado` — o que ela recusou TEM que continuar na carteira,
        // senão some amanhã.
        guardarPendentes(r.pendencias);
        const baixados = baixarPendentes(r.gravados ?? []);
        aoLog(`${r.escritos} escrito(s) · ${r.falhas} falha(s) · ${r.pulados} pulado(s)` +
              (baixados ? ` · ${baixados} saíram da carteira` : ""));
        return { escritos: r.escritos, falhas: r.falhas, pulados: r.pulados,
                 gravados: r.gravados ?? [] };
      } finally { escritaEmCurso = false; }
    }),

    // ── escrita manual ────────────────────────────────────────────────
    "manual:conferir": ({ pedido, texto }) => tentar(() => prepararManual(pedido, texto)),
    "manual:escrever": ({ pedido, texto, notificar }) =>
      tentar(() => resolverManual(pedido, texto, { confirmado: true, notificar })),

    // ── histórico ─────────────────────────────────────────────────────
    "historico:listar": async ({ limite = 60 } = {}) => historico(limite),
  };
}
