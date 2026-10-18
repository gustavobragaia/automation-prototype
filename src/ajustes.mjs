// O que o cliente escolhe uma vez e não quer escolher de novo.
//
// Até aqui isso vinha do .env, que serve pra quem roda pelo terminal. Quem
// instala o app não tem .env e não vai criar um, então os ajustes passam a
// morar junto do resto do estado, na pasta do usuário.
//
// A chave do AdsPower é credencial: quem a tem abre os navegadores logados
// nas contas da Shopee. Por isso o arquivo nasce 600 (só o dono lê), e a
// tela mostra o campo escondido.
import { readFileSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { emEstado } from "./caminhos.mjs";

// Lido na hora, não na importação: no app a pasta de estado é decidida
// antes de importar o robô, mas um módulo já carregado nunca veria uma
// mudança posterior — e era isso que fazia um teste parecer passar.
const arquivo = () => process.env.AJUSTES_ARQUIVO ?? emEstado("ajustes.json");

const PADRAO = {
  // AdsPower
  adspowerBase: "http://local.adspower.net:50325",
  adspowerChave: "",

  // Contas da Shopee. Tudo isto era .env, que o cliente não tem e não
  // saberia editar.
  //
  // Nascem VAZIOS de propósito. Os padrões eram os da Chomps, e para o
  // segundo comprador do Esteira isso é pior que não ter padrão nenhum: o
  // robô tentaria entrar como "chompspee124@givmail.com" com a senha dele,
  // todas as contas recusariam, e não haveria pista do porquê. Melhor o app
  // se recusar a rodar e dizer o que falta.
  shopeeSenha: "",            // a mesma para todas as contas
  emailPrefixo: "",           // o começo do e-mail das contas
  emailPrefixoAlto: "",       // vazio = um prefixo só para todas
  emailFaixa: 0,              // a partir deste número vale o prefixo de cima
  emailDominio: "",
  codigoChave: "",            // RapidAPI: lê o código de verificação no e-mail
  loginAutomatico: true,      // se o robô entra sozinho quando a sessão cai

  // Rodada
  navegadores: null,          // null = usar a recomendação da máquina
  som: true,
  notificacao: true,
  escreverDireto: false,
  notificarCliente: false,    // a Shopify manda "pedido enviado" ao comprador
  tema: "sistema",
};

// O que é credencial: nunca volta inteiro para a tela, e a tela nunca
// precisa do valor — só de saber que existe um guardado.
export const SEGREDOS = ["adspowerChave", "shopeeSenha", "codigoChave"];

// Lista fechada: o que a tela mandar fora disto é descartado, pra uma tela
// comprometida não conseguir plantar campo que outro pedaço do robô leia.
const CAMPOS = Object.keys(PADRAO);

export function lerAjustes() {
  try {
    const cru = JSON.parse(readFileSync(arquivo(), "utf8"));
    const fora = {};
    for (const c of CAMPOS) if (cru[c] !== undefined) fora[c] = cru[c];
    return { ...PADRAO, ...fora };
  } catch {
    return { ...PADRAO };
  }
}

export function salvarAjustes(mudancas = {}) {
  const atual = lerAjustes();
  for (const [c, v] of Object.entries(mudancas)) {
    if (CAMPOS.includes(c)) atual[c] = v;
  }
  mkdirSync(dirname(arquivo()), { recursive: true });
  writeFileSync(arquivo(), JSON.stringify(atual, null, 2));
  try { chmodSync(arquivo(), 0o600); } catch {}
  return atual;
}

// Os ajustes viram as variáveis que o robô lê.
//
// Eles VENCEM o ambiente, e isso é de propósito: a tela é o único lugar
// onde o cliente consegue mexer. Se ele digitou a senha nos Ajustes e um
// .env esquecido na pasta continuasse ganhando, ele mudaria o campo, nada
// aconteceria, e não teria como descobrir por quê.
//
// O que ele deixou em branco não sobrepõe nada: aí o .env (em
// desenvolvimento) ou o padrão do código continuam valendo.
const NO_AMBIENTE = {
  adspowerChave: "ADSPOWER_API_KEY",
  adspowerBase: "ADSPOWER_BASE",
  shopeeSenha: "SHOPEE_SENHA",
  emailPrefixo: "SHOPEE_PREFIXO",
  emailPrefixoAlto: "SHOPEE_PREFIXO_ALTO",
  emailFaixa: "SHOPEE_FAIXA_PREFIXO",
  emailDominio: "SHOPEE_EMAIL_DOMINIO",
  codigoChave: "RAPIDAPI_KEY",
};

// Campos em que VAZIO é uma resposta, não a falta de uma. "Nenhum segundo
// prefixo" quer dizer que todas as contas usam o mesmo começo de e-mail —
// e isso precisa chegar ao robô, senão o padrão da Chomps volta sozinho.
const VAZIO_VALE = new Set(["emailPrefixoAlto"]);

// O que ainda falta preencher para uma rodada poder acontecer.
//
// Checar ANTES de começar, e não no meio: a sessão de uma conta pode estar
// viva hoje e o robô nem precisar da senha — e aí o problema só apareceria
// daqui a três dias, com a rodada já na metade.
//
// Cada item é uma frase para a pessoa ler, não o nome de um campo.
export function faltaConfigurar(a = lerAjustes()) {
  const falta = [];
  if (!a.shopeeSenha) falta.push("a senha das contas da Shopee");
  if (!a.emailPrefixo) falta.push("o começo do e-mail das contas");
  if (!a.emailDominio) falta.push("o domínio do e-mail das contas");
  if (!a.codigoChave) falta.push("a chave para ler o código de verificação");
  // Um segundo começo sem faixa não vale para conta nenhuma — e quem
  // digitou um esperava que valesse para alguma.
  if (a.emailPrefixoAlto && !(Number(a.emailFaixa) > 0))
    falta.push("a partir de qual conta vale o segundo começo de e-mail");
  return falta;
}

export function aplicarNoAmbiente(a = lerAjustes()) {
  for (const [campo, variavel] of Object.entries(NO_AMBIENTE)) {
    const v = a[campo];
    if (v == null) continue;
    // "" quer dizer "não configurei", exceto onde o vazio é a resposta.
    if (v === "" && !VAZIO_VALE.has(campo)) continue;
    process.env[variavel] = String(v);
  }
  // Este é ao contrário: o padrão é ligado, então o que se escreve é o
  // desligamento. `?? true` no PADRAO garante que só um "false" explícito
  // chega aqui.
  if (a.loginAutomatico === false) process.env.LOGIN_AUTOMATICO = "0";
  if (a.notificarCliente === true) process.env.NOTIFICAR_CLIENTE = "1";
  return a;
}
