// O dia de hoje, do jeito que a pessoa conta.
//
// `new Date().toISOString().slice(0, 10)` dá o dia em UTC. No Brasil, das
// 21h à meia-noite, isso já é amanhã. O erro apareceu três vezes neste
// projeto — histórico com a data trocada, "deixar para amanhã" voltando às
// 21h de hoje, filtro de dias andando sozinho — sempre por uma cópia nova da
// mesma linha. Por isso existe um lugar só para isto.
export function diaLocal(quando = new Date()) {
  const d = quando instanceof Date ? quando : new Date(quando);
  if (isNaN(d)) return null;
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
         "-" + String(d.getDate()).padStart(2, "0");
}
