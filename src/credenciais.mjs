// Credenciais das contas Shopee, e o token que protege a entrega delas.
//
// O coletor escuta em 127.0.0.1 e a extensão precisa buscar e-mail e senha
// de algum lugar. Sem proteção, QUALQUER página aberta no navegador poderia
// pedir — basta saber a URL. Por isso:
//
//   1. o token é gerado por rodada e gravado dentro da pasta da extensão,
//      que páginas web não conseguem ler (sem web_accessible_resources);
//   2. quem busca é o service worker, não o content script: páginas não
//      conseguem falar com ele;
//   3. o coletor recusa qualquer requisição com Origin de site.

import { randomBytes } from "node:crypto";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { emailDaConta } from "./tracking.mjs";
import { emRecursos, emTrabalho } from "./caminhos.mjs";

// A extensão original vem com o app; a cópia por conta é escrita a cada
// rodada, e precisa estar em disco de verdade — o Chrome não carrega
// extensão de dentro do pacote.
const BASE_EXT = emRecursos("extensao");
const RAIZ_RODADA = emTrabalho("extensao-rodada");
let tokenAtual = null;
let dirRodada = null;
// Contas que já receberam a senha nesta rodada. Uma tentativa de login por
// conta por rodada: na Chomps, em 21/10, o robô entrou 6 vezes em 30 s na
// mesma conta (a Shopee pedia "Verificar Identidade", ele achava que tinha
// entrado e voltava) até a Shopee pedir verificação por imagem.
const jaEntregue = new Map();     // conta → logins começados nesta rodada
const permitidos = new Map();     // conta → logins permitidos (1; 2 depois de um retry)
const MAX_LOGINS = 2;

export function novoToken() {
  tokenAtual = randomBytes(24).toString("hex");
  jaEntregue.clear();
  permitidos.clear();
  // O ID de uma extensão descompactada vem do CAMINHO. Reusar a mesma pasta
  // fazia o Chrome reaproveitar o service worker em cache do perfil — com o
  // token da rodada anterior, e a credencial era recusada como inválida.
  rmSync(RAIZ_RODADA, { recursive: true, force: true });
  dirRodada = join(RAIZ_RODADA, randomBytes(6).toString("hex"));
  return tokenAtual;
}

/**
 * Uma cópia da extensão por conta. O fragmento da URL (#conta=231) não
 * sobrevive ao redirect da Shopee para a tela de login — e era assim que a
 * extensão descobria de quem era o perfil. Gravando a conta dentro da
 * própria extensão, ela sabe quem é independente de para onde a página vá.
 *
 * Cópia por conta, e não arquivo compartilhado, porque a fila roda várias
 * ao mesmo tempo e todas leriam o mesmo valor.
 */
export function extensaoDaConta(conta) {
  if (!dirRodada) throw new Error("novoToken() precisa rodar antes de extensaoDaConta()");
  const destino = join(dirRodada, `conta-${conta}`);
  mkdirSync(dirRodada, { recursive: true });
  rmSync(destino, { recursive: true, force: true });
  cpSync(BASE_EXT, destino, { recursive: true });
  writeFileSync(join(destino, "sessao.js"),
    `// gerado por rodada — não versionar\n` +
    `self.COLETOR_TOKEN = ${JSON.stringify(tokenAtual)};\n` +
    `self.COLETOR_CONTA = ${JSON.stringify(String(conta))};\n` +
    // Desligar o login permite varrer contas só para descobrir quais têm
    // sessão viva, sem enviar credencial nenhuma.
    `self.LOGIN_AUTOMATICO = ${process.env.LOGIN_AUTOMATICO === "0" ? "false" : "true"};\n`);
  return destino;
}

export const tokenValido = (t) => Boolean(tokenAtual) && t === tokenAtual;

export function limparToken() {
  tokenAtual = null;
  dirRodada = null;
  try { rmSync(RAIZ_RODADA, { recursive: true, force: true }); } catch {}
}

/** A senha é única para todas as contas; o e-mail vem do padrão. */
export function credencialDaConta(conta) {
  const senha = process.env.SHOPEE_SENHA;
  // A mensagem é para quem está na frente do app, não para quem escreveu
  // o código: ele não sabe o que é uma variável de ambiente, e o lugar de
  // resolver isto é a tela.
  if (!senha) throw new Error("a senha das contas da Shopee não está preenchida — Ajustes → Contas da Shopee");
  return { email: emailDaConta(Number(conta)), senha };
}

/**
 * A senha para o login.js, UMA vez por conta por rodada. A segunda vez
 * quer dizer que o login anterior não pegou; insistir é o que faz a Shopee
 * endurecer com a conta. Daí em diante é com uma pessoa.
 */
export function entregarCredencial(conta) {
  const n = Number(conta);
  if ((jaEntregue.get(n) ?? 0) >= (permitidos.get(n) ?? 1)) {
    const e = new Error("o robô já tentou entrar nesta conta nesta rodada e não ficou logado");
    e.repetida = true;
    throw e;
  }
  return credencialDaConta(n);
}

/**
 * O login COMEÇOU nesta conta (o login.js preencheu e vai clicar). É isto que
 * conta como "a tentativa da rodada", não a entrega da senha: o perfil
 * restaura abas antigas, uma delas pedia a senha antes de a fila fechá-la, e
 * a aba de verdade ficava sem (conta 122, 21/10).
 */
export function marcarTentativa(conta) {
  const n = Number(conta);
  jaEntregue.set(n, (jaEntregue.get(n) ?? 0) + 1);
}

/**
 * A fila vai tentar a conta de novo, no fim da fila: ela ganha direito a
 * mais um login — nunca mais de dois na rodada. O primeiro login que não
 * pegou numa tentativa não condena a conta inteira; dois seguidos, sim.
 */
export function liberarLogin(conta) {
  const n = Number(conta);
  permitidos.set(n, Math.min(MAX_LOGINS, (permitidos.get(n) ?? 1) + 1));
}
