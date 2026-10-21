// Cliente da Local API do AdsPower.
// Base configurável para poder apontar para um mock em testes.

export const BASE = process.env.ADSPOWER_BASE ?? "http://local.adspower.net:50325";
export const KEY = process.env.ADSPOWER_API_KEY ?? "";

// A chave vai no header Authorization. Como query string (?api_key=) a
// API responde "Require api-key" — descoberto na marra.
async function chamar(caminho, params = {}, { base = BASE, chave = KEY } = {}) {
  const u = new URL(caminho, base);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);

  const res = await fetch(u, {
    headers: chave ? { Authorization: `Bearer ${chave}` } : {},
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`AdsPower HTTP ${res.status} em ${caminho}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(`AdsPower: ${json.msg} (code ${json.code})`);
  return json.data;
}

// Bloqueado no plano free do AdsPower ("This feature is only available in
// paid subscriptions"). No plano do cliente, com 700 perfis, funciona.
export const listarPerfis = (page = 1, pageSize = 100, cfg) =>
  chamar("/api/v1/user/list", { page, page_size: pageSize }, cfg);

export async function listarPerfisOuNull(page = 1, pageSize = 100) {
  try { return await listarPerfis(page, pageSize); }
  catch (e) { if (/paid subscription/i.test(e.message)) return null; throw e; }
}

// Aceita { userId } ou { serial }. No free só dá para endereçar por serial.
const alvo = (ref) =>
  typeof ref === "object" ? ref : { userId: ref };
const idParams = (ref) => {
  const a = alvo(ref);
  return a.serial != null ? { serial_number: a.serial } : { user_id: a.userId };
};

// O AdsPower baixa/instala o kernel do Chrome do perfil e, enquanto isso,
// recusa abrir. Observado em sequência numa máquina nova, com três mensagens
// diferentes para o mesmo evento:
//   "is not ready,please to download!"  →  "is updating, waiting for download."
//   →  "is being installed"             →  abre
// Tratar só parte delas faz a conta falhar no meio de um processo que ia
// terminar bem. Cada perfil pode pedir uma versão diferente de kernel.
const TRANSITORIO =
  /is updating|waiting for download|downloading|please wait|is not ready|being installed|installing/i;

// 60 tentativas × 15s dava 15 minutos de espera muda quando o kernel não
// estava em cache — tempo demais para descobrir que nada ia acontecer.
// Com kernel já baixado o perfil abre em segundos; o teto só existe para
// a primeira vez de cada versão.
export async function abrirPerfil(ref, {
  headless = 0,
  tentativas = Number(process.env.ADSPOWER_TENTATIVAS ?? 16),   // ~4 min
  espera = 15_000,
  aoEsperar,
  launchArgs = null,
} = {}) {
  for (let i = 1; ; i++) {
    try {
      // cdp_mask=1 mascara a detecção de automação. Explícito de propósito.
      const d = await chamar("/api/v1/browser/start", {
        // ip_tab: 1 = a aba do próprio AdsPower ("Shopee 139"), que diz qual
        // conta é esta janela. Com 0, ninguém achava a conta que pedia ajuda.
        ...idParams(ref), open_tabs: 0, ip_tab: 1, headless, cdp_mask: 1,
        ...(launchArgs ? { launch_args: JSON.stringify(launchArgs) } : {}),
      });
      return { ws: d.ws.puppeteer, debugPort: d.debug_port };
    } catch (e) {
      if (i >= tentativas || !TRANSITORIO.test(e.message)) throw e;
      aoEsperar?.(e.message, i, tentativas);
      await new Promise((r) => setTimeout(r, espera));
    }
  }
}

export const fecharPerfil = (ref) => chamar("/api/v1/browser/stop", idParams(ref));

export async function statusPerfil(ref) {
  const d = await chamar("/api/v1/browser/active", idParams(ref));
  return d.status; // "Active" | "Inactive"
}

// A Local API tem limite de requisições; 700 perfis caem na faixa de 15 req/s.
// Mantemos folga grande porque o gargalo real é abrir navegador, não a API.
export const PAUSA_ENTRE_CHAMADAS_MS = 200;

// ── Diagnóstico ───────────────────────────────────────────────────────────
// O cliente instala o app na máquina dele e precisa se virar sozinho. Os
// modos de falha têm SINTOMAS IGUAIS e consertos diferentes — AdsPower
// fechado e Local API desligada dão a mesma recusa de conexão. Sem separar
// um do outro, a tela diz "não conectou" e ele liga para você.
//
// Medido nesta máquina: a Local API responde IGUAL com chave boa, chave
// falsa e sem chave. Ou seja, não dá para validar a chave aqui — e o
// diagnóstico não mente dizendo que ela foi aceita. Em instalações que
// exigem a chave, a falha aparece como erro de autorização e é tratada.

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const LIMITE = /too many request/i;   // a Local API aceita ~1 req/s

/** Chama tolerando o limite de 1 req/s, que derrubaria o diagnóstico à toa. */
async function comPaciencia(fn, tentativas = 3) {
  for (let i = 0; i < tentativas; i++) {
    try { return await fn(); }
    catch (e) {
      if (!LIMITE.test(e.message) || i === tentativas - 1) throw e;
      await espera(1200);
    }
  }
}

/** @returns {{ok, etapa, titulo, comoResolver, verificado?, detalhe?}} */
export async function diagnosticar({ base = BASE, chave = KEY } = {}) {
  // 1. O AdsPower está no ar? /status responde sem chave nenhuma.
  let status;
  try {
    const r = await fetch(new URL("/status", base), { signal: AbortSignal.timeout(8000) });
    status = await r.json().catch(() => ({}));
  } catch (e) {
    return {
      ok: false, etapa: "programa",
      titulo: "O AdsPower não está respondendo nesta máquina",
      comoResolver: [
        "Abra o AdsPower e deixe aberto — a conexão só existe com ele rodando.",
        "No AdsPower, vá em Configurações → API local e ligue a opção.",
        `Confira a porta: estamos tentando ${new URL(base).port || "80"}.`,
      ],
      detalhe: e.message,
    };
  }
  if (status?.code !== 0)
    return {
      ok: false, etapa: "programa",
      titulo: "O AdsPower respondeu, mas recusou",
      comoResolver: ["Reabra o AdsPower e tente de novo."],
      detalhe: status?.msg ?? JSON.stringify(status),
    };

  await espera(1100);   // respeita o limite antes da segunda chamada

  // 2. Dá para enxergar os perfis?
  let perfis;
  try {
    perfis = await comPaciencia(() => listarPerfis(1, 1, { base, chave }));
  } catch (e) {
    if (/paid subscription/i.test(e.message))
      return {
        ok: false, etapa: "plano",
        titulo: "O plano do AdsPower não libera listar perfis",
        comoResolver: [
          "A listagem de perfis é recurso de plano pago no AdsPower.",
          "Com o plano atual dá para abrir perfil pelo número (serial), mas não descobrir quais existem.",
        ],
        detalhe: e.message,
      };
    if (/api.?key|unauthor|token|require/i.test(e.message))
      return {
        ok: false, etapa: "chave",
        titulo: "A chave da API não foi aceita",
        comoResolver: [
          "No AdsPower: Configurações → API local → copiar a chave (API Key).",
          "A chave muda se alguém clicar em gerar outra.",
        ],
        detalhe: e.message,
      };
    if (LIMITE.test(e.message))
      return {
        ok: false, etapa: "ritmo",
        titulo: "O AdsPower pediu para ir mais devagar",
        comoResolver: ["Espere alguns segundos e teste de novo."],
        detalhe: e.message,
      };
    return {
      ok: false, etapa: "desconhecido",
      titulo: "O AdsPower respondeu uma coisa que não esperávamos",
      comoResolver: ["Mande este detalhe para o suporte do robô."],
      detalhe: e.message,
    };
  }

  // A Local API NÃO devolve o total numa página — só `list`, `page` e
  // `page_size`. Contar aqui seria inventar: o número real sai da varredura
  // completa, que a tela de Contas já faz.
  const veioAlgum = (perfis?.list ?? []).length > 0;
  return {
    ok: true, etapa: "pronto",
    titulo: "Conectado ao AdsPower",
    comoResolver: veioAlgum ? [] : ["Nenhum perfil apareceu — confira se a conta do AdsPower é a certa."],
    // o que foi PROVADO, não o que se supõe
    verificado: ["o AdsPower está aberto", "a API local está ligada"]
      .concat(veioAlgum ? ["a lista de perfis respondeu"] : []),
  };
}

/**
 * A Local API está aberta sem autenticação nesta máquina?
 *
 * Não é defeito nosso e não impede nada — ela só escuta em localhost. Mas
 * significa que qualquer programa rodando ali pode abrir e dirigir os
 * navegadores com as contas. É informação que o dono da máquina merece ter.
 */
export async function apiAbertaSemChave({ base = BASE } = {}) {
  try {
    const r = await fetch(new URL("/api/v1/user/list?page=1&page_size=1", base),
                          { signal: AbortSignal.timeout(8000) });
    const j = await r.json().catch(() => ({}));
    return j?.code === 0;
  } catch { return false; }
}
