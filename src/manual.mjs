// A saída de emergência: o operador tem o código e escreve na mão.
//
// Existe porque o robô não resolve tudo. Pedido comprado numa conta que
// ninguém mapeou, rastreio que o fornecedor mandou por WhatsApp, Shopee fora
// do ar na hora da coleta — em todos esses casos a pessoa tem o código em
// cinco segundos e o robô nunca teria. Sem este caminho, a pendência não tem
// fim e a carteira só cresce.
//
// As proteções mudam de dono, não somem: não há lado Shopee para comparar o
// nome, então QUEM confere é a pessoa — e por isso `prepararManual` devolve o
// que está na Shopify para ela olhar antes de confirmar.

import { parseTracking } from "./tracking.mjs";
import { pedidosPorNumero, normalizarNumero, montarEntrada, transportadoraDe, enviar } from "./shopify.mjs";
import { encerrarPendente } from "./estado.mjs";

const PARECE_SIMULADO = /^BR269999999999/;

/**
 * Valida o código e busca o pedido, sem escrever nada.
 * @returns {{ok:boolean, erro?:string, alvo?, codigos?}}
 */
export async function prepararManual(pedido, textoDoRastreio, { conexao } = {}) {
  const num = normalizarNumero(pedido);
  if (!num) return { ok: false, erro: "número de pedido não reconhecido" };

  const t = parseTracking(String(textoDoRastreio ?? ""));
  const codigos = (t.codes ?? []).map((c) => (typeof c === "string" ? c : c.code));
  if (!codigos.length)
    return { ok: false, erro: "não reconheci nenhum código de rastreio nesse texto" };
  if (codigos.some((c) => PARECE_SIMULADO.test(c)))
    return { ok: false, erro: "esse código é o de simulação e não pode ser escrito" };

  const achados = await pedidosPorNumero([num], { conexao });
  const alvo = achados.get(num);
  if (!alvo) return { ok: false, erro: `o pedido ${pedido} não existe na loja conectada` };
  if (alvo.situacao && alvo.situacao !== "UNFULFILLED")
    return { ok: false, erro: `esse pedido já está ${alvo.situacao} na Shopify` };
  if (!alvo.fulfillmentOrderId)
    return { ok: false, erro: "o pedido não tem entrega aberta para receber o rastreio" };

  // devolvido para a PESSOA conferir — aqui ela é a verificação de nome
  return { ok: true, alvo, codigos, transportadora: transportadoraDe(codigos) };
}

/** Escreve o que `prepararManual` devolveu. Só chame depois do olho humano. */
export async function escreverManual(preparado, { conexao, notificar = false } = {}) {
  if (!preparado?.ok) throw new Error(preparado?.erro ?? "nada preparado");
  const f = await enviar(montarEntrada({
    fulfillmentOrderId: preparado.alvo.fulfillmentOrderId,
    codigos: preparado.codigos,
    transportadora: preparado.transportadora,
    notificar,
  }), { conexao });
  return { fulfillmentId: f.id, pedido: preparado.alvo.pedido,
           codigos: f.trackingInfo.map((x) => x.number) };
}

/**
 * Prepara, escreve e tira da carteira — em uma chamada só.
 *
 * `escreverManual` sozinho deixava o pedido na carteira: ele voltava no dia
 * seguinte já despachado, e aí tomava o motivo "já está FULFILLED". Quem
 * chama não deve ter que lembrar de dois passos.
 *
 * O olho humano continua sendo um passo separado: chame `prepararManual`,
 * mostre o resultado, e só então chame isto com `confirmado`.
 */
export async function resolverManual(pedido, textoDoRastreio, {
  conexao, notificar = false, confirmado = false, nota = null,
} = {}) {
  const prep = await prepararManual(pedido, textoDoRastreio, { conexao });
  if (!prep.ok) return prep;
  if (!confirmado) return { ...prep, precisaConfirmar: true };

  const escrito = await escreverManual(prep, { conexao, notificar });
  encerrarPendente(pedido, {
    desfecho: "manual",
    nota: nota ?? `código colado na mão: ${escrito.codigos.join(", ")}`,
  });
  return { ok: true, escrito };
}
