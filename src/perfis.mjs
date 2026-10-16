// Lista os perfis do AdsPower e liga o número da conta ao user_id.
//
// A planilha diz "shopee 225"; a Local API só abre perfil por user_id ou
// serial. Sem esta ponte a fila chamaria browser/start com user_id=undefined.

import { listarPerfis } from "./adspower.mjs";
import { parseConta } from "./tracking.mjs";

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

let cache = null;

/** @returns Map<numeroDaConta, {userId, serial, nome, proxy}> */
export async function mapaDeContas({ forcar = false, aoLog = () => {} } = {}) {
  if (cache && !forcar) return cache;

  const mapa = new Map();
  const repetidos = [];
  let pagina = 1;

  while (pagina <= 30) {
    const d = await listarPerfis(pagina, 100);
    const lista = d?.list ?? [];
    if (lista.length === 0) break;

    for (const p of lista) {
      const c = parseConta(p.name);
      if (c.numeros.length !== 1) continue;
      const n = c.numeros[0];
      if (mapa.has(n)) { repetidos.push(n); continue; }   // primeiro vence
      mapa.set(n, {
        userId: p.user_id,
        serial: Number(p.serial_number),
        nome: p.name,
        proxy: p.user_proxy_config?.proxy_soft === "no_proxy" ? null : p.user_proxy_config?.proxy_type ?? null,
      });
    }
    pagina++;
    await dormir(1200);   // user/list é limitado a 1 req/s em alguns planos
  }

  aoLog(`${mapa.size} perfis mapeados${repetidos.length ? ` · ${repetidos.length} número(s) repetido(s), mantido o primeiro` : ""}`);
  cache = mapa;
  return mapa;
}

/** Junta as contas-alvo da planilha com o perfil correspondente. */
export async function resolverContas(alvos, { aoLog = () => {} } = {}) {
  const mapa = await mapaDeContas({ aoLog });
  const resolvidas = [];
  const semPerfil = [];
  for (const a of alvos) {
    const p = mapa.get(a.conta);
    if (p) resolvidas.push({ ...a, userId: p.userId, serial: p.serial, nomePerfil: p.nome, proxy: p.proxy });
    else semPerfil.push(a);
  }
  if (semPerfil.length)
    aoLog(`${semPerfil.length} conta(s) da planilha sem perfil no AdsPower: ${semPerfil.map((x) => x.conta).join(", ")}`);
  return { resolvidas, semPerfil };
}
