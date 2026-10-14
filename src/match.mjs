// Motor de casamento Shopee -> Shopify.
//
// Regra central: só escreve na Shopify quando a identificação é única.
// Qualquer ambiguidade vai para revisão humana, nunca para um palpite.

export function normNome(s) {
  if (!s) return "";
  return String(s)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // tira acento
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normProduto(s) {
  if (!s) return "";
  return normNome(s).replace(/\b(cor|tam|tamanho)\b.*$/, "").trim();
}

const centavos = (v) => (v == null ? null : Math.round(Number(v) * 100));

/**
 * @param alvo    pedido lido na Shopee  { nome, valor, produto, unidades }
 * @param abertos pedidos da Shopify ainda sem rastreio
 * @param opts    { usarValor, usarProduto }
 * @returns { decisao: "unico"|"ambiguo"|"nenhum", pedido?, candidatos, criterio }
 */
export function casar(alvo, abertos, opts = {}) {
  const { usarValor = true, usarProduto = true } = opts;

  const nome = normNome(alvo.nome);
  if (!nome) return { decisao: "nenhum", candidatos: 0, criterio: "sem-nome" };

  let c = abertos.filter((p) => normNome(p.nome) === nome);
  if (c.length === 0) return { decisao: "nenhum", candidatos: 0, criterio: "nome" };
  if (c.length === 1) return { decisao: "unico", pedido: c[0], candidatos: 1, criterio: "nome" };

  // empate no nome -> tenta o valor pago
  if (usarValor && centavos(alvo.valor) != null) {
    const porValor = c.filter((p) => centavos(p.valor) === centavos(alvo.valor));
    if (porValor.length === 1)
      return { decisao: "unico", pedido: porValor[0], candidatos: c.length, criterio: "nome+valor" };
    if (porValor.length > 0) c = porValor;
  }

  // ainda empatado -> tenta o produto
  if (usarProduto && alvo.produto) {
    const prod = normProduto(alvo.produto);
    const porProduto = c.filter((p) => normProduto(p.produto) === prod);
    if (porProduto.length === 1)
      return { decisao: "unico", pedido: porProduto[0], candidatos: c.length, criterio: "nome+valor+produto" };
    if (porProduto.length > 0) c = porProduto;
  }

  return { decisao: "ambiguo", candidatos: c.length, criterio: "esgotado" };
}
