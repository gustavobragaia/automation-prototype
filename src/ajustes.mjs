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

const ARQ = process.env.AJUSTES_ARQUIVO ?? emEstado("ajustes.json");

const PADRAO = {
  adspowerBase: "http://local.adspower.net:50325",
  adspowerChave: "",
  navegadores: null,      // null = usar a recomendação da máquina
  som: true,
  notificacao: true,
  escreverDireto: false,
  tema: "sistema",
};

// Lista fechada: o que a tela mandar fora disto é descartado, pra uma tela
// comprometida não conseguir plantar campo que outro pedaço do robô leia.
const CAMPOS = Object.keys(PADRAO);

export function lerAjustes() {
  try {
    const cru = JSON.parse(readFileSync(ARQ, "utf8"));
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
  mkdirSync(dirname(ARQ), { recursive: true });
  writeFileSync(ARQ, JSON.stringify(atual, null, 2));
  try { chmodSync(ARQ, 0o600); } catch {}
  return atual;
}

// O robô lê de process.env; os ajustes do app entram por aqui, sem sobrepor
// quem já definiu a variável de propósito (é assim que os testes isolam).
export function aplicarNoAmbiente(a = lerAjustes()) {
  if (a.adspowerChave) process.env.ADSPOWER_API_KEY ??= a.adspowerChave;
  if (a.adspowerBase) process.env.ADSPOWER_BASE ??= a.adspowerBase;
  return a;
}
