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
import { novoToken, limparToken, extensaoDaConta, liberarLogin, zerarLogins } from "./credenciais.mjs";
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
  tentativa = 1,
} = {}) {
  // Só para teste ao vivo do retry: ESTEIRA_TESTE_FALHAR=124 faz a 1ª tentativa
  // da conta 124 estourar o prazo em 3 s, numa conta e num perfil de verdade.
  if (tentativa === 1 && String(process.env.ESTEIRA_TESTE_FALHAR ?? "").split(",").includes(String(conta)))
    timeoutMs = 3000;
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
      const antigas = abasParaFechar(abas);
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
      if (p.desistir) throw Object.assign(new Error(`conta ${conta}: ${p.desistir}`), p.adiarAte ? { adiarAte: p.adiarAte } : {});
      if (Date.now() >= p.limite)
        throw new Error(`conta ${conta}: nada chegou ao coletor em ${Math.round((p.limite - comecou) / 1000)}s`);
    }
  } finally {
    await fecharPerfil(ref).catch(() => {}); // nunca desloga
    abertosAgora.delete(ref);
  }
}

/**
 * As abas restauradas que a fila fecha ao abrir o perfil. A aba do próprio
 * AdsPower ("Shopee 139", start.adspower.net) FICA: é ela que diz qual conta é
 * aquela janela — o Matheus precisava achar a conta que pedia "precisa de
 * você" e não tinha como.
 */
