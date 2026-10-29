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
import { lerRegistro, gravarRegistro } from "./escrita.mjs";
import { diaLocal } from "./datas.mjs";

const PARECE_SIMULADO = /^BR269999999999/;

/**
 * Códigos que o robô já escreveu em OUTRO pedido. A escrita em lote tem essa
 * proteção; a conferência não tinha, e o Matheus (29/10/2026) mandou o mesmo
 * rastreio para dois pedidos do mesmo cliente sem nenhum aviso. Às vezes é
 * certo (uma compra na Shopee cobrindo dois pedidos) — então avisa e pede
 * confirmação, sem bloquear.
 * @returns [{ codigo, pedido }]
 */
export function codigosJaUsados(codigos, pedido, registro = lerRegistro()) {
  const meu = normalizarNumero(pedido) ?? String(pedido);
  const saida = [];
  for (const [num, r] of Object.entries(registro ?? {})) {
    if (num === meu) continue;
    for (const c of r?.codigos ?? [])
      if (codigos.includes(String(c))) saida.push({ codigo: String(c), pedido: r.pedido ?? `#${num}` });
  }
  return saida;
}

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
  return { ok: true, alvo, codigos, transportadora: transportadoraDe(codigos),
           repetidos: codigosJaUsados(codigos, num) };
}

/**
 * O que a conferência escreveu hoje. O "Usar este" escreve na hora do
 * clique, então esses pedidos nunca entram na lista da etapa 4 — e o
 * Matheus achou que tinham sumido. A etapa 4 mostra estes à parte.
 * `repetidoEm`: outros pedidos que estão com o mesmo rastreio.
 */
export function escritosNaConferencia(registro = lerRegistro(), { agora = new Date() } = {}) {
  const hoje = diaLocal(agora);
  const todos = Object.entries(registro ?? {});
  return todos
    .filter(([, r]) => r?.origem === "manual" && r.em && diaLocal(new Date(r.em)) === hoje)
    .map(([num, r]) => ({
      pedido: r.pedido ?? `#${num}`, codigos: r.codigos ?? [], em: r.em,
      repetidoEm: todos.filter(([n, o]) => n !== num && (o?.codigos ?? []).some((c) => (r.codigos ?? []).includes(c)))
        .map(([n, o]) => o.pedido ?? `#${n}`),
    }))
    .sort((a, b) => b.em.localeCompare(a.em));
}

/** Escreve o que `prepararManual` devolveu. Só chame depois do olho humano. */
export async function escreverManual(preparado, { conexao, notificar = false, conta = null } = {}) {
  if (!preparado?.ok) throw new Error(preparado?.erro ?? "nada preparado");
  const f = await enviar(montarEntrada({
    fulfillmentOrderId: preparado.alvo.fulfillmentOrderId,
    codigos: preparado.codigos,
    transportadora: preparado.transportadora,
    notificar,
  }), { conexao });

  // O mesmo registro que a escrita em lote consulta antes de escrever.
  // Sem isto, a idempotência dependia só de a Shopify já aparecer como
  // FULFILLED — uma ida à rede, e uma aposta no estado do outro lado.
  // Agora o robô sabe por si que este pedido já foi escrito hoje.
  const num = normalizarNumero(preparado.alvo.pedido) ?? preparado.alvo.pedido;
  const registro = lerRegistro();
  registro[num] = {
    fulfillmentId: f.id, pedido: preparado.alvo.pedido, conta,
    codigos: f.trackingInfo.map((x) => x.number),
    em: new Date().toISOString(), origem: "manual",
  };
  gravarRegistro(registro);

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
  conexao, notificar = false, confirmado = false, nota = null, aceitarRepetido = false,
} = {}) {
  const prep = await prepararManual(pedido, textoDoRastreio, { conexao });
  if (!prep.ok) return prep;
  if (!confirmado) return { ...prep, precisaConfirmar: true };
  // Rastreio que já foi para outro pedido: nada é escrito até a pessoa dizer
  // que é isso mesmo.
  if (prep.repetidos.length && !aceitarRepetido)
    return { ok: false, repetidos: prep.repetidos,
             erro: prep.repetidos.map((x) => `o rastreio ${x.codigo} já foi escrito no pedido ${x.pedido}`).join("; ") };

  const escrito = await escreverManual(prep, { conexao, notificar });
  encerrarPendente(pedido, {
    desfecho: "manual",
    nota: nota ?? `código colado na mão: ${escrito.codigos.join(", ")}`,
  });
  return { ok: true, escrito };
}
