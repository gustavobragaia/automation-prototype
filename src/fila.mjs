// Fila de perfis: abre, coleta e fecha cada conta de forma independente,
// com concorrência limitada e intervalo aleatório entre contas.
//
// O limite de concorrência existe por memória: cada perfil aberto é um
// Chromium inteiro (300-500 MB). O intervalo aleatório existe porque
// varrer contas em ritmo constante é o que chama atenção.

import { resolve } from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
// BASE e KEY vêm daqui também: duas cópias da mesma configuração já
// custaram caro neste projeto.
import { abrirPerfil, fecharPerfil, statusPerfil, BASE, KEY } from "./adspower.mjs";
import { soltarTrava } from "./trava-login.mjs";
import { novoToken, limparToken, extensaoDaConta } from "./credenciais.mjs";
import { emitir } from "./eventos.mjs";
import { coletaDaConta, loginDaConta } from "./caminhos.mjs";

const EXT = resolve("extensao");

// Login (formulário + código no e-mail) leva bem mais que uma coleta. Sem
// prazo próprio, a fila fechava o perfil no meio e parecia que o login falhou.
const ESPERA_LOGIN_MS = Number(process.env.ESPERA_LOGIN_MS ?? 180_000);

// Verificação da Shopee não é contornada por software: alguém resolve na
// janela. Fechar o perfil na hora tirava da pessoa a chance de fazer isso —
// e é exatamente o fluxo que o produto promete.
const ESPERA_HUMANO_MS = Number(process.env.ESPERA_HUMANO_MS ?? 600_000);

// Perfis abertos por este processo. Um kill no meio da rodada não executa
// o finally de processarConta, e o navegador fica órfão na máquina do
// operador — aconteceu e deixou uma janela aberta sem dono.
const abertosAgora = new Set();
let encerrando = false;

async function fecharTodos() {
  if (encerrando) return;
  encerrando = true;
  for (const ref of abertosAgora) await fecharPerfil(ref).catch(() => {});
  abertosAgora.clear();
}

for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.on(sinal, async () => {
    if (abertosAgora.size)
      console.log(`\n  ${sinal}: fechando ${abertosAgora.size} perfil(is) antes de sair`);
    await fecharTodos();
    process.exit(130);
  });

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
  emitir("conta:abrindo", { conta });
  const arq = coletaDaConta(conta);
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
  emitir("conta:aberta", { conta, perfil: serial ?? userId, porta });

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

    emitir("conta:lendo", { conta });

    const comecou = Date.now();
    for (;;) {
      await dormir(2000);
      if (existsSync(arq) && statSync(arq).mtimeMs > antes) return arq;
      const p = prazoDaConta({ comecou, agora: Date.now(), timeoutMs, marca: lerMarca(conta) });
      if (p.desistir) throw new Error(`conta ${conta}: ${p.desistir}`);
      if (Date.now() >= p.limite)
        throw new Error(`conta ${conta}: nada chegou ao coletor em ${Math.round((p.limite - comecou) / 1000)}s`);
    }
  } finally {
    await fecharPerfil(ref).catch(() => {}); // nunca desloga
    abertosAgora.delete(ref);
  }
}

/** O que a conta avisou sobre login nesta rodada (o arquivo do coletor). */
function lerMarca(conta) {
  try { return JSON.parse(readFileSync(loginDaConta(conta), "utf8")); } catch { return null; }
}

/**
 * Até quando esperar a coleta de uma conta, e se já dá para desistir.
 *
 * O prazo fixo de 150s cortava o login automático no meio (abrir o login,
 * pedir o código no e-mail, voltar, coletar de novo). E quando a conta já
 * tinha dito que não ia dar — precisa de pessoa, login falhou, nenhuma lista
 * respondeu — a fila esperava os 150s inteiros à toa.
 *
 * Só vale aviso desta rodada: a marca é um arquivo que nunca é apagado.
 */
