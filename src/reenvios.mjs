// Reenvios — Chomps, 28/10/2026.
//
// O cliente quis trocar, o pedido original foi cancelado ou devolvido, e a
// loja manda de novo: mesmo número de pedido, outra compra na Shopee, quase
// sempre em OUTRA conta. O Matheus guarda esses na aba "REENVIOS +
// CANCELADOS", no mesmo formato da planilha do dia.
//
// Pela rota normal o robô colhia o rastreio novo e jogava fora: na Shopify o
// pedido já está atendido (com o rastreio do envio original), e a etapa 4
// conta isso como "já feito". Ele não quer escrita nenhuma — só o código,
// para colar na aba dele.
//
// Então o reenvio é só leitura: entra na fila da rodada (a conta é aberta uma
// vez só, junto com as do dia), e no fim é cruzado aqui, à parte. Não passa
// pela escrita, pela carteira, pelo mapeamento pedido→conta nem pelos
// motivos, e não chama a Shopify. Nada do que acontece aqui mexe no pedido
// original.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { normNome } from "./match.mjs";
import { normalizarNumero } from "./shopify.mjs";
import { diaLocal } from "./datas.mjs";
import { emTrabalho } from "./caminhos.mjs";

const ARQ = () => emTrabalho("reenvios.json");

/** Todo código que o robô já escreveu na Shopify, e em qual pedido. */
function codigosEscritos(registro) {
  const m = new Map();
  for (const [num, r] of Object.entries(registro ?? {}))
    for (const c of r?.codigos ?? []) m.set(String(c), num);
  return m;
}

/**
 * Cruza as linhas de reenvio com o que a rodada colheu.
 *
 * @param pendentes  linhas sem rastreio e com conta (lerPendentes().pendentes)
 * @param semConta   linhas sem conta reconhecível (lerPendentes().ignorados)
 * @param coletas    Map<conta, pedidos extraídos> (lerColetas)
 * @param registro   o que já foi escrito na Shopify (lerRegistro)
 * @returns [{ linha, pedido, nome, conta, data, estado, codigos, candidatos }]
 *   estado: achado | sem-rastreio-ainda | nao-achado | conta-nao-lida | duvida | falta-conta
 */
export function apurarReenvios({ pendentes = [], semConta = [], coletas = new Map(), registro = {} } = {}) {
  const escritos = codigosEscritos(registro);
  const hoje = diaLocal(new Date());

  const itens = pendentes.map((p) => {
    const base = { linha: p.linha, pedido: p.pedido, nome: p.nome, conta: p.conta,
                   data: p.data ?? null, codigos: [], candidatos: [] };
    const colhidos = coletas.get(Number(p.conta));
    if (!colhidos || colhidos.falhou) return { ...base, estado: "conta-nao-lida" };

    let iguais = colhidos.filter((c) => normNome(c.nome) === normNome(p.nome));
    // O rastreio do envio original nunca volta como se fosse o novo: compra
    // cujo código já foi escrito na Shopify (neste pedido ou em outro) é de
    // outra entrega.
    iguais = iguais.filter((c) => !(c.codigos ?? []).some((x) => escritos.has(String(x))));
    // O reenvio é comprado no dia da linha ou depois. Data sem ano vira o ano
    // corrente; se cair no futuro (dezembro lido em janeiro), não filtra.
    if (p.data && p.data <= hoje)
      iguais = iguais.filter((c) => !c.criadoEm || diaLocal(new Date(c.criadoEm * 1000)) >= p.data);

    if (!iguais.length) return { ...base, estado: "nao-achado" };
    if (iguais.length > 1) {
      const porValor = iguais.filter((c) => p.valor != null && Math.abs(c.valor - p.valor) < 0.01);
      if (porValor.length === 1) iguais = porValor;
    }
    if (iguais.length > 1)
      return { ...base, estado: "duvida",
               candidatos: iguais.map((c) => ({ orderId: c.orderId, valor: c.valor, codigos: c.codigos ?? [],
                                                criadoEm: c.criadoEm ?? null })) };
    const c = iguais[0];
    if (!(c.codigos ?? []).length) return { ...base, estado: "sem-rastreio-ainda", orderId: c.orderId };
    return { ...base, estado: "achado", orderId: c.orderId, codigos: c.codigos };
  });

  // A mesma compra não serve a dois reenvios: os dois viram dúvida, para a
  // pessoa escolher, em vez de o mesmo código ir colado em duas linhas.
  const porCompra = new Map();
  for (const i of itens) if (i.estado === "achado") porCompra.set(i.orderId, (porCompra.get(i.orderId) ?? 0) + 1);
  for (const i of itens)
    if (i.estado === "achado" && porCompra.get(i.orderId) > 1) {
      i.candidatos = [{ orderId: i.orderId, codigos: i.codigos }];
      i.estado = "duvida"; i.codigos = [];
    }

  for (const s of semConta)
    itens.push({ linha: s.linha, pedido: s.pedido, nome: s.nome, conta: null, data: s.data ?? null,
                 estado: "falta-conta", motivo: s.motivo, codigos: [], candidatos: [] });
  return itens.sort((a, b) => (a.linha ?? 0) - (b.linha ?? 0));
}

// ── o que já foi achado fica guardado ────────────────────────────────────
// A conta pode ser aberta de novo amanhã (por causa da planilha do dia) e a
// coleta nova substituir a de hoje; ou o app fecha antes de ele colar. O
// código achado não pode depender disso. Sai sozinho quando ele cola na aba:
// a linha deixa de ser pendente e não volta para cá.
const chave = (i) => `${normalizarNumero(i.pedido) ?? i.pedido}|${normNome(i.nome)}`;

export function lerGuardados() {
  try { return existsSync(ARQ()) ? JSON.parse(readFileSync(ARQ(), "utf8")) : {}; } catch { return {}; }
}

/** Guarda os achados de agora e completa, com os de antes, o que hoje não veio. */
export function guardarEcompletar(itens, { agora = new Date() } = {}) {
  const g = lerGuardados();
  for (const i of itens)
    if (i.estado === "achado")
      g[chave(i)] = { pedido: i.pedido, nome: i.nome, conta: i.conta, linha: i.linha,
                      codigos: i.codigos, em: agora.toISOString() };
  // mais de 60 dias: reenvio que ninguém colou até agora não vai ser colado
  for (const [k, v] of Object.entries(g))
    if (agora - new Date(v.em) > 60 * 86_400_000) delete g[k];
  mkdirSync(dirname(ARQ()), { recursive: true });
  writeFileSync(ARQ(), JSON.stringify(g, null, 2));

  return itens.map((i) => {
    if (i.estado === "achado" || i.estado === "falta-conta") return i;
    const antes = g[chave(i)];
    if (!antes || Number(antes.conta) !== Number(i.conta)) return i;
    return { ...i, estado: "achado", codigos: antes.codigos, deAntes: antes.em };
  });
}

/** "Copiar todos": pedido, cliente e código por linha, separados por tab. */
export function textoParaColar(itens) {
  return itens.filter((i) => i.estado === "achado")
    .map((i) => [i.pedido, i.nome, i.codigos.join(" - ")].join("\t")).join("\n");
}
