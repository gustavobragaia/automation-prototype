// A carteira contra a Shopify: o que já foi atendido lá sai daqui.
//
// Um pedido só saía da carteira quando o ROBÔ escrevia o rastreio, ou quando
// alguém decidia na conferência. O que foi resolvido por fora — colado à mão
// na Shopify, por exemplo — ficava na conferência para sempre (Matheus,
// 22/10: "pedidos de 2 dias atrás que já foram resolvidos").
//
// Só leitura na Shopify. Sai só o que está FULFILLED: parcialmente atendido
// ainda pode precisar de rastreio, e fica.
import { pendentesAbertos, encerrarPendente } from "./estado.mjs";
import { pedidosPorNumero, normalizarNumero } from "./shopify.mjs";

export const DESFECHO_JA_NA_SHOPIFY = "ja-na-shopify";

/** @returns {Promise<{pedido, nome, conta}[]>} os que saíram da carteira */
export async function tirarJaAtendidos(opts = {}) {
  // adiados também: um pedido adiado para amanhã que já foi atendido hoje
  // não precisa voltar amanhã
  const abertos = pendentesAbertos({ hoje: "9999-12-31" });
  if (!abertos.length) return [];
  const naLoja = await pedidosPorNumero(abertos.map((p) => p.pedido), opts);
  const sairam = [];
  for (const p of abertos) {
    if (naLoja.get(normalizarNumero(p.pedido))?.situacao !== "FULFILLED") continue;
    if (encerrarPendente(p.pedido, { desfecho: DESFECHO_JA_NA_SHOPIFY, nota: "já estava atendido na Shopify" }))
      sairam.push({ pedido: p.pedido, nome: p.nome, conta: p.conta });
  }
  return sairam;
}
