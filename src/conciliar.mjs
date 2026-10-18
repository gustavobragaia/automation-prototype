// Conciliação: planilha do dia × o que foi colhido na Shopee.
//
// Uma implementação só, usada pelo relatório (conferir) e pela escrita na
// Shopify (agir). Se as duas divergirem, o relatório deixa de provar o que
// vai ser escrito — foi por isso que isso saiu de dentro do relatório.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { extrairPedido } from "./shopee.mjs";
import { normNome } from "./match.mjs";

/** Lê captura/coletas/*.json e devolve Map<conta, pedidos extraídos>. */
export function lerColetas(dir = "captura/coletas") {
  const coletas = new Map();
  if (!existsSync(dir)) return coletas;

  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const d = JSON.parse(readFileSync(join(dir, f), "utf8"));
    const conta = Number(d.conta);
    if (!Number.isFinite(conta)) continue;
    coletas.set(
      conta,
      (d.pedidos ?? []).filter((p) => p.bruto).map((p) => extrairPedido(p.bruto, { orderId: p.orderId })),
    );
  }
  return coletas;
}

/**
 * Para um pedido da planilha, acha o pedido correspondente na conta Shopee.
 *
 * Nunca devolve um palpite: se o nome empata e o valor não desempata, o
 * estado é "ambiguo" e ninguém escreve nada.
 *
 * @returns { estado, achado, codigo, candidatos }
 *   estado: ok | ok-valor | ambiguo | sem-codigo | nao-achado
 */
export function conciliarPedido(pedido, colhidos) {
  const iguais = colhidos.filter((c) => normNome(c.nome) === normNome(pedido.nome));

  if (iguais.length === 0)
    return { estado: "nao-achado", achado: null, codigo: "", candidatos: 0 };

  if (iguais.length === 1) {
    const achado = iguais[0];
    return achado.codigos.length
      ? { estado: "ok", achado, codigo: achado.codigos.join(" · "), candidatos: 1 }
      : { estado: "sem-codigo", achado, codigo: "", candidatos: 1 };
  }

  // nome repetido na mesma conta -> desempata por valor
  const porValor = iguais.filter((c) => pedido.valor != null && Math.abs(c.valor - pedido.valor) < 0.01);
  if (porValor.length === 1 && porValor[0].codigos.length)
    return { estado: "ok-valor", achado: porValor[0], codigo: porValor[0].codigos.join(" · "), candidatos: iguais.length };

  return { estado: "ambiguo", achado: null, codigo: "", candidatos: iguais.length };
}

const RESOLVIDO = new Set(["ok", "ok-valor"]);
export const resolvido = (estado) => RESOLVIDO.has(estado);

/**
 * Concilia a planilha inteira contra as coletas.
 * @param contas saída de lerPendentes().contas
 * @returns { linhas, resumo }
 */
export function conciliar(contas, coletas) {
  const porConta = new Map(contas.map((c) => [c.conta, c.pedidos]));
  const linhas = [];

  for (const [conta, colhidos] of [...coletas].sort((a, b) => a[0] - b[0]))
    for (const p of porConta.get(conta) ?? [])
      linhas.push({ conta, p, ...conciliarPedido(p, colhidos) });

  const resumo = { total: linhas.length, casados: 0, ambiguos: 0, semCodigo: 0, naoAchados: 0 };
  for (const l of linhas) {
    if (resolvido(l.estado)) resumo.casados++;
    else if (l.estado === "ambiguo") resumo.ambiguos++;
    else if (l.estado === "sem-codigo") resumo.semCodigo++;
    else resumo.naoAchados++;
  }
  return { linhas, resumo };
}
