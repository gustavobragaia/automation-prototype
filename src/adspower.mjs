// Cliente da Local API do AdsPower.
// Base configurável para poder apontar para um mock em testes.

const BASE = process.env.ADSPOWER_BASE ?? "http://local.adspower.net:50325";
const KEY = process.env.ADSPOWER_API_KEY ?? "";

async function chamar(caminho, params = {}) {
  const u = new URL(caminho, BASE);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  if (KEY) u.searchParams.set("api_key", KEY);

  const res = await fetch(u, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`AdsPower HTTP ${res.status} em ${caminho}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(`AdsPower: ${json.msg} (code ${json.code})`);
  return json.data;
}

export const listarPerfis = (page = 1, pageSize = 100) =>
  chamar("/api/v1/user/list", { page, page_size: pageSize });

export async function abrirPerfil(userId, { headless = 0 } = {}) {
  // cdp_mask=1 é o padrão e mascara a detecção de automação. Explícito de propósito.
  const d = await chamar("/api/v1/browser/start", {
    user_id: userId, open_tabs: 0, ip_tab: 0, headless, cdp_mask: 1,
  });
  return { ws: d.ws.puppeteer, debugPort: d.debug_port };
}

export const fecharPerfil = (userId) => chamar("/api/v1/browser/stop", { user_id: userId });

export async function statusPerfil(userId) {
  const d = await chamar("/api/v1/browser/active", { user_id: userId });
  return d.status; // "Active" | "Inactive"
}

// A Local API tem limite de requisições; 700 perfis caem na faixa de 15 req/s.
// Mantemos folga grande porque o gargalo real é abrir navegador, não a API.
export const PAUSA_ENTRE_CHAMADAS_MS = 200;