export function abasParaFechar(abas) {
  return abas.filter((t) => t.type === "page" &&
    !/^(about:blank|chrome:)/.test(t.url ?? "") &&
    !/^https?:\/\/start\.adspower\.(net|com)\//.test(t.url ?? ""));
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
  // O freio dos logins não deixou esta conta logar agora: ela volta para o
  // fim da fila e só abre de novo depois de `ate`. Não é falha.
  if (/^login-adiado/.test(marca.tipo))
    return { ...base, desistir: `login adiado${motivo}`, adiarAte: Number(marca.ate) || agora + 15 * 60_000 };
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

// ── Tentar de novo ──────────────────────────────────────────────────────
//
// Conta que falha por algo PASSAGEIRO (a página demorou, nenhuma lista
// respondeu, o perfil não abriu, o login travou no meio) volta para o FIM da
// fila e é tentada de novo depois das outras — até TENTATIVAS vezes no total.
// Nunca em sequência: logar de novo na hora é o que fez a Shopee pedir
// captcha nas contas 142, 149 e 153 (21/10).
//
// Conta que falha porque precisa de uma PESSOA (captcha, senha recusada,
// cota da caixa de e-mail acabou, login automático desligado) não repete:
// repetir não resolve e só piora a conta. Vai direto para o alerta.
export const TENTATIVAS = () => Math.max(1, Number(process.env.TENTATIVAS_CONTA ?? 3));
const PAUSA_REPETIR_MS = () => Number(process.env.PAUSA_REPETIR_MS ?? 30_000);
// O e-mail de verificação que não chegou: a Shopee segura o envio quando
// muitas contas pedem verificação juntas. Tentar logo em seguida pediria
// outro e-mail no mesmo aperto; espera um tempo e tenta UMA vez mais (o
// segundo login da conta na rodada).
const EMAIL_NAO_CHEGOU = /e-mail de verificação da Shopee não chegou/;
const PAUSA_EMAIL_MS = () => Number(process.env.PAUSA_EMAIL_MS ?? 15 * 60_000);

const PRECISA_DE_PESSOA = new RegExp([
  "pediu uma pessoa", "captcha", "verificação de imagem", "senha inv[aá]lida", "conta bloquead",
  "conta não existe", "excesso de tentativas", "cota da RapidAPI", "RapidAPI recusou",
  "login automático está desligado", "não está preenchid", "não está configurad",
].join("|"), "i");

/** "pessoa": só uma pessoa resolve, não repete. "passageira": vale tentar de novo. */
export function tipoDaFalha(mensagem) {
  return PRECISA_DE_PESSOA.test(String(mensagem ?? "")) ? "pessoa" : "passageira";
}

/**
 * Roda a fila com concorrência limitada e pausa aleatória entre contas.
 * `processar` existe para os testes; a rodada de verdade usa processarConta.
 */
/**
 * A conta provavelmente está deslogada: a última vez que o robô mexeu com o
 * login dela terminou sem entrar (precisa de você, login falhou, adiado…), e
 * ela não foi lida depois disso. Essas vão para o FIM da fila: as de sessão
 * viva são lidas primeiro, sem depender de e-mail nenhum da Shopee
 * (rodada de 21/10: o e-mail travou depois de ~35 verificações numa hora).
 */
export function provavelDeslogada(conta) {
  const m = lerMarca(conta);
  if (!m?.tipo || /^login-ok/.test(m.tipo)) return false;
  const arq = coletaDaConta(conta);
  const lidaDepois = existsSync(arq) && statSync(arq).mtimeMs > Number(m.em ?? 0);
  return !lidaDepois;
}

/** Sessão viva primeiro, provável login no fim; dentro de cada grupo, a ordem de antes. */
export function ordenarParaFila(contas) {
  const vivas = [], deslogadas = [];
  for (const c of contas) (provavelDeslogada(c.conta) ? deslogadas : vivas).push(c);
  return [...vivas, ...deslogadas];
}

// A fila que está rodando agora, para "Tentar de novo" no meio da rodada.
let filaAtual = null;

/**
 * Põe de volta no fim da fila DESTA rodada uma conta que já falhou nela.
 * É o botão do alerta: a pessoa corrigiu a senha da conta à mão, e a conta
 * volta sem esperar a rodada acabar (Matheus, 22/10, conta 232). A pessoa
 * agiu, então a conta ganha mais um login mesmo que já tenha usado os dois.
 * @returns {"na-fila"|"ja-na-fila"|"sem-rodada"|"nao-falhou"}
 */
export function repetirNaRodada(conta) {
  const f = filaAtual;
  if (!f || pararPedido) return "sem-rodada";
  const n = Number(conta);
  if (f.pendentes.some((p) => Number(p.c.conta) === n) || f.andando.has(n)) return "ja-na-fila";
  const i = f.resultados.findIndex((r) => Number(r.conta) === n && !r.ok);
  if (i < 0) return "nao-falhou";
  const { ok, erro, tentativas = 1, natureza, arq, ...c } = f.resultados.splice(i, 1)[0];
  void ok; void erro; void natureza; void arq;
  f.pendentes.push({ c, tentativa: tentativas + 1, naoAntesDe: 0, manual: true });
  zerarLogins(n);
  f.aoLog(`conta ${n}: de volta ao fim da fila, a pedido (${tentativas + 1}ª tentativa)`);
  emitir("conta:repetindo", { conta: n, tentativa: tentativas + 1, de: tentativas + 1, motivo: "pedido por você" });
  return "na-fila";
}

export async function rodarFila(contas, { concorrencia = 3, pausaMin = 4000, pausaMax = 12_000, aoLog = () => {},
                                          processar = processarConta } = {}) {
  const ordem = ordenarParaFila(contas);
  const deslogadas = contas.filter((c) => provavelDeslogada(c.conta)).length;
  if (deslogadas) aoLog(`${deslogadas} conta(s) que precisavam de login na última vez vão para o fim da fila`);
  const pendentes = ordem.map((c) => ({ c, tentativa: 1, naoAntesDe: 0 }));
  const resultados = [];
  const andando = new Set();
  let emAndamento = 0;
  filaAtual = { pendentes, resultados, andando, aoLog };

  pararPedido = false;   // uma parada de ontem não cancela a rodada de hoje

  // Token novo a cada rodada: se vazar, vale só por esta execução.
  novoToken();

  // A próxima que já pode ir. Uma conta que voltou para a fila espera a sua
  // pausa; enquanto isso, as outras andam.
  const proxima = () => {
    const agora = Date.now();
    const i = pendentes.findIndex((p) => p.naoAntesDe <= agora);
    return i < 0 ? null : pendentes.splice(i, 1)[0];
  };

  const trabalhador = async () => {
    // Fica vivo enquanto houver conta pendente OU em andamento: uma conta em
    // andamento pode voltar para a fila, e alguém precisa pegá-la.
    while (pendentes.length || emAndamento) {
      if (pararPedido) {
        // As que sobraram não viram falha: ninguém tentou abrir.
        for (const resto of pendentes.splice(0)) {
          aoLog(`conta ${resto.c.conta}: fora da rodada — parada pedida`);
          // Quem já foi aberta e não foi lida (esperando a 2ª tentativa, ou
          // adiada pelo freio) tem que aparecer no fim, com "Tentar de novo
          // só essas", e não sumir. Só some quem nunca chegou a abrir.
          const erro = resto.adiada ?? resto.ultimoErro;
          if (erro) resultados.push({ ...resto.c, ok: false, erro, tentativas: Math.max(1, resto.tentativa - (resto.adiada ? 0 : 1)), natureza: "passageira" });
        }
        return;
      }
      const item = proxima();
      if (!item) { await dormir(500); continue; }
      const { c, tentativa, manual } = item;
      emAndamento++;
      andando.add(Number(c.conta));
      const comecou = Date.now();
      let repetir = false;
      try {
        const arq = await processar(c, { aoLog, tentativa });
        resultados.push({ ...c, ok: true, arq, tentativas: tentativa });
        aoLog(`conta ${c.conta}: coletada${tentativa > 1 ? ` na ${tentativa}ª tentativa` : ""}`);
        emitir("conta:feita", {
          conta: c.conta, tentativas: tentativa,
          segundos: Math.round((Date.now() - comecou) / 1000),
          ...resumoDaColeta(c.conta, arq, comecou),
        });
      } catch (e) {
        if (e.adiarAte && !pararPedido) {
          // Adiada pelo freio dos logins: não gastou login nem tentativa.
          pendentes.push({ c, tentativa, naoAntesDe: e.adiarAte, manual, adiada: e.message });
          aoLog(`${e.message} — a conta volta para a fila às ${new Date(e.adiarAte).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`);
          emitir("conta:adiada", { conta: c.conta, ate: e.adiarAte, motivo: e.message });
          continue;
        }
        // "natureza", e não "tipo": emitir() junta os dados ao evento, e um
        // campo "tipo" apagava o "conta:falhou" — a tela não via a falha.
        const natureza = tipoDaFalha(e.message);
        // A tentativa pedida à mão não se repete sozinha: se falhar, volta
        // para a pessoa, que é quem sabe o que mudou na conta.
        const doEmail = EMAIL_NAO_CHEGOU.test(e.message);
        repetir = natureza === "passageira" && !manual && tentativa < (doEmail ? 2 : TENTATIVAS()) && !pararPedido;
        if (repetir) {
          const pausa = doEmail ? PAUSA_EMAIL_MS() : PAUSA_REPETIR_MS();
          pendentes.push({ c, tentativa: tentativa + 1, naoAntesDe: Date.now() + pausa, ultimoErro: e.message });
          liberarLogin(c.conta);   // a próxima tentativa pode entrar de novo (no máx. 2 logins por rodada)
          const de = doEmail ? 2 : TENTATIVAS();
          aoLog(`conta ${c.conta}: falhou (${e.message}) — vai tentar de novo no fim da fila (${tentativa + 1}ª de ${de}` +
                (doEmail ? `, daqui a ${Math.round(pausa / 60_000)} min` : "") + ")");
          emitir("conta:repetindo", { conta: c.conta, tentativa: tentativa + 1, de, motivo: e.message });
        } else {
          resultados.push({ ...c, ok: false, erro: e.message, tentativas: tentativa, natureza });
          aoLog(`conta ${c.conta}: FALHOU — ${e.message}${tentativa > 1 ? ` (depois de ${tentativa} tentativas)` : ""}`);
          emitir("conta:falhou", { conta: c.conta, erro: e.message, tentativas: tentativa, natureza });
        }
      } finally {
        emAndamento--;
        andando.delete(Number(c.conta));
        // Rede de segurança: se o perfil morreu antes de soltar a vez, a
        // fila inteira ficaria esperando a trava expirar.
        soltarTrava(c.conta);
      }
      if (pendentes.length) await dormir(entre(pausaMin, pausaMax));
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(concorrencia, contas.length) }, () => trabalhador()));
  } finally {
    filaAtual = null;
    limparToken();   // fora da rodada, o coletor não entrega credencial nenhuma
  }
  return resultados;
}
