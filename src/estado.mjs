// Estado da operação em SQLite. Mantém a API que ciclo.mjs e painel.mjs já
// usam (carregar/salvar/registrar/pendentesDeEnvio) para a troca do JSON não
// obrigar a mexer no resto; as funções por linha abaixo são o caminho novo.

import { abrir } from "./db.mjs";

let _db = null;
export function db({ aoLog } = {}) {
  if (!_db) _db = abrir({ aoLog });
  return _db;
}
export function fechar() { if (_db) { _db.close(); _db = null; } }

const paraLinha = (p) => ({
  order_id: String(p.orderId),
  conta: p.conta ?? null,
  nome: p.nome ?? null,
  cep: p.cep ?? null,
  endereco: p.endereco ?? null,
  valor: p.valor ?? null,
  produto: p.produto ?? null,
  loja: p.loja ?? null,
  transportadora: p.transportadora ?? null,
  codigos: JSON.stringify(p.codigos ?? []),
  despachado: p.despachado ? 1 : 0,
  unidades: p.unidades ?? null,
  pedido_shopify: p.pedidoShopify ?? null,
  enviado_shopify: p.enviadoShopify ? 1 : 0,
  escrita_simulada: p.escritaSimulada ? 1 : 0,
  revisao_motivo: p.revisao?.motivo ?? null,
  revisao_em: p.revisao?.em ?? null,
  dispensado_em: p.dispensadoEm ?? null,
  primeiro_visto_em: p.primeiroVistoEm ?? null,
  visto_em: p.vistoEm ?? null,
});

const deLinha = (r) => ({
  orderId: r.order_id,
  conta: r.conta,
  nome: r.nome,
  cep: r.cep,
  endereco: r.endereco,
  valor: r.valor,
  produto: r.produto,
  loja: r.loja,
  transportadora: r.transportadora,
  codigos: JSON.parse(r.codigos || "[]"),
  despachado: !!r.despachado,
  unidades: r.unidades,
  pedidoShopify: r.pedido_shopify,
  enviadoShopify: !!r.enviado_shopify,
  escritaSimulada: r.escrita_simulada ? true : undefined,
  revisao: r.revisao_motivo ? { motivo: r.revisao_motivo, em: r.revisao_em } : null,
  dispensadoEm: r.dispensado_em,
  primeiroVistoEm: r.primeiro_visto_em,
  vistoEm: r.visto_em,
});

const COLUNAS = Object.keys(paraLinha({ orderId: "x" }));
const UPSERT = `
INSERT INTO pedidos (${COLUNAS.join(", ")})
VALUES (${COLUNAS.map((c) => "@" + c).join(", ")})
ON CONFLICT(order_id) DO UPDATE SET
${COLUNAS.filter((c) => c !== "order_id" && c !== "primeiro_visto_em")
  .map((c) => `  ${c} = excluded.${c}`).join(",\n")}`;

/** Compatível com o JSON antigo: objeto indexado por orderId. */
export function carregar() {
  const linhas = db().prepare("SELECT * FROM pedidos").all();
  return Object.fromEntries(linhas.map((r) => [r.order_id, deLinha(r)]));
}

/** Grava tudo numa transação. Troca atômica, como era o rename do JSON. */
export function salvar(estado) {
  const st = db().prepare(UPSERT);
  db().transaction((lista) => { for (const p of lista) st.run(paraLinha(p)); })(Object.values(estado));
}

export function registrar(estado, conta, pedido) {
  const antes = estado[pedido.orderId];
  const agora = new Date().toISOString();
  estado[pedido.orderId] = {
    ...antes,
    ...pedido,
    conta,
    vistoEm: agora,
    primeiroVistoEm: antes?.primeiroVistoEm ?? agora,
    enviadoShopify: antes?.enviadoShopify ?? false,
  };
  return estado[pedido.orderId];
}

export const pendentesDeEnvio = (estado) =>
  Object.values(estado).filter((p) => p.despachado && !p.enviadoShopify);

// ── caminho novo: operações por linha, sem carregar a base toda ──────────

export const gravarPedido = (p) => db().prepare(UPSERT).run(paraLinha(p));
export const pedido = (orderId) => {
  const r = db().prepare("SELECT * FROM pedidos WHERE order_id = ?").get(String(orderId));
  return r ? deLinha(r) : null;
};
export const emRevisao = () =>
  db().prepare("SELECT * FROM pedidos WHERE revisao_motivo IS NOT NULL").all().map(deLinha);
export const aEscrever = () =>
  db().prepare("SELECT * FROM pedidos WHERE despachado = 1 AND enviado_shopify = 0").all().map(deLinha);

/** Qual conta Shopee pagou qual pedido da Shopify. Ver DECISOES.md §4. */
export function anotarMapeamento(pedidoShopify, conta, origem = "coleta") {
  db().prepare(`
    INSERT INTO mapeamento (pedido_shopify, conta, origem, criado_em)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(pedido_shopify) DO UPDATE SET
      conta = excluded.conta, origem = excluded.origem
  `).run(String(pedidoShopify), Number(conta), origem, new Date().toISOString());
}
export const contaDoPedido = (pedidoShopify) =>
  db().prepare("SELECT conta, origem FROM mapeamento WHERE pedido_shopify = ?").get(String(pedidoShopify)) ?? null;

/** Quanto do mapeamento já vem do banco — o número que decide a virada v1→v2. */
export function coberturaMapeamento() {
  const r = db().prepare(`
    SELECT origem, count(*) n FROM mapeamento GROUP BY origem
  `).all();
  const total = r.reduce((s, x) => s + x.n, 0);
  return { total, porOrigem: Object.fromEntries(r.map((x) => [x.origem, x.n])) };
}
