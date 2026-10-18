// O que torna um motivo acionável, e que não cabe numa coluna por motivo.
//
// A carteira guardava `motivo = "nome-nao-confere"` e jogava fora QUAL nome
// está na Shopee e qual está na Shopify. Na tela, a pessoa lia "nome não
// confere" e não tinha como decidir — o que ela precisa é ver os dois lados.
// O mesmo vale para a sugestão de outra conta, os candidatos de um empate e
// o erro que a Shopify devolveu: tudo nascia na rodada e morria com ela.
//
// Vive num módulo próprio porque os dois armazenamentos precisam dele, e
// json.mjs não pode importar sqlite.mjs — carregaria o better-sqlite3 para
// quem escolheu não usar banco.

/** @returns {string|null} JSON pronto para a coluna, ou null se não há detalhe. */
export function detalheDoMotivo(m) {
  if (!m) return null;
  const d = {};
  if (m.shopee != null) d.shopee = m.shopee;
  if (m.shopify != null) d.shopify = m.shopify;
  if (m.erro != null) d.erro = m.erro;
  if (m.sugestoes?.length)
    d.sugestoes = m.sugestoes.map((s) => ({ conta: s.conta, codigos: s.pedido?.codigos ?? [] }));
  if (m.candidatos?.length) d.candidatos = m.candidatos;
  return Object.keys(d).length ? JSON.stringify(d) : null;
}

/** O caminho de volta: do que está guardado para o que a tela desenha. */
export function lerDetalhe(bruto) {
  if (!bruto) return null;
  if (typeof bruto === "object") return bruto;
  try { return JSON.parse(bruto); } catch { return null; }
}
