// Fila de perfis: abre, coleta e fecha cada conta de forma independente,
// com concorrência limitada e intervalo aleatório entre contas.
//
// O limite de concorrência existe por memória: cada perfil aberto é um
// Chromium inteiro (300-500 MB). O intervalo aleatório existe porque
// varrer contas em ritmo constante é o que chama atenção.

import { resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import { abrirPerfil, fecharPerfil, statusPerfil } from "./adspower.mjs";

const BASE = process.env.ADSPOWER_BASE ?? "http://local.adspower.net:50325";
const KEY = process.env.ADSPOWER_API_KEY ?? "";
const EXT = resolve("extensao");

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const entre = (a, b) => a + Math.floor(Math.random() * (b - a));

async function api(caminho, params = {}) {
  const u = new URL(caminho, BASE);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(90_000) });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`${j.msg} (code ${j.code})`);
  return j.data;
}

/**
 * Processa uma conta. Devolve o caminho do arquivo que o coletor gravou,
 * ou lança se nada chegou — rodada silenciosamente vazia é o pior
 * resultado possível, pior que um erro barulhento.
 */
export async function processarConta({ serial, userId, conta }, { aoLog = () => {}, timeoutMs = 70_000 } = {}) {
  const ref = serial != null ? { serial } : { userId };
  const arq = `captura/coletas/conta-${conta}.json`;
  const antes = existsSync(arq) ? statSync(arq).mtimeMs : 0;

  if ((await statusPerfil(ref).catch(() => "Inactive")) === "Active") {
    await fecharPerfil(ref).catch(() => {});
    await dormir(2500);
  }

  // Via abrirPerfil, não com cliente próprio: é lá que mora o retry para o
  // AdsPower baixando o kernel do Chrome do perfil. Numa máquina nova nenhum
  // kernel está em cache, e cada perfil pode pedir uma versão diferente.
  const d = await abrirPerfil(ref, {
    launchArgs: [`--load-extension=${EXT}`],
    aoEsperar: (msg, i, n) => aoLog(`conta ${conta}: ${msg} (tentativa ${i}/${n})`),
  });
  const porta = d.debugPort;
  aoLog(`conta ${conta}: perfil aberto (porta ${porta})`);

  try {
    await dormir(entre(3000, 5000));
    const url = `https://shopee.com.br/user/purchase?type=7#conta=${conta}`;
    await fetch(`http://127.0.0.1:${porta}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });

    const limite = Date.now() + timeoutMs;
    while (Date.now() < limite) {
      await dormir(2000);
      if (existsSync(arq) && statSync(arq).mtimeMs > antes) return arq;
    }
    throw new Error(`conta ${conta}: nada chegou ao coletor em ${timeoutMs / 1000}s`);
  } finally {
    await fecharPerfil(ref).catch(() => {}); // nunca desloga
  }
}

/** Roda a fila com concorrência limitada e pausa aleatória entre contas. */
export async function rodarFila(contas, { concorrencia = 3, pausaMin = 4000, pausaMax = 12_000, aoLog = () => {} } = {}) {
  const pendentes = [...contas];
  const resultados = [];

  const trabalhador = async (n) => {
    while (pendentes.length) {
      const c = pendentes.shift();
      try {
        const arq = await processarConta(c, { aoLog });
        resultados.push({ ...c, ok: true, arq });
        aoLog(`conta ${c.conta}: coletada`);
      } catch (e) {
        resultados.push({ ...c, ok: false, erro: e.message });
        aoLog(`conta ${c.conta}: FALHOU — ${e.message}`);
      }
      if (pendentes.length) await dormir(entre(pausaMin, pausaMax));
    }
  };

  await Promise.all(Array.from({ length: Math.min(concorrencia, contas.length) }, (_, i) => trabalhador(i)));
  return resultados;
}
