// A planilha que o cliente escolheu, guardada com o Esteira.
//
// Chomps, 26 e 27/10/2026: a planilha sumiu da pasta Downloads depois de
// escolhida ("File not found: C:\Users\...\Downloads\modelo-esteira_filtrado
// (2).xlsx"). No dia 26 a rodada coletou por horas e, no fim, não conseguiu
// cruzar nada ("escrita não realizada"). No dia 27, a montagem da rodada não
// achou o arquivo e caiu na varredura de TODOS os perfis do AdsPower: 500
// contas, nenhuma da planilha.
//
// Agora, no momento em que a planilha é escolhida, ela é copiada para a pasta
// de trabalho do Esteira, e todo o resto (rodada, conferência, escrita) lê a
// cópia. O original pode ser apagado, movido ou renomeado.
import { copyFileSync, mkdirSync, readdirSync, statSync, rmSync, existsSync, utimesSync } from "node:fs";
import { basename, join } from "node:path";
import { emTrabalho } from "./caminhos.mjs";

const DIR = () => emTrabalho("planilhas");
const VALE_DIAS = 30;

/** Copia a planilha escolhida e devolve o caminho da cópia. */
export function copiarPlanilha(original, { agora = Date.now() } = {}) {
  if (!existsSync(original)) throw new Error(`a planilha "${basename(original)}" não está mais em ${original.slice(0, -basename(original).length) || "."} — escolha de novo`);
  mkdirSync(DIR(), { recursive: true });
  const copia = join(DIR(), `${agora}-${basename(original)}`);
  copyFileSync(original, copia);
  // A cópia herda a data do original no Windows: uma planilha baixada há 40
  // dias seria apagada pela limpeza logo em seguida. Vale a data da cópia.
  const t = new Date(agora); utimesSync(copia, t, t);
  limparVelhas({ agora });
  return copia;
}

/** As cópias com mais de 30 dias saem (cada uma tem dezenas de KB, mas somam). */
export function limparVelhas({ agora = Date.now() } = {}) {
  let n = 0;
  try {
    for (const f of readdirSync(DIR())) {
      const arq = join(DIR(), f);
      if (agora - statSync(arq).mtimeMs > VALE_DIAS * 86_400_000) { rmSync(arq, { force: true }); n++; }
    }
  } catch {}
  return n;
}

/**
 * As duas travas antes de abrir o primeiro navegador. Devolve o motivo para
 * NÃO começar, ou null.
 *   - a planilha (a cópia) tem que estar acessível: em 26/10 a rodada coletou
 *     por horas e só no fim descobriu que o arquivo tinha sumido;
 *   - toda conta da rodada tem que ter vindo da planilha: em 27/10 foram 500
 *     contas do AdsPower, nenhuma da planilha. O "Tentar de novo só essas"
 *     manda um pedaço delas, e passa.
 */
export function travaDaRodada({ planilhas = [], contas = [], daPlanilha = new Set() }) {
  const sumidas = planilhas.filter((p) => !existsSync(p));
  if (sumidas.length)
    return `a planilha ${sumidas.map((p) => `"${basename(p).replace(/^\d{10,}-/, "")}"`).join(", ")} não está mais acessível — escolha de novo na etapa 1`;
  const fora = contas.map((c) => Number(c.conta)).filter((n) => !daPlanilha.has(n));
  if (fora.length)
    return `${fora.length} conta(s) da rodada não estão na planilha (${fora.slice(0, 8).join(", ")}${fora.length > 8 ? "…" : ""}) — a rodada não começou`;
  return null;
}

