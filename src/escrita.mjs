// Da planilha do dia até o fulfillment na Shopify. UMA implementação.
//
// Existia uma em `ciclo.mjs` (a que o cliente rodava, casando por nome) e
// outra em `run-shopify.mjs` (a provada contra os dados reais). Duas
// implementações para a mesma decisão significa que o relatório deixa de
// provar o que vai ser escrito — e a pior das duas estava em produção.
//
// A planilha já diz QUAL pedido da Shopify é. Então o pedido é buscado pelo
// número, exato, e o nome entra só como CONFERÊNCIA: se o destinatário não
// for o mesmo dos dois lados, não escreve. Rastreio no pedido errado é pior
// que rastreio ausente.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { conciliar, resolvido, motivoDe } from "./conciliar.mjs";
import { parseTracking } from "./tracking.mjs";
import { normNome } from "./match.mjs";
import { pedidosPorNumero, normalizarNumero, montarEntrada, transportadoraDe, enviar } from "./shopify.mjs";
import { emEstado } from "./caminhos.mjs";

// A extensão roda dentro do navegador e pode voltar com a flag de teste
// ligada por engano. Código simulado nunca chega na Shopify.
const PARECE_SIMULADO = /^BR269999999999/;

const ARQ_REGISTRO = process.env.REGISTRO_ESCRITAS ?? emEstado("escritas-shopify.json");

/** Rodar duas vezes no mesmo dia não pode criar dois fulfillments. */
export function lerRegistro(arq = ARQ_REGISTRO) {
  if (!existsSync(arq)) return {};
  try { return JSON.parse(readFileSync(arq, "utf8")); } catch { return {}; }
}
export function gravarRegistro(reg, arq = ARQ_REGISTRO) {
  mkdirSync(dirname(arq), { recursive: true });
  writeFileSync(arq, JSON.stringify(reg, null, 2));
}

/**
 * @param contas    saída de lerPendentes().contas
 * @param coletas   Map<conta, pedidos> de lerColetas()
 * @param escrever  false = dry-run
 * @returns { escritos, falhas, pulados, pendencias, planejado, gravados, jaAtendidos }
 */
