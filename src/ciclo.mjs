// Uma rodada completa: coleta -> consolida -> casa -> escreve -> planilha.
// É o que o agendador dispara e o que o painel mostra.

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { rodarFila } from "./fila.mjs";
import { extrairPedido } from "./shopee.mjs";
import { carregar, salvar, registrar, historico, registrarRodada } from "./estado.mjs";
import { listarPerfisOuNull } from "./adspower.mjs";
import { parseConta } from "./tracking.mjs";
import { normNome } from "./match.mjs";
import { pedidosAbertos, montarEntrada, transportadoraDe, enviar } from "./shopify.mjs";
import { alarmar, avaliarRodada } from "./alarme.mjs";

export { historico };

export async function descobrirContas(args = []) {
  if (args.length) return args.map((a) => ({ serial: Number(a), conta: Number(a) }));
  if (existsSync("contas.json")) return JSON.parse(readFileSync("contas.json", "utf8"));
  const lista = await listarPerfisOuNull(1, 500);
  if (!lista) throw new Error("sem contas.json e user/list indisponível — passe os seriais como argumento");
  return lista.list
    .map((p) => ({ userId: p.user_id, conta: parseConta(p.name).numeros[0] }))
    .filter((c) => c.conta != null);
}

/** Casa um pedido da Shopee contra os pedidos abertos da Shopify. */
export function casar(p, abertos) {
  let c = abertos.filter((o) => normNome(o.nome) === normNome(p.nome));
  if (c.length === 0) return { decisao: "nenhum", motivo: "nenhum pedido aberto com esse nome", candidatos: 0 };

  let criterio = "nome";
  if (c.length > 1 && p.cep) {
    const porCep = c.filter((o) => o.cep === p.cep);
    if (porCep.length) { c = porCep; criterio = "nome+cep"; }
  }
  if (c.length > 1 && p.valor != null) {
    const porValor = c.filter((o) => Math.abs(o.valor - p.valor) < 0.01);
    if (porValor.length) { c = porValor; criterio += "+valor"; }
  }
  if (c.length > 1)
    return { decisao: "ambiguo", motivo: `${c.length} pedidos idênticos mesmo com CEP e valor`, candidatos: c.length };
  return { decisao: "unico", alvo: c[0], criterio, candidatos: 1 };
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
  let escritos = 0;
  const revisao = [];
  let abertos = [];
  try {
    abertos = await pedidosAbertos({});
    aoLog(`${abertos.length} pedido(s) aberto(s) na Shopify`);
  } catch (e) {
    aoLog(`Shopify indisponível: ${e.message}`);
  }

  for (const p of Object.values(estado)) {
    if (p.enviadoShopify) continue;

    let codigos = p.codigos ?? [];
    let simulado = false;
    if (codigos.length === 0) {
      if (!simular) {
        p.revisao = null; // ainda não despachado não é pendência
        continue;
      }
      codigos = [SIMULADO]; simulado = true;
    }

    const m = casar(p, abertos);
    if (m.decisao !== "unico") {
      p.revisao = { motivo: m.motivo, candidatos: m.candidatos, em: new Date().toISOString() };
      revisao.push({ orderId: p.orderId, nome: p.nome, motivo: m.motivo });
      continue;
    }
    p.revisao = null;

    if (!escrever) continue;
    try {
      const f = await enviar(montarEntrada({
        fulfillmentOrderId: m.alvo.fulfillmentOrderId,
        codigos: codigos.map((c) => ({ code: c, carrier: /^SPX/i.test(c) ? "shopee-xpress" : "correios" })),
        transportadora: transportadoraDe(codigos),
        notificar: process.env.NOTIFICAR_CLIENTE === "1",
      }), {});
      p.pedidoShopify = m.alvo.pedido;
      p.unidades = m.alvo.unidades;
      p.enviadoShopify = !simulado;     // simulado volta na próxima rodada
      p.escritaSimulada = simulado || undefined;
      escritos++;
      aoLog(`${p.nome} -> ${m.alvo.pedido} por ${m.criterio}${simulado ? " (simulado)" : ""} · ${f.status}`);
    } catch (e) {
      p.revisao = { motivo: `falha ao escrever na Shopify: ${e.message}`, em: new Date().toISOString() };
      revisao.push({ orderId: p.orderId, nome: p.nome, motivo: p.revisao.motivo });
      aoLog(`${p.nome}: ERRO ao escrever — ${e.message}`);
    }
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
    pedidosVistos: vistos, novos, escritos,
    revisao: revisao.length,
    planilha,
  };
  registrarRodada(rodada);

  const motivos = avaliarRodada({ contas: contas.length, coletadas, pedidosVistos: vistos, falhas });
  if (motivos.length) await alarmar("Rodada com problema", motivos.join("\n"));

  return rodada;
}