export function prazoDaConta({ comecou, agora, timeoutMs, marca }) {
  const base = { limite: comecou + timeoutMs, desistir: null };
  if (!marca || !(marca.em >= comecou)) return base;
  const motivo = marca.motivo ? ` — ${marca.motivo}` : "";
  // Precisa de uma pessoa: a janela FICA ABERTA para ela resolver, e a tela
  // mostra "precisa de você". Antes a fila desistia na hora e fechava o
  // navegador 2 s depois do aviso — ninguém conseguia agir. Se a pessoa
  // resolve, a página volta a Minhas Compras e a coleta chega sozinha.
  if (/^precisa-humano/.test(marca.tipo)) {
    const limite = marca.em + ESPERA_HUMANO_MS;
    if (agora >= limite) return { ...base, desistir: `a Shopee pediu uma pessoa e ninguém resolveu em ${Math.round(ESPERA_HUMANO_MS / 60000)} min${motivo}` };
    return { limite: Math.max(base.limite, limite), desistir: null };
  }
  if (/^login-falhou/.test(marca.tipo)) return { ...base, desistir: `o login automático falhou${motivo}` };
  if (/^coleta-falhou/.test(marca.tipo)) return { ...base, desistir: `a coleta não leu nenhum pedido${motivo}` };
  if (/^sessao-caida/.test(marca.tipo))
    return { ...base, desistir: "a sessão da Shopee caiu e o login automático está desligado" };
  // login em andamento (nao-autenticado, login-*, otp-*): mais prazo, a
  // partir do último aviso — cada passo do login renova a espera
  return { limite: Math.max(base.limite, marca.em + ESPERA_LOGIN_MS), desistir: null };
}

// Quantos pedidos entraram e se a sessão estava viva. Sai do que o coletor
// gravou, não de um contador nosso: é o mesmo arquivo que a rodada vai ler
// depois, então a tela não pode mostrar um número e a conciliação outro.
function resumoDaColeta(conta, arq, comecou) {
  let pedidos = null;
  try { pedidos = (JSON.parse(readFileSync(arq, "utf8")).pedidos ?? []).length; } catch {}
  // O robô só grava este arquivo quando precisa mexer com login. Mas ele
  // nunca é apagado: olhar só se existe faria a conta aparecer como "o robô
  // logou" para sempre, depois de uma única vez meses atrás. Vale a data.
  const marca = loginDaConta(conta);
  const precisouLogin = existsSync(marca) && statSync(marca).mtimeMs >= comecou;
  return { pedidos, precisouLogin };
}

// Parar no meio.
//
// Não é matar o que está rodando: a conta que já abriu o perfil termina, e
// o `finally` do processarConta é que fecha o navegador. Abortar no meio
// deixaria perfil aberto e aba pela metade — que é como a sessão da conta
// morre e o robô precisa logar de novo amanhã.
//
// Então parar quer dizer: não pegue mais nenhuma da fila.
let pararPedido = false;
export function pedirParada() { pararPedido = true; }
export function paradaPedida() { return pararPedido; }

/** Roda a fila com concorrência limitada e pausa aleatória entre contas. */
export async function rodarFila(contas, { concorrencia = 3, pausaMin = 4000, pausaMax = 12_000, aoLog = () => {} } = {}) {
  const pendentes = [...contas];
  const resultados = [];

  pararPedido = false;   // uma parada de ontem não cancela a rodada de hoje

  // Token novo a cada rodada: se vazar, vale só por esta execução.
  novoToken();

  const trabalhador = async (n) => {
    while (pendentes.length) {
      if (pararPedido) {
        // As que sobraram não viram falha: ninguém tentou abrir.
        for (const resto of pendentes.splice(0))
          aoLog(`conta ${resto.conta}: fora da rodada — parada pedida`);
        return;
      }
      const c = pendentes.shift();
      const comecou = Date.now();
      try {
        const arq = await processarConta(c, { aoLog });
        resultados.push({ ...c, ok: true, arq });
        aoLog(`conta ${c.conta}: coletada`);
        emitir("conta:feita", {
          conta: c.conta,
          segundos: Math.round((Date.now() - comecou) / 1000),
          ...resumoDaColeta(c.conta, arq, comecou),
        });
      } catch (e) {
        resultados.push({ ...c, ok: false, erro: e.message });
        aoLog(`conta ${c.conta}: FALHOU — ${e.message}`);
        emitir("conta:falhou", { conta: c.conta, erro: e.message });
      } finally {
        // Rede de segurança: se o perfil morreu antes de soltar a vez, a
        // fila inteira ficaria esperando a trava expirar.
        soltarTrava(c.conta);
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
