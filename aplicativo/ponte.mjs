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
import { pendentesAbertos, historico, adiarPendente, encerrarPendente } from "../src/estado.mjs";
import { lerColetas, conciliar, MOTIVOS } from "../src/conciliar.mjs";
import { rodarCiclo, descobrirContas } from "../src/ciclo.mjs";
import { iniciarConexao, conexaoEmAndamento, cancelarConexao } from "../src/shopify-oauth.mjs";
import { resolverManual, prepararManual } from "../src/manual.mjs";
import { lerAjustes, salvarAjustes, aplicarNoAmbiente } from "../src/ajustes.mjs";

/** Erro que atravessa a ponte vira dado, não exceção perdida. */
const tentar = async (fn) => {
  try { return { ok: true, dado: await fn() }; }
  catch (e) { return { ok: false, erro: e.message }; }
};

export function construir({ aoLog = () => {}, porta = 3000 } = {}) {
  let rodadaEmCurso = null;

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
    "conferencia:listar": ({ caminho, aba }) => tentar(async () => {
      const r = await lerPendentes(caminho, { aba });
      const { linhas, resumo } = conciliar(r.contas, lerColetas());
      return {
        resumo,
        pendencias: linhas.filter((l) => l.motivo).map((l) => ({
          pedido: l.p.pedido, conta: l.conta, nome: l.p.nome, valor: l.p.valor,
          motivo: l.motivo, dias: 1,
        })),
      };
    }),
    "motivos:vocabulario": async () => MOTIVOS,

    // ── a rodada ──────────────────────────────────────────────────────
    "rodada:contas": (args) => tentar(() => descobrirContas(args ?? [], { aoLog })),
    "rodada:emCurso": async () => Boolean(rodadaEmCurso),
    "rodada:iniciar": ({ contas, escrever = false, concorrencia }) => tentar(async () => {
      if (rodadaEmCurso) throw new Error("já existe uma rodada em andamento");
      if (concorrencia) process.env.CONCORRENCIA = String(concorrencia);
      rodadaEmCurso = rodarCiclo({ contas, escrever, aoLog })
        .finally(() => { rodadaEmCurso = null; });
      return await rodadaEmCurso;
    }),

    // ── escrita manual ────────────────────────────────────────────────
    "manual:conferir": ({ pedido, texto }) => tentar(() => prepararManual(pedido, texto)),
    "manual:escrever": ({ pedido, texto, notificar }) =>
      tentar(() => resolverManual(pedido, texto, { confirmado: true, notificar })),

    // ── histórico ─────────────────────────────────────────────────────
    "historico:listar": async ({ limite = 60 } = {}) => historico(limite),
  };
}
