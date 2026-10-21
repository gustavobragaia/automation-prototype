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
// Diferença entre o relógio DESTE computador e o do servidor da caixa
// (cabeçalho Date de cada resposta). Positivo = este computador adiantado.
let desvioMs = 0;
export const desvioDoRelogio = () => desvioMs;

function conferirResposta(r) {
  const data = Date.parse(r.headers?.get?.("date") ?? "");
  if (Number.isFinite(data)) desvioMs = Date.now() - data;
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
 * Espera um e-mail NOVO da Shopee chegar na caixa e extrai dele o que se
 * quer (código ou link).
 *
 * "Novo" é decidido por uma FOTO da caixa tirada antes de a Shopee mandar
 * (`antes`: os uid que já estavam lá), e não pelo relógio. O filtro antigo
 * aceitava só mensagem com horário depois do pedido — e o horário do pedido
 * vinha do relógio do computador do cliente: um Windows alguns segundos
 * adiantado e o e-mail que chegou parecia velho. Foi o que o Matheus viu em
 * 21/10: o e-mail na caixa, e o app dizendo que não chegou. Sem foto, vale o
 * horário com 5 min de folga.
 *
 * Ritmo: a cada 10 s no primeiro minuto, depois a cada 20 s, até `limite` —
 * mais tempo de espera com o mesmo número de consultas.
 */
export async function esperarMensagem(endereco, {
  antes = null, desdeEpoch = 0, extrair, oQue = "o que procuro", limite = 180_000,
  remetente = "shopee", esperaInicial = 10_000, ritmo = (ms) => (ms < 60_000 ? 10_000 : 20_000),
  pausa = dormir,
} = {}) {
  await pausa(esperaInicial);
  const t0 = Date.now();
  let tentativas = 0, vistas = [];
  const nova = (m) => antes ? !antes.has(String(m.uid))
                            : Number(m.created_at_epoch) > desdeEpoch - 300;
  for (;;) {
    tentativas++;
    const msgs = await listarMensagens(endereco);
    vistas = Array.isArray(msgs) ? msgs : [];
    const candidata = vistas
      .filter((m) => String(m.from ?? "").toLowerCase().includes(remetente))
      .filter(nova)
      .sort((a, b) => Number(b.created_at_epoch) - Number(a.created_at_epoch))[0];
    if (candidata) {
      const corpo = await lerMensagem(candidata.uid);
      const texto = corpo?.html ?? corpo?.text ?? corpo?.body ?? JSON.stringify(corpo);
      const achado = extrair(texto);
      if (achado) return { achado, tentativas, uid: candidata.uid, assunto: candidata.subject ?? "" };
      throw Object.assign(new Error(`o e-mail "${candidata.subject ?? ""}" chegou mas não achei ${oQue}`),
        { html: String(texto).slice(0, 20000) });
    }
    const passou = Date.now() - t0;
    if (passou >= limite) break;
    await pausa(Math.min(ritmo(passou), Math.max(1000, limite - passou)));
  }
  // Não chegou: diz o que havia na caixa e se o relógio daqui está torto.
  const desvio = Math.round(desvioMs / 1000);
  const relogio = Math.abs(desvio) >= 30
    ? ` O relógio deste computador está ${Math.abs(desvio)} s ${desvio > 0 ? "adiantado" : "atrasado"} — acerte a hora do Windows.` : "";
  const daShopee = vistas.filter((m) => String(m.from ?? "").toLowerCase().includes(remetente)).length;
  throw Object.assign(new Error(`o e-mail com ${oQue} não chegou em ${Math.round(limite / 1000)} s ` +
    `(a caixa tem ${vistas.length} mensagem(ns), ${daShopee} da Shopee, nenhuma nova).${relogio}`), { naoChegou: true });
}

/** Os uid que já estão na caixa: a foto de antes de a Shopee mandar. */
export async function fotoDaCaixa(endereco) {
  await ativarCaixa(endereco);
  const msgs = await listarMensagens(endereco);
  return new Set((Array.isArray(msgs) ? msgs : []).map((m) => String(m.uid)));
}

/** Código de 6 dígitos do login. */
export async function obterCodigo(endereco, inicioEpoch, { antes = null, ...resto } = {}) {
  if (!antes) await ativarCaixa(endereco);
  const r = await esperarMensagem(endereco, { antes, desdeEpoch: inicioEpoch, extrair: extrairCodigo,
    oQue: "o código de 6 dígitos", limite: 120_000, ...resto });
  return { codigo: r.achado, tentativas: r.tentativas, uid: r.uid };
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
  const limpa = (t) => String(t).replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();
  const ancoras = [...String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ url: m[1].replace(/&amp;/g, "&"), texto: limpa(m[2]),
                   antes: limpa(String(html).slice(Math.max(0, m.index - 300), m.index)).slice(-80) }))
    .filter((a) => /^https:\/\//i.test(a.url));
  // 1) O e-mail real da Shopee (21/10/2026, "Verificação necessária: nova
  //    tentativa de login"): "Se é você, por favor clique AQUI para confirmar".
  //    Os links vêm embrulhados pelo rastreador do SendGrid
  //    (u…ct.sendgrid.net/ls/click), sem "shopee" no endereço — por isso o
  //    filtro antigo, que exigia shopee.com.br, não achava nada.
  const confirma = ancoras.find((a) => /^(aqui|clique aqui|confirmar|sim,? sou eu|verificar)$/i.test(a.texto) &&
    /(se [eé] voc[eê]|confirm|verific)[^.]*clique$|clique$/i.test(a.antes) && /se [eé] voc[eê]|confirm|verific/i.test(a.antes));
  if (confirma) return confirma.url;
  // 2) Link direto da Shopee que fala em verificar.
  const direto = ancoras.find((a) => /^https:\/\/([a-z0-9-]+\.)*shopee\.com\.br\//i.test(a.url) &&
    /(verify|verif|ivs|authenticat|confirm|token)/i.test(a.url) && !/help\.|unsubscribe|privac/i.test(a.url));
  return direto?.url ?? null;
}

/** Link de "Verificar Identidade". */
export async function obterLink(endereco, inicioEpoch, { antes = null, ...resto } = {}) {
  if (!antes) await ativarCaixa(endereco);
  const r = await esperarMensagem(endereco, { antes, desdeEpoch: inicioEpoch, extrair: extrairLink,
    oQue: "o link de verificação", limite: 180_000, ...resto });
  return { link: r.achado, tentativas: r.tentativas, uid: r.uid, assunto: r.assunto };
}

