// Cliente da Local API do AdsPower.
// Base configurável para poder apontar para um mock em testes.

const BASE = process.env.ADSPOWER_BASE ?? "http://local.adspower.net:50325";
const KEY = process.env.ADSPOWER_API_KEY ?? "";

// A chave vai no header Authorization. Como query string (?api_key=) a
// API responde "Require api-key" — descoberto na marra.
async function chamar(caminho, params = {}) {
  const u = new URL(caminho, BASE);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);

  const res = await fetch(u, {
    headers: KEY ? { Authorization: `Bearer ${KEY}` } : {},
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`AdsPower HTTP ${res.status} em ${caminho}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(`AdsPower: ${json.msg} (code ${json.code})`);
  return json.data;
}

// Bloqueado no plano free do AdsPower ("This feature is only available in
// paid subscriptions"). No plano do cliente, com 700 perfis, funciona.
export const listarPerfis = (page = 1, pageSize = 100) =>
  chamar("/api/v1/user/list", { page, page_size: pageSize });

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

export async function abrirPerfil(ref, { headless = 0 } = {}) {
  // cdp_mask=1 é o padrão e mascara a detecção de automação. Explícito de propósito.
  const d = await chamar("/api/v1/browser/start", {
    ...idParams(ref), open_tabs: 0, ip_tab: 0, headless, cdp_mask: 1,
  });
  return { ws: d.ws.puppeteer, debugPort: d.debug_port };
}

export const fecharPerfil = (ref) => chamar("/api/v1/browser/stop", idParams(ref));

export async function statusPerfil(ref) {
  const d = await chamar("/api/v1/browser/active", idParams(ref));
  return d.status; // "Active" | "Inactive"
}

// A Local API tem limite de requisições; 700 perfis caem na faixa de 15 req/s.
// Mantemos folga grande porque o gargalo real é abrir navegador, não a API.
export const PAUSA_ENTRE_CHAMADAS_MS = 200;
