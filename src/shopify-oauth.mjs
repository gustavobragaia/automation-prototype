// Cenário B, lado do aplicativo: "Conectar Shopify" em dois cliques.
//
//   1. o app gera um `state` com a porta do coletor e um nonce
//   2. abre o navegador em esteira.cloud/shopify/instalar
//   3. o lojista vê a tela de permissões da Shopify e aprova
//   4. a Shopify volta no nosso endpoint, que troca o code pelo token
//   5. esse endpoint devolve o token por POST para 127.0.0.1 — aqui
//   6. o token é gravado nesta máquina e some do servidor
//
// O token não fica no nosso servidor em momento nenhum. É o que permite
// dizer ao cliente, com honestidade, que a credencial da loja dele vive só
// no computador dele.

import { spawn } from "node:child_process";
import { novoEstado, lerEstado } from "../servidor/lib/validar.js";
import { normalizarLoja, salvarConexao } from "./shopify-conexao.mjs";

const BASE = process.env.ESTEIRA_BASE ?? "https://esteira.cloud";
const ESPERA_MS = Number(process.env.OAUTH_ESPERA_MS ?? 5 * 60_000);

let pendente = null;   // { state, loja, resolver, prazo }

/** Começa a conexão: devolve a URL para abrir e promete o resultado. */
export function iniciarConexao(lojaBruta, { porta = 3000, abrir = true } = {}) {
  const loja = normalizarLoja(lojaBruta);
  if (!loja) throw new Error("endereço de loja inválido — esperado minhaloja.myshopify.com");

  const state = novoEstado(porta);
  const url = `${BASE}/shopify/instalar?loja=${encodeURIComponent(loja)}&state=${state}`;

  const promessa = new Promise((resolve, reject) => {
    pendente = { state, loja, resolve, reject };
    setTimeout(() => {
      if (pendente?.state === state) {
        pendente = null;
        reject(new Error("o lojista não concluiu a autorização a tempo"));
      }
    }, ESPERA_MS).unref?.();
  });

  // `abrir` pode ser uma função: o app passa o shell.openExternal do Electron,
  // que abre o endereço inteiro em qualquer sistema. Sem ela (terminal), o
  // jeito de cada sistema.
  if (typeof abrir === "function") abrir(url);
  else if (abrir) abrirNavegador(url);
  return { url, loja, state, pronto: promessa };
}

/**
 * Chamado pelo coletor quando o POST chega em /shopify/pronto.
 *
 * Confere o `state`: só aceita o retorno da conexão que ESTA máquina
 * começou. Sem isso, qualquer página aberta no navegador poderia postar
 * um token aqui e trocar a loja do cliente por outra.
 */
export function receberToken(campos = {}) {
  if (!pendente) return { ok: false, erro: "nenhuma conexão em andamento" };
  if (campos.state !== pendente.state) return { ok: false, erro: "state não confere" };
  if (!lerEstado(campos.state)) return { ok: false, erro: "state malformado" };

  const loja = normalizarLoja(campos.loja);
  if (!loja || loja !== pendente.loja) return { ok: false, erro: "a loja não é a que foi pedida" };
  if (!campos.accessToken) return { ok: false, erro: "veio sem token" };

  const segundos = Number(campos.expiresIn || 0);
  const conexao = salvarConexao({
    loja,
    modo: campos.refreshToken ? "oauth" : "token-fixo",
    accessToken: campos.accessToken,
    refreshToken: campos.refreshToken || undefined,
    // sem expires_in o token é dos que não expiram; não inventa prazo
    expiraEm: segundos ? Date.now() + segundos * 1000 : undefined,
    escopos: campos.escopos ? String(campos.escopos).split(",") : undefined,
    conectadoEm: new Date().toISOString(),
  });

  const p = pendente; pendente = null;
  p.resolve(conexao);
  return { ok: true, loja };
}

export const conexaoEmAndamento = () => (pendente ? { loja: pendente.loja } : null);
export const cancelarConexao = () => { pendente = null; };

export function argumentosDoNavegador(url, plataforma = process.platform) {
  // No Windows quem abre é o cmd, e para o cmd "&" SEPARA COMANDOS: o
  // endereço "...?loja=X&state=Y" chegava ao navegador cortado no "&", sem o
  // state, e a Shopify voltava com "state inválido". O Matheus nunca
  // conseguiria conectar a loja. Escapar com ^ entrega o endereço inteiro.
  if (plataforma === "win32")
    return ["cmd", ["/c", "start", "", url.replace(/[&^|<>]/g, "^$&")]];
  return [plataforma === "darwin" ? "open" : "xdg-open", [url]];
}

function abrirNavegador(url) {
  const [cmd, args] = argumentosDoNavegador(url);
  try { spawn(cmd, args, { detached: true, stdio: "ignore" }).unref(); } catch {}
}
