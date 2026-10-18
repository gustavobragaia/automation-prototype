// Lista os perfis do AdsPower e liga o número da conta ao user_id.
//
// A planilha diz "shopee 225"; a Local API só abre perfil por user_id ou
// serial. Sem esta ponte a fila chamaria browser/start com user_id=undefined.

import { listarPerfis } from "./adspower.mjs";
import { parseConta } from "./tracking.mjs";

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

let cache = null;

/**
 * Agrupa a lista crua do AdsPower por número de conta.
 *
 * Separado da chamada de rede para poder ser testado: é aqui que mora a
 * decisão perigosa.
 *
 * @returns {{mapa:Map, duplicadas:Map<number, perfis[]>, semNumero:number}}
 */
export function agruparPerfis(perfis) {
  const porConta = new Map();
  let semNumero = 0;

  for (const p of perfis) {
    const c = parseConta(p.name);
    if (c.numeros.length !== 1) { semNumero++; continue; }
    const n = c.numeros[0];
    const dado = {
      userId: p.user_id,
      serial: Number(p.serial_number),
      nome: p.name,
      proxy: p.user_proxy_config?.proxy_soft === "no_proxy" ? null : p.user_proxy_config?.proxy_type ?? null,
    };
    if (!porConta.has(n)) porConta.set(n, []);
    porConta.get(n).push(dado);
  }

  const mapa = new Map();
  const duplicadas = new Map();
  for (const [n, lista] of porConta) {
    if (lista.length > 1) duplicadas.set(n, lista);   // não escolhe: bloqueia
    else mapa.set(n, lista[0]);
  }
  return { mapa, duplicadas, semNumero };
}

/**
 * Duas contas diferentes apontando para o MESMO perfil.
 *
 * Não acontece vindo do AdsPower (user_id é único por perfil), mas acontece
 * em lista escrita à mão — contas.json. E é o pior caso de todos: os cookies
 * de uma conta sobrescrevem os da outra, o robô entra como a conta errada e
 * escreve o rastreio no pedido de outro cliente. Em silêncio.
 */
export function perfisCompartilhados(contas) {
  const porPerfil = new Map();
  for (const c of contas) {
    const id = c.userId ?? c.user_id;
    if (!id) continue;
    if (!porPerfil.has(id)) porPerfil.set(id, []);
    porPerfil.get(id).push(Number(c.conta));
  }
  const conflitos = new Map();
  for (const [id, lista] of porPerfil) {
    const unicas = [...new Set(lista)];
    if (unicas.length > 1) conflitos.set(id, unicas);
  }
  return conflitos;
}

/** @returns Map<numeroDaConta, {userId, serial, nome, proxy}> */
export async function mapaDeContas({ forcar = false, aoLog = () => {} } = {}) {
  if (cache && !forcar) return cache;

  const todos = [];
  let pagina = 1;
  while (pagina <= 30) {
    const d = await listarPerfis(pagina, 100);
    const lista = d?.list ?? [];
    if (lista.length === 0) break;
    todos.push(...lista);
    pagina++;
    await dormir(1200);   // user/list é limitado a 1 req/s em alguns planos
  }

  const { mapa, duplicadas } = agruparPerfis(todos);
  aoLog(`${mapa.size} perfis mapeados`);
  for (const [n, lista] of duplicadas)
    aoLog(`conta ${n}: ${lista.length} perfis com esse número (${lista.map((x) => x.userId).join(", ")}) — ` +
          `fora da rodada até sobrar um só`);

  cache = mapa;
  cache.duplicadas = duplicadas;
  return cache;
}

/**
 * As contas com mais de um perfil, SE a varredura já aconteceu nesta
 * abertura. Não dispara a varredura: ela custa ~1 req/s por página de 100
 * perfis. Sem varredura feita, a resposta honesta é "não sei" (null), não
 * "nenhuma".
 */
export function duplicadasConhecidas() {
  if (!cache) return null;
  return [...(cache.duplicadas ?? new Map())].map(([conta, perfis]) => ({
    conta, perfis: perfis.map((p) => p.serial ?? p.userId),
  }));
}

/** Junta as contas-alvo da planilha com o perfil correspondente. */
export async function resolverContas(alvos, { aoLog = () => {} } = {}) {
  const mapa = await mapaDeContas({ aoLog });
  const duplicadas = mapa.duplicadas ?? new Map();
  const resolvidas = [];
  const semPerfil = [];
  const ambiguas = [];

  for (const a of alvos) {
    if (duplicadas.has(a.conta)) { ambiguas.push({ ...a, perfis: duplicadas.get(a.conta) }); continue; }
    const p = mapa.get(a.conta);
    if (p) resolvidas.push({ ...a, userId: p.userId, serial: p.serial, nomePerfil: p.nome, proxy: p.proxy });
    else semPerfil.push(a);
  }

  if (semPerfil.length)
    aoLog(`${semPerfil.length} conta(s) da planilha sem perfil no AdsPower: ${semPerfil.map((x) => x.conta).join(", ")}`);
  if (ambiguas.length)
    aoLog(`${ambiguas.length} conta(s) com mais de um perfil — não abro nenhum: ${ambiguas.map((x) => x.conta).join(", ")}`);

  // Última checagem, agora sobre o que SOBROU: dois alvos no mesmo perfil.
  const conflitos = perfisCompartilhados(resolvidas);
  if (conflitos.size) {
    const presas = new Set([...conflitos.values()].flat());
    for (const [id, contas] of conflitos)
      aoLog(`perfil ${id} está vinculado às contas ${contas.join(" e ")} — as duas ficam de fora`);
    for (let i = resolvidas.length - 1; i >= 0; i--)
      if (presas.has(Number(resolvidas[i].conta)))
        ambiguas.push({ ...resolvidas.splice(i, 1)[0], perfilCompartilhado: true });
  }

  return { resolvidas, semPerfil, ambiguas };
}
