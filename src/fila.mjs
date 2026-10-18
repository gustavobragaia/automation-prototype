// Fila de perfis: abre, coleta e fecha cada conta de forma independente,
// com concorrência limitada e intervalo aleatório entre contas.
//
// O limite de concorrência existe por memória: cada perfil aberto é um
// Chromium inteiro (300-500 MB). O intervalo aleatório existe porque
// varrer contas em ritmo constante é o que chama atenção.

import { resolve } from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import { abrirPerfil, fecharPerfil, statusPerfil } from "./adspower.mjs";
import { novoToken, limparToken, extensaoDaConta } from "./credenciais.mjs";

const BASE = process.env.ADSPOWER_BASE ?? "http://local.adspower.net:50325";
const KEY = process.env.ADSPOWER_API_KEY ?? "";
const EXT = resolve("extensao");

// Login (formulário + código no e-mail) leva bem mais que uma coleta. Sem
// prazo próprio, a fila fechava o perfil no meio e parecia que o login falhou.
const ESPERA_LOGIN_MS = Number(process.env.ESPERA_LOGIN_MS ?? 180_000);

// Verificação da Shopee não é contornada por software: alguém resolve na
// janela. Fechar o perfil na hora tirava da pessoa a chance de fazer isso —
// e é exatamente o fluxo que o produto promete.
const ESPERA_HUMANO_MS = Number(process.env.ESPERA_HUMANO_MS ?? 300_000);

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
// 70s era apertado: uma conta com 20 pedidos levou 62s. Qualquer conta um
// pouco maior falhava por prazo, não por problema real.
export async function processarConta({ serial, userId, conta }, {
  aoLog = () => {},
  timeoutMs = Number(process.env.TIMEOUT_CONTA_MS ?? 150_000),
} = {}) {
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
    launchArgs: [`--load-extension=${extensaoDaConta(conta)}`],
    aoEsperar: (msg, i, n) => aoLog(`conta ${conta}: ${msg} (tentativa ${i}/${n})`),
  });
  const porta = d.debugPort;
  abertosAgora.add(ref);
  aoLog(`conta ${conta}: perfil aberto (porta ${porta})`);

  try {
    await dormir(entre(3000, 5000));

    // O perfil restaura as abas da última sessão do operador. Elas também
    // rodam nossos content scripts, o que virava logins simultâneos e
    // coletas duplicadas. Fechar é pelo endpoint HTTP, sem sessão CDP.
    try {
      const abas = await (await fetch(`http://127.0.0.1:${porta}/json/list`)).json();
      const antigas = abas.filter((t) => t.type === "page" && !/^(about:blank|chrome:)/.test(t.url ?? ""));
      for (const t of antigas)
        await fetch(`http://127.0.0.1:${porta}/json/close/${t.id}`).catch(() => {});
      if (antigas.length) aoLog(`conta ${conta}: ${antigas.length} aba(s) restaurada(s) fechada(s)`);
    } catch {}

    const url = "https://shopee.com.br/user/purchase?type=7";
    await fetch(`http://127.0.0.1:${porta}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });

    const limite = Date.now() + timeoutMs;
    while (Date.now() < limite) {
      await dormir(2000);
      if (existsSync(arq) && statSync(arq).mtimeMs > antes) return arq;
    }
    throw new Error(`conta ${conta}: nada chegou ao coletor em ${timeoutMs / 1000}s`);
  } finally {
    await fecharPerfil(ref).catch(() => {}); // nunca desloga
    abertosAgora.delete(ref);
  }
}

/** Roda a fila com concorrência limitada e pausa aleatória entre contas. */
export async function rodarFila(contas, { concorrencia = 3, pausaMin = 4000, pausaMax = 12_000, aoLog = () => {} } = {}) {
  const pendentes = [...contas];
  const resultados = [];

  // Token novo a cada rodada: se vazar, vale só por esta execução.
  novoToken();

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

  try {
    await Promise.all(Array.from({ length: Math.min(concorrencia, contas.length) }, (_, i) => trabalhador(i)));
  } finally {
    limparToken();   // fora da rodada, o coletor não entrega credencial nenhuma
  }
  return resultados;
}
