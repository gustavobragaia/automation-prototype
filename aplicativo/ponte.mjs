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
import { conexaoAtiva, ESCOPOS, normalizarLoja, salvarConexao, provarCredenciais, esquecerToken } from "../src/shopify-conexao.mjs";
import { identidadeDaLoja, escoposConcedidos } from "../src/shopify.mjs";
import { lerPendentes } from "../src/planilha.mjs";
import { escreverRastreios } from "../src/escrita.mjs";
import { tirarJaAtendidos } from "../src/carteira-shopify.mjs";
import { transportadoraDe } from "../src/shopify.mjs";
import { guardarPendentes, baixarPendentes } from "../src/estado.mjs";
import { pendentesAbertos, historico, adiarPendente, encerrarPendente, motivosDaRodada,
         reabrirPendente } from "../src/estado.mjs";
import { lerColetas, conciliar, MOTIVOS, separarJaResolvidos } from "../src/conciliar.mjs";
import { lerDetalhe } from "../src/armazenamento/detalhe.mjs";
import { rodarCiclo, descobrirContas } from "../src/ciclo.mjs";
import { iniciarConexao, conexaoEmAndamento, cancelarConexao } from "../src/shopify-oauth.mjs";
import { resolverManual, prepararManual } from "../src/manual.mjs";
import { lerAjustes, salvarAjustes, aplicarNoAmbiente, SEGREDOS,
         faltaConfigurar } from "../src/ajustes.mjs";
import { aoEvento, emitir } from "../src/eventos.mjs";
import { lerAlertas, dispensar, alertasResolvidos, resolver as resolverAlerta } from "../src/alertas.mjs";
import { montarDiagnostico } from "../src/diagnostico.mjs";
import { writeFileSync as gravarArquivo } from "node:fs";
import { pedirParada, repetirNaRodada } from "../src/fila.mjs";
import net from "node:net";
import { diaLocal } from "../src/datas.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { montarDias } from "../src/historico-dias.mjs";
import { contasVistas } from "../src/contas-vistas.mjs";
import { duplicadasConhecidas } from "../src/perfis.mjs";
import { emailDaConta } from "../src/tracking.mjs";
import { lerRegistro } from "../src/escrita.mjs";
import { emEstado } from "../src/caminhos.mjs";
import { apagarConexao } from "../src/shopify-conexao.mjs";
import { escreverModelo, exportarDias } from "../src/arquivos.mjs";

/** Erro que atravessa a ponte vira dado, não exceção perdida. */
const tentar = async (fn) => {
  try { return { ok: true, dado: await fn() }; }
  catch (e) { return { ok: false, erro: e.message }; }
};

// O que a Shopify responde quando recusa ID + chave, numa frase que diz o
// que fazer. A mensagem crua continua no fim, para o suporte.
export function explicarRecusa(msg = "") {
  // A ordem importa: a Shopify responde HTTP 400 para coisas diferentes, e
  // o código no corpo é o que diz qual. Olhar o status primeiro fazia
  // "app não instalado" virar "chave errada" — e mandava copiar de novo
  // uma chave que estava certa.
  if (/app_not_installed|not installed/i.test(msg))
    return "o ID e a chave estão certos, mas o app ainda não está instalado na loja — no Dev Dashboard, " +
      "na página do app, clique em Instalar app e escolha a loja. Depois, clique em Conectar de novo. (" +
      msg.slice(0, 160) + ")";
  if (/shop_not_permitted/i.test(msg))
    return "a Shopify não deixou este app acessar esta loja: o app precisa ser criado pelo admin da PRÓPRIA loja " +
      "(Configurações → Apps → Desenvolver apps) e instalado nela. (" + msg.slice(0, 160) + ")";
  if (/invalid_client|unauthorized|application_cannot_be_found|HTTP 401/i.test(msg))
    return "a Shopify recusou o ID ou a chave secreta — copie de novo os dois, com os botões de copiar do Dev Dashboard. (" +
      msg.slice(0, 160) + ")";
  if (/HTTP 404|ENOTFOUND|getaddrinfo/i.test(msg))
    return "não achei essa loja — confira o endereço que termina em .myshopify.com. (" + msg.slice(0, 160) + ")";
  return msg;
}

