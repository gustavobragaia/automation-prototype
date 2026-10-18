// As contas que o robô já visitou, e como cada uma estava da última vez.
//
// A aba Contas era inteira inventada: oito contas com perfis, horários e
// contagens de mentira — e com o e-mail montado com o padrão da Chomps
// escrito à mão na tela, o mesmo que já tinha saído do robô.
//
// Tudo aqui sai do disco, do que a última rodada deixou:
//   · a coleta de cada conta -> quando foi, quantos pedidos vieram
//   · a marca de login        -> se o robô precisou entrar com senha
//   · o perfil de cada conta  -> do mapa que a última rodada resolveu
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DIR_COLETAS, loginDaConta } from "./caminhos.mjs";

// A marca de login é gravada durante a mesma visita que gera a coleta. Uma
// marca de dias atrás não diz nada sobre hoje — era o defeito de "o robô
// logou" para sempre depois de uma única vez.
const MESMA_VISITA_MS = 10 * 60 * 1000;

/**
 * @param {object} [o]
 * @param {Map<number,{serial?:any,userId?:string}>} [o.perfis] da última rodada
 * @param {(n:number)=>string} [o.email] como montar o e-mail; se estourar, "—"
 */
export function contasVistas({ dir = DIR_COLETAS, perfis = new Map(), email } = {}) {
  if (!existsSync(dir)) return [];
  const contas = [];
  for (const f of readdirSync(dir)) {
    const m = /^conta-(\d+)\.json$/.exec(f);
    if (!m) continue;
    const n = Number(m[1]);
    const arq = join(dir, f);
    const quando = statSync(arq).mtimeMs;

    let lidos = null;
    try { lidos = (JSON.parse(readFileSync(arq, "utf8")).pedidos ?? []).length; } catch {}

    const marca = loginDaConta(n);
    const logou = existsSync(marca) &&
      Math.abs(statSync(marca).mtimeMs - quando) <= MESMA_VISITA_MS;

    let mail = null;
    // Sem padrão configurado o robô não sabe o e-mail — e diz isso, em vez
    // de mostrar o da Chomps.
    try { mail = email ? email(n) : null; } catch { mail = null; }

    const p = perfis.get(n);
    contas.push({
      n, email: mail,
      perfil: p ? String(p.serial ?? p.userId ?? "") || null : null,
      quando: new Date(quando).toISOString(),
      // "viva" é o que se viu NA ÚLTIMA visita. Prever que a próxima vai
      // precisar de senha seria adivinhação.
      sessao: logou ? "logou" : "viva",
      lidos,
    });
  }
  return contas.sort((a, b) => a.n - b.n);
}
