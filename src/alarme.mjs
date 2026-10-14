// Alarme. Existe por causa de um modo de falha real: o coletor morreu e a
// rodada reportou "nenhum pedido novo", que parece sucesso. Rodando
// sozinho 3x por dia, isso passa despercebido por semanas.

import { execFile } from "node:child_process";
import { platform } from "node:os";

function notificarDesktop(titulo, texto) {
  const limpo = (s) => String(s).replace(/["'\\]/g, " ").slice(0, 200);
  if (platform() === "darwin")
    execFile("osascript", ["-e", `display notification "${limpo(texto)}" with title "${limpo(titulo)}"`], () => {});
  else if (platform() === "win32")
    execFile("powershell", ["-NoProfile", "-Command",
      `[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');` +
      `[System.Windows.Forms.MessageBox]::Show('${limpo(texto)}','${limpo(titulo)}')`], () => {});
}

async function notificarWebhook(titulo, texto) {
  const url = process.env.WEBHOOK_ALERTA;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `*${titulo}*\n${texto}` }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {}
}

export async function alarmar(titulo, texto) {
  console.log(`\n\x1b[41m\x1b[97m  ALARME  \x1b[0m \x1b[1m${titulo}\x1b[0m`);
  for (const l of String(texto).split("\n")) console.log(`           ${l}`);
  notificarDesktop(titulo, texto);
  await notificarWebhook(titulo, texto);
}

/**
 * Decide se a rodada merece alarme. Zero coleta em todas as contas quase
 * sempre significa infraestrutura quebrada, não ausência de pedidos.
 */
export function avaliarRodada({ contas, coletadas, pedidosVistos, falhas }) {
  const motivos = [];
  if (contas > 0 && coletadas === 0)
    motivos.push(`nenhuma das ${contas} contas respondeu — extensão não injetada ou Shopee bloqueando`);
  else if (contas >= 3 && falhas.length / contas > 0.3)
    motivos.push(`${falhas.length} de ${contas} contas falharam (${Math.round((falhas.length / contas) * 100)}%)`);
  if (coletadas > 0 && pedidosVistos === 0)
    motivos.push("contas responderam mas nenhum pedido foi lido — formato da Shopee pode ter mudado");
  return motivos;
}
