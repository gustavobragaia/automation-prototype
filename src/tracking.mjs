// Parser de códigos de rastreio.
// Lida com: código único, múltiplos códigos na mesma célula, códigos colados
// sem separador (Correios + Shopee Xpress), e texto que não é rastreio.

const CORREIOS = /[A-Z]{2}\d{9}BR/g;            // AN939151363BR
const SHOPEE_BR = /BR\d{12}[A-Z0-9]/g;          // BR268454876848M  (BR + 12 dígitos + 1 alfanum)
const SPX = /SPX[A-Z]{0,3}\d{6,}/g;             // SPXLM17485496

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

export function emailDaConta(numero, { digitos = 3 } = {}) {
  return `Brushopee${String(numero).padStart(digitos, "0")}@givmail.com`;
}
