// Estado da operação em SQLite. Mantém a API que ciclo.mjs e painel.mjs já
// usam (carregar/salvar/registrar/pendentesDeEnvio) para a troca do JSON não
// obrigar a mexer no resto; as funções por linha abaixo são o caminho novo.

import { abrir } from "./sqlite-db.mjs";

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

// ── rodadas ──────────────────────────────────────────────────────────────

export function historico(limite = 200) {
  return db().prepare(`
    SELECT inicio, duracao_ms, contas, coletadas, pedidos_vistos, novos,
           escritos, revisao, falhas, planilha
      FROM rodadas ORDER BY id DESC LIMIT ?`).all(limite).map((r) => ({
    inicio: r.inicio, duracaoMs: r.duracao_ms, contas: r.contas,
    coletadas: r.coletadas, pedidosVistos: r.pedidos_vistos, novos: r.novos,
    escritos: r.escritos, revisao: r.revisao,
    falhas: JSON.parse(r.falhas || "[]"), planilha: r.planilha,
  }));
}

export function registrarRodada(r) {
  const info = db().prepare(`
    INSERT INTO rodadas (inicio, duracao_ms, contas, coletadas, pedidos_vistos,
                         novos, escritos, revisao, falhas, planilha)
    VALUES (@inicio, @duracao_ms, @contas, @coletadas, @pedidos_vistos,
            @novos, @escritos, @revisao, @falhas, @planilha)`).run({
    inicio: r.inicio, duracao_ms: r.duracaoMs, contas: r.contas,
    coletadas: r.coletadas, pedidos_vistos: r.pedidosVistos, novos: r.novos,
    escritos: r.escritos, revisao: r.revisao,
    falhas: JSON.stringify(r.falhas ?? []), planilha: r.planilha ?? null,
  });
  return Number(info.lastInsertRowid);   // os motivos referenciam a rodada
}

// ── motivos ───────────────────────────────────────────────────────────────
// Append-only, uma linha por rodada. `pedidos.revisao_motivo` guarda só o
// motivo ATUAL e é sobrescrito; aqui fica a história, que é o que responde
// "por que o pedido do dia 18 ficou sem rastreio" semanas depois.

export function gravarMotivos(pendencias, { rodadaId = null, em = new Date().toISOString() } = {}) {
  if (!pendencias?.length) return 0;
  const ins = db().prepare(`
    INSERT INTO pedido_motivos (order_id, pedido_shopify, conta, rodada_id, motivo, grupo, detalhe, em)
    VALUES (@order_id, @pedido_shopify, @conta, @rodada_id, @motivo, @grupo, @detalhe, @em)`);
  const marcar = db().prepare(`
    UPDATE pedidos SET revisao_motivo = @motivo, revisao_grupo = @grupo, revisao_em = @em
    WHERE pedido_shopify = @pedido_shopify`);

  const tudo = db().transaction((lista) => {
    for (const p of lista) {
      const d = p.motivo.sugestoes || p.motivo.shopee || p.motivo.erro
        ? JSON.stringify({ sugestoes: p.motivo.sugestoes?.map((s) => s.conta),
                           shopee: p.motivo.shopee, shopify: p.motivo.shopify, erro: p.motivo.erro })
        : null;
      ins.run({ order_id: p.orderId ?? null, pedido_shopify: p.pedido ?? null,
                conta: p.conta ?? null, rodada_id: rodadaId,
                motivo: p.motivo.codigo, grupo: p.motivo.grupo, detalhe: d, em });
      if (p.pedido) marcar.run({ motivo: p.motivo.codigo, grupo: p.motivo.grupo, em, pedido_shopify: p.pedido });
    }
  });
  tudo(pendencias);
  return pendencias.length;
}

const lerMotivos = (sql, arg) => db().prepare(sql).all(arg).map((r) => ({
  pedidoShopify: r.pedido_shopify, conta: r.conta, orderId: r.order_id,
  motivo: r.motivo, grupo: r.grupo, detalhe: r.detalhe, rodadaId: r.rodada_id, em: r.em,
}));