export async function escreverRastreios(contas, coletas, {
  escrever = false, notificar = false, conexao, aoLog = () => {},
  // A tela mostra "Conferindo…" e "Escrevendo 8 de 40…": a escrita passa de
  // um minuto num lote grande, e sem isso parecia travada.
  aoProgresso = () => {},
} = {}) {
  const { linhas, resumo } = conciliar(contas, coletas);
  const registro = lerRegistro();

  const pendencias = [];
  // A pendência atravessa o dia e vira a "linha de planilha" de amanhã — a
  // planilha do cliente só traz os pagos daquele dia. Então leva tudo o que
  // a conciliação precisa: sem valor, o desempate e a regra do pedido
  // dividido deixam de funcionar no dia seguinte.
  const comoLinha = (l, motivo) => ({
    pedido: l.p.pedido, conta: l.conta, nome: l.p.nome,
    valor: l.p.valor ?? null, produto: l.p.produto ?? null, unidades: l.p.unidades ?? null,
    motivo,
  });
  const anotar = (l, codigo, extra) => {
    const m = motivoDe(codigo, extra);
    l.motivo = m;
    pendencias.push(comoLinha(l, m));
  };

  // o que a conciliação já marcou (ainda sem rastreio, ambíguo, não achado)
  for (const l of linhas) if (l.motivo) pendencias.push(comoLinha(l, l.motivo));

  const prontos = linhas.filter((l) => resolvido(l.estado) && normalizarNumero(l.p.pedido));
  for (const l of linhas)
    if (resolvido(l.estado) && !normalizarNumero(l.p.pedido))
      anotar(l, "sem-numero-de-pedido");

  if (!prontos.length) return { escritos: 0, falhas: 0, pulados: 0, pendencias, planejado: [], resumo };

  if (escrever) aoProgresso({ fase: "conferindo", total: prontos.length });
  const naShopify = await pedidosPorNumero(prontos.map((l) => normalizarNumero(l.p.pedido)), { conexao });
  aoLog(`${naShopify.size} de ${new Set(prontos.map((l) => normalizarNumero(l.p.pedido))).size} número(s) encontrado(s) na loja`);

  const planejado = [];
  let pulados = 0;
  // Já atendido na Shopify (pelo robô antes, ou colado à mão): não há o que
  // escrever, e o pedido tem que SAIR da carteira. Antes era só "pulado", e
  // ficava na conferência para sempre (Matheus, 22/10: "pedidos de 2 dias
  // atrás que já foram resolvidos").
  const jaAtendidos = [];

  // Uma escrita por PEDIDO, com os rastreios de TODAS as linhas dele.
  // Pedido com 2 produtos vem em 2 linhas (19 em 200 na planilha de 21/10):
  // a 2ª linha mandava o mesmo rastreio de novo e a Shopify recusava. E o
  // mesmo pedido pode ter sido comprado em DUAS contas (#165688, 16/10:
  // 2 linhas na conta 236 e 1 na 237): antes só a 1ª linha valia, e o rastreio
  // da outra conta sumia sem aviso — nem Shopify, nem conferência.
  const porNumero = new Map();
  for (const l of prontos) {
    const num = normalizarNumero(l.p.pedido);
    if (!porNumero.has(num)) porNumero.set(num, []);
    porNumero.get(num).push(l);
  }
  // Uma parte do pedido ainda sem rastreio (ou em dúvida): escrever só a
  // outra fecharia a entrega na Shopify, e a que falta não entraria mais.
  // O pedido espera inteiro, e as duas partes saem juntas.
  const comParteFaltando = new Set(pendencias.map((p) => normalizarNumero(p.pedido)).filter(Boolean));

  for (const [num, ls] of porNumero) {
    const l = ls[0];
    const alvo = naShopify.get(num);

    if (!alvo) { ls.forEach((x) => anotar(x, "nao-existe-na-loja")); continue; }
    if (registro[num]?.fulfillmentId || alvo.situacao === "FULFILLED") {
      pulados++; jaAtendidos.push(l.p.pedido); continue;
    }
    if (alvo.situacao && alvo.situacao !== "UNFULFILLED") { pulados++; continue; }
    if (!alvo.fulfillmentOrderId) { ls.forEach((x) => anotar(x, "sem-fulfillment-order")); continue; }
    if (comParteFaltando.has(num)) { ls.forEach((x) => anotar(x, "parte-pendente")); continue; }

    const vistos = new Set(), codigos = [];
    for (const x of ls) {
      const t = parseTracking(x.codigo.replace(/ · /g, " - "));
      for (const c of t.codes ?? []) {
        const k = typeof c === "string" ? c : c.code;
        if (!vistos.has(k)) { vistos.add(k); codigos.push(c); }
      }
    }
    const numeros = codigos.map((c) => (typeof c === "string" ? c : c.code));
    if (!numeros.length) { ls.forEach((x) => anotar(x, "rastreio-nao-reconhecido")); continue; }
    if (numeros.some((c) => PARECE_SIMULADO.test(c))) { ls.forEach((x) => anotar(x, "rastreio-simulado")); continue; }

    // a conferência que importa: o destinatário é o mesmo nos dois lados?
    // (em TODAS as linhas: cada conta comprou para alguém)
    const naLoja = normNome(alvo.nome);
    const divergentes = ls.filter((x) => naLoja && normNome(x.achado?.nome ?? x.p.nome) !== naLoja);
    if (divergentes.length) {
      for (const x of ls)
        if (divergentes.includes(x)) anotar(x, "nome-nao-confere", { shopee: x.achado?.nome ?? x.p.nome, shopify: alvo.nome });
        else anotar(x, "parte-pendente");
      continue;
    }

    planejado.push({ num, l, alvo, codigos, contas: [...new Set(ls.map((x) => x.conta))] });
  }

  if (!escrever)
    return { escritos: 0, falhas: 0, pulados, pendencias, planejado, gravados: [], jaAtendidos, resumo };

  let escritos = 0, falhas = 0;
  const gravados = [];   // só o que a Shopify aceitou de verdade
  const passo = () => aoProgresso({ fase: "escrevendo", feitos: escritos + falhas, total: planejado.length, escritos, falhas });
  passo();
  for (const { num, l, alvo, codigos, contas: deContas } of planejado) {
    try {
      const f = await enviar(montarEntrada({
        fulfillmentOrderId: alvo.fulfillmentOrderId,
        codigos,
        transportadora: transportadoraDe(codigos),
        notificar,
      }), { conexao });
      registro[num] = {
        fulfillmentId: f.id, pedido: alvo.pedido, conta: l.conta, contas: deContas,
        codigos: f.trackingInfo.map((x) => x.number), em: new Date().toISOString(),
      };
      gravarRegistro(registro);
      gravados.push(l.p.pedido);
      escritos++;
      // Sem o nome do cliente: o log vai para arquivo e para o diagnóstico
      // que o cliente manda. O número do pedido basta para achar.
      aoLog(`${alvo.pedido} · conta ${deContas.join(" + ")} · ${f.trackingInfo.map((x) => x.number).join(", ")}`);
    } catch (e) {
      falhas++;
      anotar(l, "falha-ao-escrever", { erro: e.message });
      aoLog(`${alvo.pedido}: ERRO ao escrever — ${e.message}`);
    }
    passo();
  }
  return { escritos, falhas, pulados, pendencias, planejado, gravados, jaAtendidos, resumo };
}
