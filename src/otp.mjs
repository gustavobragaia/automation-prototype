// Leitura do código de verificação da Shopee na caixa descartável.
// API: inboxes.com via RapidAPI.
//
// A regra que evita o bug clássico desta integração: só aceita mensagem
// com created_at_epoch MAIOR que o instante em que o login começou.
// Sem isso o robô lê um código antigo, já expirado, de forma intermitente.

const HOST = "inboxes-com.p.rapidapi.com";
const KEY = () => process.env.RAPIDAPI_KEY ?? "";

const headers = () => ({ "x-rapidapi-host": HOST, "x-rapidapi-key": KEY(), accept: "application/json" });

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export async function ativarCaixa(endereco) {
  const r = await fetch(`https://${HOST}/inboxes/${encodeURIComponent(endereco)}`, {
    method: "POST", headers: headers(), signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`ativarCaixa HTTP ${r.status}`);
  return r.json();
}

export async function listarMensagens(endereco) {
  const r = await fetch(`https://${HOST}/inboxes/${encodeURIComponent(endereco)}`, {
    headers: headers(), signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`listarMensagens HTTP ${r.status}`);
  return r.json();
}

export async function lerMensagem(uid) {
  const r = await fetch(`https://${HOST}/messages/${encodeURIComponent(uid)}`, {
    headers: headers(), signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`lerMensagem HTTP ${r.status}`);
  return r.json();
}

export function extrairCodigo(texto) {
  if (!texto) return null;
  // tira tags e entidades antes de procurar, senão pega número de CSS/ID
  const limpo = String(texto).replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ");
  const m = limpo.match(/(?<!\d)(\d{6})(?!\d)/);
  return m ? m[1] : null;
}

/**
 * Ciclo completo. `inicioEpoch` deve ser capturado ANTES de pedir o código na tela.
 */
export async function obterCodigo(endereco, inicioEpoch, {
  esperaInicial = 8000, intervalo = 3000, limite = 90_000, remetente = "shopee",
} = {}) {
  await ativarCaixa(endereco);
  await dormir(esperaInicial);

  const prazo = Date.now() + limite;
  let tentativas = 0;

  while (Date.now() < prazo) {
    tentativas++;
    const msgs = await listarMensagens(endereco);
    const nova = (Array.isArray(msgs) ? msgs : [])
      .filter((m) => Number(m.created_at_epoch) > inicioEpoch)
      .filter((m) => String(m.from ?? "").toLowerCase().includes(remetente))
      .sort((a, b) => Number(b.created_at_epoch) - Number(a.created_at_epoch))[0];

    if (nova) {
      const corpo = await lerMensagem(nova.uid);
      const codigo = extrairCodigo(corpo?.html ?? corpo?.text ?? corpo?.body ?? JSON.stringify(corpo));
      if (codigo) return { codigo, tentativas, uid: nova.uid, chamadas: tentativas + 2 };
      throw new Error(`mensagem ${nova.uid} chegou mas não tem código de 6 dígitos`);
    }
    await dormir(intervalo);
  }
  throw new Error(`código não chegou em ${limite / 1000}s para ${endereco}`);
}
