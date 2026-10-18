// Armazenamento em arquivo JSON. É o padrão da fase 1: zero dependência
// nativa, zero migração, nada que possa falhar sozinho na máquina do cliente.
//
// Limite conhecido e aceito nesta fase: reescreve o arquivo inteiro a cada
// gravação. Com 300 pedidos/dia isso incomoda em meses, não em semanas — e
// é exatamente o risco que a fase 3 resolve trocando por SQLite.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const ARQ_PEDIDOS = process.env.ESTADO_PEDIDOS ?? "estado/pedidos.json";
const ARQ_RODADAS = process.env.ESTADO_RODADAS ?? "estado/rodadas.json";
const ARQ_MOTIVOS = process.env.ESTADO_MOTIVOS ?? "estado/motivos.json";

const ler = (arq, vazio) => {
  if (!existsSync(arq)) return vazio;
  try { return JSON.parse(readFileSync(arq, "utf8")); } catch { return vazio; }
};

// Troca atômica: nunca deixa o arquivo pela metade se cair no meio.
function escrever(arq, dados) {
  mkdirSync(dirname(arq), { recursive: true });
  const tmp = `${arq}.tmp`;
  writeFileSync(tmp, JSON.stringify(dados, null, 2));
  renameSync(tmp, arq);
}

export const carregar = () => ler(ARQ_PEDIDOS, {});
export const salvar = (estado) => escrever(ARQ_PEDIDOS, estado);

export function registrar(estado, conta, pedido) {
  const antes = estado[pedido.orderId];
  const agora = new Date().toISOString();
  estado[pedido.orderId] = {
    ...antes, ...pedido, conta,
    vistoEm: agora,
    primeiroVistoEm: antes?.primeiroVistoEm ?? agora,
    enviadoShopify: antes?.enviadoShopify ?? false,
  };
  return estado[pedido.orderId];
}

export const pendentesDeEnvio = (estado) =>
  Object.values(estado).filter((p) => p.despachado && !p.enviadoShopify);

// ── operações por linha, para o código novo não depender de carregar tudo ──

export function gravarPedido(p) {
  const e = carregar();
  registrar(e, p.conta, p);
  salvar(e);
}
export const pedido = (orderId) => carregar()[String(orderId)] ?? null;
export const emRevisao = () => Object.values(carregar()).filter((p) => p.revisao);
export const aEscrever = () =>
  Object.values(carregar()).filter((p) => p.despachado && !p.enviadoShopify);

// ── mapeamento pedido Shopify ↔ conta Shopee (DECISOES.md §4) ─────────────

const ARQ_MAPA = process.env.ESTADO_MAPA ?? "estado/mapeamento.json";

export function anotarMapeamento(pedidoShopify, conta, origem = "coleta") {
  const m = ler(ARQ_MAPA, {});
  m[String(pedidoShopify)] = { conta: Number(conta), origem, criadoEm: new Date().toISOString() };
  escrever(ARQ_MAPA, m);
}
export const contaDoPedido = (pedidoShopify) => ler(ARQ_MAPA, {})[String(pedidoShopify)] ?? null;

export function coberturaMapeamento() {
  const m = Object.values(ler(ARQ_MAPA, {}));
  const porOrigem = {};
  for (const x of m) porOrigem[x.origem] = (porOrigem[x.origem] ?? 0) + 1;
  return { total: m.length, porOrigem };
}

// ── rodadas ───────────────────────────────────────────────────────────────

export const historico = (limite = 200) => ler(ARQ_RODADAS, []).slice(0, limite);

export function registrarRodada(r) {
  const h = ler(ARQ_RODADAS, []);
  const id = (h[0]?.id ?? 0) + 1;
  h.unshift({ id, ...r });
  escrever(ARQ_RODADAS, h.slice(0, 200));
  return id;   // a gravação de motivos precisa saber de qual rodada veio
}

// ── motivos ───────────────────────────────────────────────────────────────
// Append-only: a sequência de motivos de um pedido É a história dele.
// "ainda sem rastreio" na segunda e "não achado na conta" na quarta contam
// coisas diferentes, e só a sequência mostra padrão por conta.

export function gravarMotivos(pendencias, { rodadaId = null, em = new Date().toISOString() } = {}) {
  if (!pendencias?.length) return 0;
  const todos = ler(ARQ_MOTIVOS, []);
  for (const p of pendencias)
    todos.push({
      pedidoShopify: p.pedido ?? null, conta: p.conta ?? null, orderId: p.orderId ?? null,
      motivo: p.motivo.codigo, grupo: p.motivo.grupo,
      detalhe: p.motivo.sugestoes || p.motivo.shopee || p.motivo.erro
        ? JSON.stringify({ sugestoes: p.motivo.sugestoes?.map((s) => s.conta),
                           shopee: p.motivo.shopee, shopify: p.motivo.shopify, erro: p.motivo.erro })
        : null,
      rodadaId, em,
    });
  // 20 mil linhas cobrem uns dois meses a 300 pedidos/dia; o SQLite da
  // fase 3 não tem esse teto.
  escrever(ARQ_MOTIVOS, todos.slice(-20000));
  return pendencias.length;
}

export const motivosDoPedido = (pedidoShopify) =>
  ler(ARQ_MOTIVOS, []).filter((m) => m.pedidoShopify === pedidoShopify);

export const motivosDaRodada = (rodadaId) =>
  ler(ARQ_MOTIVOS, []).filter((m) => m.rodadaId === rodadaId);

export const fechar = () => {};
export const nome = "json";
