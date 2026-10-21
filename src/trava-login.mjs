// Um login por vez — em TODA a rodada, não só dentro de um perfil.
//
// A trava antiga vivia no service worker da extensão, que é por perfil:
// impedia duas abas do mesmo navegador de logarem juntas, e foi isso que
// resolveu o episódio das 4 abas. Mas com paralelismo são vários perfis,
// cada um com o SEU service worker, e nenhum sabe do outro — dois perfis
// deslogados logavam ao mesmo tempo. Foi exatamente esse comportamento que
// fez a Shopee pedir verificação por imagem.
//
// O único lugar que enxerga a rodada inteira é o coletor, que roda no
// processo da fila. Então a arbitragem mora aqui.

// Dona que não concluiu perde a vez: sem isso, um perfil que travou no meio
// do login deixaria todos os outros esperando para sempre.
// 45s era menos que um login com código no e-mail (até 8s + 90s de espera):
// a vez era tomada no meio, e duas contas logavam juntas. A dona renova a
// vez antes de esperar o código.
const VALE_MS = Number(process.env.TRAVA_LOGIN_MS ?? 120_000);

let dono = null;      // número da conta que está logando
let desde = 0;
const espera = [];    // quem pediu e foi recusado, para o log

const expirou = (agora) => dono !== null && agora - desde > VALE_MS;

/**
 * @returns {{meu:boolean, dono:number|null, haMs:number}}
 *   meu=true  -> pode logar agora
 *   meu=false -> outra conta está logando; tente de novo
 */
export function pedirTrava(conta, agora = Date.now()) {
  const n = Number(conta);
  if (!Number.isFinite(n)) return { meu: false, dono, haMs: 0 };

  if (dono === null || expirou(agora) || dono === n) {
    const roubou = dono !== null && dono !== n;
    dono = n; desde = agora;
    if (roubou) espera.length = 0;
    return { meu: true, dono, haMs: 0, roubou };
  }
  if (!espera.includes(n)) espera.push(n);
  return { meu: false, dono, haMs: agora - desde };
}

/** Solta a vez. Só o dono solta — recusa tardia não derruba quem entrou. */
export function soltarTrava(conta) {
  const n = Number(conta);
  if (dono !== null && dono === n) {
    dono = null; desde = 0;
    const i = espera.indexOf(n); if (i >= 0) espera.splice(i, 1);
    return true;
  }
  return false;
}

export function donoAtual() { return dono; }
export function naEspera() { return [...espera]; }
export function limparTrava() { dono = null; desde = 0; espera.length = 0; }
