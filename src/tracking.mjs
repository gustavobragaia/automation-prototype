// Parser de códigos de rastreio.
// Lida com: código único, múltiplos códigos na mesma célula, códigos colados
// sem separador (Correios + Shopee Xpress), e texto que não é rastreio.

const CORREIOS = /[A-Z]{2}\d{9}BR/g;            // AN900000001BR
const SHOPEE_BR = /BR\d{12}[A-Z0-9]/g;          // BR260000000001M  (BR + 12 dígitos + 1 alfanum)
const SPX = /SPX[A-Z]{0,3}\d{6,}/g;             // SPXLM10000001

const NAO_RASTREIO = new Set([
  "entregue", "cancelado", "enviado", "ainda sem rastreio",
  "sem rastreio", "aguardando", "-", "x",
]);

export function parseTracking(raw) {
  if (raw == null) return { codes: [], status: "vazio", raw };

  const texto = String(raw).trim();
  if (!texto) return { codes: [], status: "vazio", raw };

  if (NAO_RASTREIO.has(texto.toLowerCase())) {
    return { codes: [], status: "texto-nao-rastreio", raw: texto };
  }

  const up = texto.toUpperCase();
  const codes = [];
  const marks = []; // [inicio, fim] do que já foi consumido

  const take = (re, carrier) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(up)) !== null) {
      const [ini, fim] = [m.index, m.index + m[0].length];
      if (marks.some(([a, b]) => ini < b && fim > a)) continue; // já consumido
      marks.push([ini, fim]);
      codes.push({ code: m[0], carrier });
    }
  };

  // ordem importa: o padrão mais específico primeiro
  take(SPX, "shopee-xpress");
  take(CORREIOS, "correios");
  take(SHOPEE_BR, "correios");

  if (codes.length === 0) {
    return { codes: [], status: "nao-reconhecido", raw: texto };
  }

  // sobrou texto relevante fora dos códigos? sinaliza para revisão
  let resto = up;
  for (const [a, b] of marks.sort((x, y) => y[0] - x[0])) {
    resto = resto.slice(0, a) + resto.slice(b);
  }
  const sujeira = resto.replace(/[\s\-/,;.|]+/g, "");

  codes.sort((a, b) => a.code.localeCompare(b.code));

  return {
    codes,
    status: sujeira ? "parcial" : codes.length > 1 ? "multiplo" : "ok",
    sobra: sujeira || undefined,
    raw: texto,
  };
}

// Normaliza o rótulo da conta ("shopee 07", "shoppe 355", "shopee 126 (115)")
// para o número da conta, e daí para o e-mail de login.
export function parseConta(raw) {
  if (raw == null) return { numeros: [], status: "vazio" };
  const texto = String(raw).trim();
  if (!texto) return { numeros: [], status: "vazio" };

  // aceita erros de digitação reais encontrados na base: shoppe, shope
  const re = /\bshop?p?ee?\s*0*(\d{1,4})/gi;
  const numeros = [];
  let m;
  while ((m = re.exec(texto)) !== null) numeros.push(Number(m[1]));

  if (numeros.length === 0) return { numeros: [], status: "nao-e-conta", raw: texto };
  return {
    numeros: [...new Set(numeros)],
    status: numeros.length > 1 ? "multiplas-contas" : "ok",
    raw: texto,
  };
}

// O prefixo muda com a faixa da conta, e isso custou duas tentativas de
// login recusadas: as contas abaixo de 200 são anteriores e usam outro
// prefixo. A senha sempre esteve certa; o endereço é que não.
//
//   conta  <  200  →  chompspee076@givmail.com
//   conta >=  200  →  Brushopee506@givmail.com
// Lido na hora, não na importação: os Ajustes do app chegam ao ambiente
// depois que os módulos já foram carregados.
export const FAIXA_PREFIXO = () => Number(process.env.SHOPEE_FAIXA_PREFIXO ?? 200);

// O padrão do e-mail das contas é do CLIENTE, não do produto: outro
// comprador do Esteira vai ter outro prefixo e outro domínio. Os valores
// abaixo continuam sendo os da Chomps por padrão, para nada mudar para
// quem já usa, mas agora saem dos Ajustes.
// Sem padrão: um padrão aqui seria o e-mail de OUTRO cliente, e o robô
// tentaria entrar com ele. Melhor estourar do que logar errado 80 vezes.
const PREFIXO_BAIXO = () => process.env.SHOPEE_PREFIXO ?? "";
const PREFIXO_ALTO = () => process.env.SHOPEE_PREFIXO_ALTO ?? "";
const DOMINIO = () => process.env.SHOPEE_EMAIL_DOMINIO ?? "";

export function prefixoDaConta(numero) {
  const alto = PREFIXO_ALTO();
  const faixa = FAIXA_PREFIXO();
  // Sem segundo prefixo, ou sem faixa, vale um começo só para todas as
  // contas. Uma faixa em zero faria `n >= 0` ser sempre verdade, e TODAS
  // as contas cairiam no segundo prefixo.
  if (!alto || !(faixa > 0)) return PREFIXO_BAIXO();
  return Number(numero) >= faixa ? alto : PREFIXO_BAIXO();
}

// Sem zero à esquerda: a conta 76 é chompspee76, não chompspee076 — foi
// conferido entrando na conta. O "007" que eu tinha assumido veio do nome
// do perfil no AdsPower ("Shopee 076"), que é outra coisa.
export function emailDaConta(numero, { digitos = Number(process.env.SHOPEE_DIGITOS ?? 0) } = {}) {
  if (!PREFIXO_BAIXO() || !DOMINIO())
    throw new Error("o e-mail das contas da Shopee não está configurado — " +
                    "Ajustes → Contas da Shopee");
  const n = digitos > 0 ? String(numero).padStart(digitos, "0") : String(Number(numero));
  return `${prefixoDaConta(numero)}${n}@${DOMINIO()}`;
}
