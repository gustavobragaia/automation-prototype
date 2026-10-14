// Extrai o que interessa do JSON de detalhe do pedido da Shopee.
// Mapeamento confirmado contra um pedido real em 14/10/2026.

const txt = (v) => (typeof v === "string" ? v.trim() : "");

// A Shopee guarda o valor como inteiro escalado. Com os números do pedido
// de teste (item 358000, antes 700000, total 431000) tanto 10.000 quanto
// 100.000 fecham de forma coerente:
//   /10000  -> item 35,80 · antes 70,00 · total 43,10 (frete 7,30)
//   /100000 -> item  3,58 · antes  7,00 · total  4,31 (frete 0,73)
// Confirmado com o pedido de teste: foram pagos R$ 4,31, logo o divisor
// é 100.000. Errar aqui corrompe o casamento por valor em silêncio, então
// fica explícito e configurável.
export const DIVISOR_VALOR = Number(process.env.SHOPEE_DIVISOR_VALOR ?? 100000);
export const paraReais = (n) => (typeof n === "number" ? n / DIVISOR_VALOR : null);

// "Rua Dona Regina, S/N, Piracicaba, São Paulo, 13424165"
export function extrairCep(endereco) {
  const m = txt(endereco).match(/\b(\d{5})-?(\d{3})\b/);
  return m ? `${m[1]}${m[2]}` : null;
}

/**
 * @param detalhe corpo de /api/v4/order/get_order_detail
 * @returns pedido normalizado, pronto para o casamento
 */
export function extrairPedido(detalhe, { orderId } = {}) {
  const d = detalhe?.data ?? detalhe ?? {};
  const envio = d.pc_shipping ?? {};
  const pacotes = Array.isArray(envio.forder_shipping_info_list) ? envio.forder_shipping_info_list : [];

  const codigos = pacotes
    .map((p) => txt(p.tracking_number))
    .filter(Boolean);

  const transportadora =
    txt(envio.fulfilment_carrier?.text) ||
    txt(pacotes[0]?.fulfilment_carrier?.text) ||
    null;

  const endereco = txt(d.address?.shipping_address);

  return {
    orderId: String(orderId ?? d.info_card?.order_id ?? ""),
    nome: txt(d.address?.shipping_name),
    telefone: txt(d.address?.shipping_phone),
    endereco,
    cep: extrairCep(endereco),
    valor: paraReais(d.info_card?.final_total),
    produto: txt(d.info_card?.parcel_cards?.[0]?.product_info?.item_groups?.[0]?.items?.[0]?.name) || null,
    loja: txt(d.info_card?.parcel_cards?.[0]?.shop_info?.shop_name) || null,
    transportadora,
    codigos,
    numPacotes: envio.num_parcels ?? pacotes.length ?? 1,
    multiPacote: Boolean(envio.is_multi_parcel),
    // "despachado" = já existe pelo menos um código
    despachado: codigos.length > 0,
    statusBruto: txt(d.status?.status_label?.text),
  };
}

// Casamento ganha o endereço, que a planilha não tinha: o CEP desempata
// homônimos muito melhor que valor e produto.
export function chaveDeCasamento(p) {
  return { nome: p.nome, cep: p.cep, valor: p.valor, produto: p.produto };
}
