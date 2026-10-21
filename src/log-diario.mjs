// O log do app em arquivo, um por dia, guardando 14 dias.
//
// Antes ele vivia só na memória (as últimas 2000 linhas) e sumia ao fechar o
// app. Depois de uma rodada ruim não havia como saber o que aconteceu — o
// Matheus não conseguiu dizer qual aviso tinha aparecido em 3 contas (21/10).
//
// Nada de senha ou chave passa pelo log, e o nome do cliente também não: o
// pedido aparece só pelo número (src/escrita.mjs).
import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { emTrabalho } from "./caminhos.mjs";
import { diaLocal } from "./datas.mjs";

const DIAS_GUARDADOS = 14;
const pasta = () => emTrabalho("logs");
let limpouEm = null;

function limparVelhos(hoje) {
  if (limpouEm === hoje) return;
  limpouEm = hoje;
  const limite = new Date(); limite.setDate(limite.getDate() - DIAS_GUARDADOS);
  const corte = diaLocal(limite);
  for (const f of readdirSync(pasta())) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.log$/);
    if (m && m[1] < corte) rmSync(join(pasta(), f), { force: true });
  }
}

/** Uma linha no log do dia. Nunca derruba quem chamou. */
export function gravarLinha(msg, em = new Date()) {
  try {
    mkdirSync(pasta(), { recursive: true });
    const hoje = diaLocal(em);
    limparVelhos(hoje);
    const hora = em.toTimeString().slice(0, 8);
    appendFileSync(join(pasta(), `${hoje}.log`), `${hora}  ${String(msg).replace(/\n/g, " ⏎ ")}\n`);
  } catch { /* disco cheio ou pasta sem permissão: o app segue */ }
}

/** As linhas dos últimos `dias` dias, do mais velho ao mais novo. */
export function lerLogs(dias = 3) {
  try {
    return readdirSync(pasta()).filter((f) => /^\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort().slice(-dias)
      .map((f) => `===== ${f.slice(0, 10)}\n${readFileSync(join(pasta(), f), "utf8")}`).join("\n");
  } catch { return ""; }
}