export const motivosDoPedido = (pedidoShopify) =>
  lerMotivos("SELECT * FROM pedido_motivos WHERE pedido_shopify = ? ORDER BY em", pedidoShopify);

export const motivosDaRodada = (rodadaId) =>
  lerMotivos("SELECT * FROM pedido_motivos WHERE rodada_id = ? ORDER BY id", rodadaId);

export const nome = "sqlite";

// ── pendentes ─────────────────────────────────────────────────────────────
// O que atravessa o dia. Ver migracoes/003-pendentes.sql.

const hojeISO = () => new Date().toISOString().slice(0, 10);

export function guardarPendentes(pendencias, { em = new Date().toISOString() } = {}) {
  if (!pendencias?.length) return 0;
  const sql = db().prepare(`
    INSERT INTO pendentes (pedido_shopify, conta, nome, valor, produto, unidades,
                           motivo, grupo, visto_em, ultima_em, dias, adiado_ate)
    VALUES (@pedido, @conta, @nome, @valor, @produto, @unidades,
            @motivo, @grupo, @em, @em, 1, @adiado_ate)
    ON CONFLICT (pedido_shopify) DO UPDATE SET
      conta      = COALESCE(excluded.conta, conta),
      nome       = COALESCE(excluded.nome, nome),
      valor      = COALESCE(excluded.valor, valor),
      produto    = COALESCE(excluded.produto, produto),
      unidades   = COALESCE(excluded.unidades, unidades),
      motivo     = excluded.motivo,
      grupo      = excluded.grupo,
      adiado_ate = COALESCE(excluded.adiado_ate, adiado_ate),
      baixado_em = NULL,
      -- conta DIAS distintos, não rodadas: rodar três vezes num dia não pode
      -- fazer um pedido parecer velho de três dias
      dias       = dias + (CASE WHEN substr(pendentes.ultima_em,1,10) <> substr(excluded.ultima_em,1,10)
                                THEN 1 ELSE 0 END),
      ultima_em  = excluded.ultima_em`);
  const tudo = db().transaction((lista) => {
    for (const p of lista) {
      if (!p.pedido) continue;
      sql.run({ pedido: p.pedido, conta: p.conta ?? null, nome: p.nome ?? null,
                valor: p.valor ?? null, produto: p.produto ?? null, unidades: p.unidades ?? null,
                motivo: p.motivo?.codigo ?? null, grupo: p.motivo?.grupo ?? null,
                em, adiado_ate: p.adiadoAte ?? null });
    }
  });
  tudo(pendencias);
  return pendencias.length;
}

export function pendentesAbertos({ hoje = hojeISO() } = {}) {
  return db().prepare(`
    SELECT * FROM pendentes
    WHERE baixado_em IS NULL AND (adiado_ate IS NULL OR adiado_ate <= @hoje)
    ORDER BY dias DESC`).all({ hoje }).map((r) => ({
      pedido: r.pedido_shopify, conta: r.conta, nome: r.nome, valor: r.valor,
      produto: r.produto, unidades: r.unidades, motivo: r.motivo, grupo: r.grupo,
      vistoEm: r.visto_em, ultimaEm: r.ultima_em, dias: r.dias,
      adiadoAte: r.adiado_ate, baixadoEm: r.baixado_em,
    }));
}

export function adiarPendente(pedido, ate) {
  return db().prepare("UPDATE pendentes SET adiado_ate = ? WHERE pedido_shopify = ?")
    .run(ate, pedido).changes > 0;
}

export function baixarPendentes(pedidos, { em = new Date().toISOString() } = {}) {
  const sql = db().prepare(
    "UPDATE pendentes SET baixado_em = ? WHERE pedido_shopify = ? AND baixado_em IS NULL");
  let n = 0;
  db().transaction((lista) => { for (const p of lista) n += sql.run(em, p).changes; })(pedidos);
  return n;
}
