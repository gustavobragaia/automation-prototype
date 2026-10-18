// Uma rodada completa: coleta -> consolida -> casa -> escreve -> planilha.
// É o que o agendador dispara e o que o painel mostra.

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { rodarFila } from "./fila.mjs";
import { extrairPedido } from "./shopee.mjs";
import { carregar, salvar, registrar, historico, registrarRodada } from "./estado.mjs";
import { listarPerfisOuNull } from "./adspower.mjs";
import { parseConta } from "./tracking.mjs";
import { lerPendentes } from "./planilha.mjs";
import { resolverContas } from "./perfis.mjs";
import { anotarMapeamento } from "./estado.mjs";
import { lerColetas } from "./conciliar.mjs";
import { escreverRastreios } from "./escrita.mjs";
import { alarmar, avaliarRodada } from "./alarme.mjs";

export { historico };

/**
 * De onde sai a lista de contas a abrir, em ordem de preferência
 * (DECISOES.md §4): planilha → contas.json → todos os perfis do AdsPower.
 */
export async function descobrirContas(args = [], { aoLog = () => {} } = {}) {
  if (args.length) return args.map((a) => ({ serial: Number(a), conta: Number(a) }));

  // contas.json vem ANTES da planilha: é recorte manual, feito para limitar
  // a rodada. Com a planilha na frente, escrever o arquivo não tinha efeito
  // nenhum e a rodada abria as 33 contas achando que ia abrir uma.
  if (existsSync("contas.json")) {
    const lista = JSON.parse(readFileSync("contas.json", "utf8"));
    aoLog(`contas.json: ${lista.length} conta(s) — recorte manual, a planilha não é lida`);
    return lista;
  }

  const planilha = process.env.PLANILHA;
  if (planilha && existsSync(planilha)) {
    const r = await lerPendentes(planilha, {
      aba: process.env.PLANILHA_ABA,
      desde: process.env.PLANILHA_DESDE,          // AAAA-MM-DD
      dias: process.env.PLANILHA_DIAS,            // ou "últimos N dias"
    });
    if (r.corte) aoLog(`filtrando pendências a partir de ${r.corte}`);
    aoLog(`planilha "${r.aba}": ${r.total} linhas · ${r.pendentes.length} sem rastreio · ${r.contas.length} contas a abrir`);
    if (r.ignorados.length) aoLog(`${r.ignorados.length} linha(s) sem conta reconhecível — vão para revisão, não para a fila`);

    // O mapeamento pedido→conta nasce aqui. Guardá-lo é o que permite, lá na
    // frente, o banco cobrir o que hoje só a planilha sabe.
    for (const p of r.pendentes) if (p.pedido) anotarMapeamento(p.pedido, p.conta, "planilha");

    // A planilha dá o número da conta; a fila precisa do user_id do perfil.
    const { resolvidas } = await resolverContas(
      r.contas.map((c) => ({ conta: c.conta, pedidosEsperados: c.pedidos.length })), { aoLog });
    return resolvidas;
  }

  const lista = await listarPerfisOuNull(1, 500);
  if (!lista) throw new Error("sem PLANILHA, sem contas.json e user/list indisponível — passe os seriais como argumento");
  aoLog(`${lista.list.length} perfis do AdsPower (varredura completa — cara)`);
  return lista.list
    .map((p) => ({ userId: p.user_id, conta: parseConta(p.name).numeros[0] }))
    .filter((c) => c.conta != null);
}

/**
 * @param opts.escrever   false = dry-run
 * @param opts.simular    injeta rastreio falso onde ainda não há (teste)
 */
export async function rodarCiclo({ contas, escrever = true, simular = false, aoLog = () => {} } = {}) {
  const inicio = new Date();
  const t0 = Date.now();
  const SIMULADO = "BR269999999999S";

  aoLog(`rodada iniciada · ${contas.length} conta(s)`);
  const resultados = await rodarFila(contas, {
    concorrencia: Number(process.env.CONCORRENCIA ?? 3),
    aoLog,
  });
  const falhas = resultados.filter((r) => !r.ok);
  const coletadas = resultados.length - falhas.length;

  // ── consolida ───────────────────────────────────────────────────
  const estado = carregar();
  let vistos = 0, novos = 0;
  for (const r of resultados.filter((x) => x.ok)) {
    const pacote = JSON.parse(readFileSync(r.arq, "utf8"));
    for (const p of pacote.pedidos ?? []) {
      if (!p.bruto) continue;
      const pedido = extrairPedido(p.bruto, { orderId: p.orderId });
      if (!estado[pedido.orderId]) novos++;
      registrar(estado, r.conta, pedido);
      vistos++;
    }
  }

  // ── casa e escreve ──────────────────────────────────────────────
  // A MESMA função que o run-shopify.mjs usa e que o relatório prova.
  // Antes havia aqui uma segunda implementação, que casava por nome contra
  // os pedidos abertos da Shopify e ignorava o número que a planilha dá.
  let escritos = 0, falhasEscrita = 0, pulados = 0;
  let pendencias = [];
  try {
    const r = await lerPendentes(process.env.PLANILHA, { aba: process.env.PLANILHA_ABA });
    const res = await escreverRastreios(r.contas, lerColetas(), {
      escrever,
      notificar: process.env.NOTIFICAR_CLIENTE === "1",
      aoLog,
    });
    escritos = res.escritos; falhasEscrita = res.falhas; pulados = res.pulados;
    pendencias = res.pendencias;

    const precisa = pendencias.filter((p) => p.motivo.grupo === "precisa").length;
    const sozinho = pendencias.length - precisa;
    aoLog(`${res.resumo.casados} com rastreio · ${precisa} precisam de você · ${sozinho} aguardam a Shopee`);
    if (!escrever) aoLog(`dry-run: ${res.planejado.length} fulfillment(s) seriam criados`);
    if (pulados) aoLog(`${pulados} pulado(s) — já escritos antes`);

    // o que exige decisão fica anotado no pedido, para o painel e a planilha
    for (const p of pendencias) {
      const alvo = Object.values(estado).find((x) => x.pedidoShopify === p.pedido);
      if (alvo) alvo.revisao = { motivo: p.motivo.texto, codigo: p.motivo.codigo,
                                 grupo: p.motivo.grupo, em: new Date().toISOString() };
    }
  } catch (e) {
    aoLog(`escrita não realizada: ${e.message}`);
    falhasEscrita++;
  }

  salvar(estado);

  // ── planilha ────────────────────────────────────────────────────
  let planilha = null;
  try {
    planilha = execFileSync("node", ["escrever-planilha.mjs", "--tudo"], { encoding: "utf8" }).trim().split("\n")[0];
  } catch (e) { aoLog(`planilha não gerada: ${e.message}`); }

  const rodada = {
    inicio: inicio.toISOString(),
    duracaoMs: Date.now() - t0,
    contas: contas.length, coletadas,
    falhas: falhas.map((f) => ({ conta: f.conta, erro: f.erro })),
    pedidosVistos: vistos, novos, escritos, falhasEscrita, pulados,
    revisao: pendencias.filter((p) => p.motivo.grupo === "precisa").length,
    planilha,
  };
  registrarRodada(rodada);

  const motivos = avaliarRodada({ contas: contas.length, coletadas, pedidosVistos: vistos, falhas });
  if (motivos.length) await alarmar("Rodada com problema", motivos.join("\n"));

  return rodada;
}