export function construir({ aoLog = () => {}, aoEvento: enviar, porta = 3000, abrirNoNavegador } = {}) {
  // Os eventos do robô viram eventos da janela. Inscreve uma vez, no
  // arranque: o coletor sobe antes da rodada e emite por conta própria.
  if (enviar) aoEvento(enviar);
  let rodadaEmCurso = null;
  // As planilhas que o cliente escolheu nesta sessão, na ordem. A rodada
  // sai daqui e não de PLANILHA no ambiente: quem instala o app não tem .env.
  let planilhas = [];
  let escritaEmCurso = false;
  let diagnosticoEmCurso = null;
  const diagnosticarDeVerdade = (cfg) => tentar(async () => {
    // "guardada" quer dizer que a tela não mexeu no campo: usa a de verdade.
    const a = lerAjustes();
    const c = { ...(cfg ?? {}) };
    if (!c.chave || c.chave === "guardada") c.chave = a.adspowerChave;
    if (!c.base) c.base = a.adspowerBase;
    const d = await diagnosticar(c);
    return { ...d, abertaSemChave: d.ok ? await apiAbertaSemChave(c) : false };
  });


  const ARQ_PERFIS = () => emEstado("perfis-da-rodada.json");
  const guardarPerfis = (porConta) => {
    try {
      const o = {};
      for (const [n, c] of porConta) o[n] = { serial: c.serial ?? null, userId: c.userId ?? null };
      writeFileSync(ARQ_PERFIS(), JSON.stringify(o));
    } catch { /* a aba Contas mostra "—" no perfil; a rodada não para por isto */ }
  };
  const lerPerfis = () => {
    try {
      return new Map(Object.entries(JSON.parse(readFileSync(ARQ_PERFIS(), "utf8")))
        .map(([n, p]) => [Number(n), p]));
    } catch { return new Map(); }
  };

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
  // Alguém atende nesta porta? É o que importa — não quem subiu o servidor.
  const coletorEscutando = () => new Promise((pronto) => {
    const s = net.connect({ host: "127.0.0.1", port: porta });
    const fim = (r) => { s.destroy(); pronto(r); };
    s.setTimeout(1500);
    s.once("connect", () => fim(true));
    s.once("error", () => fim(false));
    s.once("timeout", () => fim(false));
  });

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
  const amanha = () => { const d = new Date(); d.setDate(d.getDate() + 1); return diaLocal(d); };

  return {
    // ── ajustes que o cliente escolhe uma vez ─────────────────────────
    // A leitura geral leva só "guardada" no lugar de cada segredo; o valor,
    // para preencher o campo, vem por "ajustes:verSegredo".
    // ── alertas: o sino no topo da barra lateral ───────────────────────
    "alertas:ler": async () => lerAlertas(),
    "alertas:dispensar": async (id) => { dispensar(String(id ?? "")); return lerAlertas(); },
    "alertas:resolvidos": async () => alertasResolvidos(),

    // "Exportar diagnóstico" (Ajustes): um .txt para o cliente mandar.
    "diagnostico:exportar": ({ caminho, versao } = {}) => tentar(async () => {
      if (!caminho) throw new Error("nenhum lugar escolhido para salvar");
      let v = versao;
      try { v ??= JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version; } catch {}
      gravarArquivo(caminho, montarDiagnostico({ versao: v }));
      return { caminho };
    }),

    "ajustes:ler": async () => {
      const a = lerAjustes();
      return { ...semSegredos(a), falta: faltaConfigurar(a) };
    },
    // O valor de UM segredo, quando a tela vai mostrá-lo no campo (escondido,
    // com o olho). Fica fora do "ajustes:ler" para nunca ir junto em log ou
    // em diagnóstico; só sai o que for pedido pelo nome.
    "ajustes:verSegredo": async (qual) =>
      SEGREDOS.includes(qual) ? String(lerAjustes()[qual] ?? "") : "",
    "ajustes:salvar": (mudancas) => tentar(async () => {
      const a = salvarAjustes(limparGuardados(mudancas ?? {}));
      aplicarNoAmbiente(a);
      return { ...semSegredos(a), falta: faltaConfigurar(a) };
    }),

    // ── estado da máquina e das conexões ──────────────────────────────
    "maquina:ler": async () => ({ ...lerMaquina(), teto: TETO, custoPorNavegador: custoGB(1) }),

    // Um teste por vez. O AdsPower aceita ~1 chamada por segundo; cliques
    // repetidos empilhavam diagnósticos e deixavam tudo mais lento
    // justamente quando a pessoa clicava de novo por impaciência. Quem
    // clica com um teste em andamento recebe a resposta desse mesmo teste.
    "adspower:diagnosticar": (cfg) => (diagnosticoEmCurso ??= diagnosticarDeVerdade(cfg)
      .finally(() => { diagnosticoEmCurso = null; })),

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
      // No app, o navegador é aberto pelo Electron (abrirNoNavegador): é o
      // que entrega o endereço inteiro também no Windows.
      const c = iniciarConexao(loja, { porta, abrir: abrirNoNavegador ?? true });
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
        // quais linhas, para a tela poder dizer onde olhar
        semConta: r.ignorados.map((i) => ({ linha: i.linha, motivo: i.motivo })),
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

      const { ficam, resolvidos: resolvidosAgora } = separarJaResolvidos(pendentesAbertos(), linhas);
      const itens = ficam.filter((p) => {
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
        resolvidosAgora,
        pendencias: itens.filter((i) => i.motivo.grupo === "precisa"),
        sozinhos: itens.filter((i) => i.motivo.grupo !== "precisa"),
      };
    }),
    "motivos:vocabulario": async () => MOTIVOS,

    // ── as abas que eram inventadas ───────────────────────────────────
    "historico:dias": async () => montarDias({
      rodadas: historico(200),
      escritas: lerRegistro(),
      motivosDaRodada,
    }),
    "contas:listar": async () => ({
      contas: contasVistas({
        perfis: lerPerfis(),
        // sem padrão configurado, o e-mail sai como "não sei", não como o
        // da Chomps
        email: (n) => emailDaConta(n),
      }),
      // O alerta de perfil repetido era FIXO na tela, falando de duas contas
      // que não existiam. Agora só aparece se a varredura achou de verdade.
      duplicadas: duplicadasConhecidas(),
    }),
    // Os pedidos que atravessaram de dias anteriores, para a etapa 1.
    "pendentes:atrasados": async () => pendentesAbertos().map((p) => ({
      pedido: p.pedido, nome: p.nome, conta: p.conta, dias: p.dias ?? 1,
      motivo: p.motivo, grupo: p.grupo,
    })),

    // ── arquivos que a pessoa baixa ───────────────────────────────────
    "planilha:modelo": ({ caminho }) => tentar(async () => {
      if (!caminho) throw new Error("nenhum lugar escolhido para salvar");
      await escreverModelo(caminho);
      return { caminho };
    }),
    "historico:exportar": ({ caminho, desde, ate, formato = "xlsx" }) => tentar(async () => {
      if (!caminho) throw new Error("nenhum lugar escolhido para salvar");
      const dias = montarDias({ rodadas: historico(200), escritas: lerRegistro(), motivosDaRodada })
        .filter((d) => (!desde || d.iso >= desde) && (!ate || d.iso <= ate));
      const linhas = await exportarDias(dias, caminho, formato);
      return { caminho, linhas };
    }),

    // Trocar de loja apaga a conexão de verdade. Antes só mudava a tela: o
    // robô continuava escrevendo na loja antiga.
    "shopify:desconectar": async () => { apagarConexao(); return true; },

    // A outra porta: o app criado pelo dono DENTRO da própria loja (Dev
    // Dashboard da loja), conectado colando o Client ID e a chave secreta.
    // Existe porque o app nosso, com distribuição personalizada, foi
    // recusado na loja real com "link de instalação inválido" — inclusive
    // com o dono logado. App e loja na mesma organização não passam por
    // distribuição nenhuma, e a Shopify troca ID + chave por um acesso de
    // 24h que o robô renova sozinho (modo "credenciais" em
    // shopify-conexao.mjs). A chave fica só nesta máquina.
    //
    // Testa ANTES de salvar: troca por um acesso e pergunta o nome da loja.
    // Chave errada nunca vira "conectada".
    "shopify:conectarCredenciais": ({ loja, clientId, clientSecret } = {}) => tentar(async () => {
      const l = normalizarLoja(loja);
      if (!l) throw new Error("endereço de loja inválido — esperado algo como minhaloja.myshopify.com");
      const id = String(clientId ?? "").trim(), chave = String(clientSecret ?? "").trim();
      if (!/^[a-f0-9]{32}$/i.test(id))
        throw new Error("o ID do cliente tem 32 letras e números — confira se copiou o campo \"ID do cliente\" inteiro");
      if (chave.length < 20)
        throw new Error("a chave secreta parece incompleta — use o botão de copiar ao lado de \"Chave secreta do cliente\"");

      const c = { loja: l, modo: "credenciais", clientId: id, clientSecret: chave };
      let novo;
      try {
        // sempre pergunta à Shopify (nunca o acesso guardado de antes), e
        // confirma lendo o nome da loja; "env" = não grava no meio do teste
        novo = await provarCredenciais(c);
        await identidadeDaLoja({ conexao: { ...c, ...novo, origem: "env" } });
      } catch (e) { esquecerToken(l); throw new Error(explicarRecusa(e.message)); }

      salvarConexao({ ...c, ...novo, conectadoEm: new Date().toISOString() });
      return { loja: l };
    }),

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

    // Tira da carteira o que já está atendido na Shopify (resolvido por
    // fora, à mão). Só leitura lá. A tela chama ao abrir a etapa 3 e no
    // botão "Conferir na Shopify e limpar".
    "conferencia:limparShopify": () => tentar(async () => {
      const sairam = await tirarJaAtendidos();
      if (sairam.length) aoLog(`${sairam.length} pedido(s) já atendidos na Shopify saíram da conferência: ${sairam.map((x) => x.pedido).join(", ")}`);
      return { sairam };
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
      // A aba Contas mostra o perfil de cada conta; o mapa custa uma
      // varredura de 972 perfis, então guarda o que esta rodada resolveu.
      guardarPerfis(porConta);
      return [...porConta.values()];
    }),
    "rodada:emCurso": async () => Boolean(rodadaEmCurso),
    // "Tentar de novo" com a rodada rodando: volta para o fim desta fila.
    "rodada:repetir": ({ contas = [] } = {}) => tentar(async () => {
      const naFila = [], fora = [];
      for (const n of contas.map(Number).filter((x) => x > 0)) {
        const r = repetirNaRodada(n);
        if (r === "na-fila") { naFila.push(n); resolverAlerta(`conta-senha-${n}`); }
        else fora.push({ conta: n, motivo: r });
      }
      return { naFila, fora };
    }),
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

      // O coletor é quem recebe os pedidos que a extensão lê. Sem ele, cada
      // conta abre, espera 150s e falha com "nada chegou ao coletor" — três
      // navegadores e sete minutos para descobrir que o problema nunca
      // esteve na Shopee. E o alarme culpa a extensão.
      if (!(await coletorEscutando()))
        throw new Error(`o coletor não está atendendo em 127.0.0.1:${porta} — ` +
                        "feche e abra o Esteira; se persistir, alguma coisa tomou a porta");
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
          pedido: p.l.p.pedido, conta: (p.contas ?? [p.l.conta]).join(" + "),
          // pedidos iguais do mesmo cliente: o rastreio de cada um saiu da
          // ordem da compra na Shopee, e a pessoa precisa saber disso
          gemeos: Boolean(p.l.gemeos),
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
          { escrever: true, notificar, aoLog, aoProgresso: (p) => emitir("escrita:progresso", p) });

        // A carteira anda nos dois sentidos, igual à rodada: entra quem
        // ficou pendente, sai quem a Shopify aceitou. `gravados`, não
        // `planejado` — o que ela recusou TEM que continuar na carteira,
        // senão some amanhã.
        guardarPendentes(r.pendencias);
        const baixados = baixarPendentes([...(r.gravados ?? []), ...(r.jaAtendidos ?? [])]);
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
