// Leitura do código de verificação da Shopee na caixa descartável.
// API: inboxes.com via RapidAPI.
//
// A regra que evita o bug clássico desta integração: só aceita mensagem
// com created_at_epoch MAIOR que o instante em que o login começou.
// Sem isso o robô lê um código antigo, já expirado, de forma intermitente.

import { alertar, resolver } from "./alertas.mjs";

const HOST = "inboxes-com.p.rapidapi.com";
const KEY = () => process.env.RAPIDAPI_KEY ?? "";

const headers = () => ({ "x-rapidapi-host": HOST, "x-rapidapi-key": KEY(), accept: "application/json" });

// Sem a chave, as chamadas voltam 401 e o cliente lê "HTTP 401" — que não
// diz nada e não aponta para onde resolver. Falhar antes, com o caminho.
function exigirChave() {
  if (!KEY())
    throw new Error("a chave para ler o código de verificação não está preenchida — " +
                    "Ajustes → Contas da Shopee");
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Toda resposta da RapidAPI passa por aqui. A cota é MENSAL e pequena no
// plano grátis (100 consultas): em 21/10 ela acabou no meio de uma rodada, e
// todo login que pedia código ou link por e-mail falhou com "HTTP 429",
// enterrado no log. Agora vira alerta no app, com o que fazer.
function conferirResposta(r) {
  const resta = Number(r.headers?.get?.("x-ratelimit-requests-remaining"));
  const limite = Number(r.headers?.get?.("x-ratelimit-requests-limit"));
  if (r.status === 429) {
    alertar({ id: "rapidapi-cota", nivel: "erro",
      titulo: "A caixa de e-mail parou: a cota da RapidAPI acabou",
      texto: `A RapidAPI (inboxes.com) recusou a consulta: as ${Number.isFinite(limite) ? limite : ""} consultas do mês acabaram. ` +
        "Sem ela o robô não lê o código nem o link que a Shopee manda por e-mail, e toda conta que precisar entrar de novo vai parar em \"precisa de você\".",
      acao: "Troque a chave em Ajustes → Contas da Shopee → 3, ou suba o plano na RapidAPI.", ir: "ajustes" });
    throw Object.assign(new Error("a cota da RapidAPI acabou (HTTP 429) — troque a chave em Ajustes"), { cota: true });
  }
  if (r.status === 401 || r.status === 403) {
    alertar({ id: "rapidapi-chave", nivel: "erro",
      titulo: "A chave da RapidAPI foi recusada",
      texto: "A caixa de e-mail não aceitou a chave salva. Sem ela o robô não lê o código que a Shopee manda por e-mail.",
      acao: "Confira a chave em Ajustes → Contas da Shopee → 3 (a chave da RapidAPI, não a do AdsPower).", ir: "ajustes" });
    throw new Error(`a RapidAPI recusou a chave (HTTP ${r.status}) — confira em Ajustes`);
  }
  if (r.ok) {
    resolver("rapidapi-cota"); resolver("rapidapi-chave");
    if (Number.isFinite(resta) && resta <= 15)
      alertar({ id: "rapidapi-pouca", nivel: "atencao",
        titulo: `A caixa de e-mail está quase sem cota: restam ${resta} consultas`,
        texto: `O plano da RapidAPI dá ${Number.isFinite(limite) ? limite : "poucas"} consultas por mês, e cada login que pede código gasta de 6 a 10.`,
        acao: "Suba o plano na RapidAPI, ou use outra chave em Ajustes.", ir: "ajustes" });
    else if (Number.isFinite(resta)) resolver("rapidapi-pouca");
  }
}

export async function ativarCaixa(endereco) {
  exigirChave();
  const r = await fetch(`https://${HOST}/inboxes/${encodeURIComponent(endereco)}`, {
    method: "POST", headers: headers(), signal: AbortSignal.timeout(15_000),
  });
  conferirResposta(r);
  if (!r.ok) throw new Error(`ativarCaixa HTTP ${r.status}`);
  return r.json();
}

export async function listarMensagens(endereco) {
  exigirChave();
  const r = await fetch(`https://${HOST}/inboxes/${encodeURIComponent(endereco)}`, {
    headers: headers(), signal: AbortSignal.timeout(15_000),
  });
  conferirResposta(r);
  if (!r.ok) throw new Error(`listarMensagens HTTP ${r.status}`);
  return r.json();
}

export async function lerMensagem(uid) {
  const r = await fetch(`https://${HOST}/messages/${encodeURIComponent(uid)}`, {
    headers: headers(), signal: AbortSignal.timeout(15_000),
  });
  conferirResposta(r);
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
  // A cada 10 s: com 3 s, um login gastava até 30 consultas de uma cota
  // mensal de 100. O código chega em 10–40 s; 10 s a mais de espera não pesa.
  esperaInicial = 10_000, intervalo = 10_000, limite = 90_000, remetente = "shopee",
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

/**
 * O link de "Verificar Identidade" que a Shopee manda por e-mail.
 *
 * Depois da senha, a Shopee às vezes não pede código: abre /verify/ivs com um
 * botão "Verificar via link por E-mail". O link chega na mesma caixa do
 * código. De todos os links da mensagem, fica o da Shopee que não é rodapé
 * (ajuda, descadastro, redes sociais), preferindo os que falam em verificar.
 */
export function extrairLink(html) {
  if (!html) return null;
  const links = [...String(html).matchAll(/href\s*=\s*["']([^"']+)["']/gi)]
    .map((m) => m[1].replace(/&amp;/g, "&"))
    .filter((u) => /^https:\/\/([a-z0-9-]+\.)*shopee\.com\.br\//i.test(u))
    .filter((u) => !/(help|unsubscribe|descadastr|privacy|privacidade|facebook|instagram|twitter|youtube|app-download|\/m\/|\.png|\.jpg)/i.test(u));
  const verifica = links.find((u) => /(verify|verif|ivs|authenticat|confirm|token|link)/i.test(u));
  return verifica ?? null;
}

export async function obterLink(endereco, inicioEpoch, {
  esperaInicial = 10_000, intervalo = 10_000, limite = 120_000, remetente = "shopee",
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
      const html = corpo?.html ?? corpo?.text ?? corpo?.body ?? JSON.stringify(corpo);
      const link = extrairLink(html);
      if (link) return { link, tentativas, uid: nova.uid, assunto: nova.subject ?? "" };
      // Guarda a mensagem para a próxima investigação: a forma do e-mail
      // ainda não foi vista ao vivo.
      throw Object.assign(new Error(`o e-mail "${nova.subject ?? ""}" chegou mas não achei o link de verificação`),
        { html: String(html).slice(0, 20000) });
    }
    await dormir(intervalo);
  }
  throw new Error(`o e-mail de verificação não chegou em ${limite / 1000}s para ${endereco}`);
}
