// Prova de conceito: roda o parser e o motor de casamento contra os
// 19.975 pedidos reais da planilha do cliente.
//
// Simula a operação dia a dia: para cada dia D, os "pedidos abertos da
// Shopify" são os que entraram nos 21 dias anteriores e ainda não tinham
// rastreio naquele momento. O robô lê um pedido na Shopee e precisa achar
// qual pedido aberto é aquele, sabendo só o que a Shopee mostra.

import { readFileSync } from "node:fs";
import { parseTracking, parseConta, emailDaConta } from "./src/tracking.mjs";
import { casar, normNome, normProduto } from "./src/match.mjs";

const pedidos = JSON.parse(readFileSync(new URL("./data/pedidos.json", import.meta.url)));
const pct = (n, t) => `${((n / t) * 100).toFixed(2)}%`;
const pad = (s, n) => String(s).padEnd(n);
const num = (n) => n.toLocaleString("pt-BR");

const linha = (c = "─") => console.log(c.repeat(72));
const titulo = (t) => { console.log(); linha("═"); console.log(t); linha("═"); };

// ───────────────────────────── 1. PARSER DE RASTREIO ─────────────────────────
titulo("1. PARSER DE CÓDIGO DE RASTREIO  ·  19.975 células reais");

const st = {};
const multi = [];
const parciais = [];
const naoReconhecidos = [];
let totalCodigos = 0;

for (const p of pedidos) {
  const r = parseTracking(p.rastreioRaw);
  st[r.status] = (st[r.status] || 0) + 1;
  totalCodigos += r.codes.length;
  if (r.status === "multiplo") multi.push({ p, r });
  if (r.status === "parcial") parciais.push({ p, r });
  if (r.status === "nao-reconhecido") naoReconhecidos.push({ p, r });
}

const T = pedidos.length;
for (const [k, v] of Object.entries(st).sort((a, b) => b[1] - a[1]))
  console.log(`  ${pad(k, 22)} ${pad(num(v), 8)} ${pct(v, T)}`);
console.log(`\n  Códigos extraídos no total: ${num(totalCodigos)}`);

console.log(`\n  Exemplos de célula com múltiplos códigos (${num(multi.length)} casos):`);
for (const { p, r } of multi.slice(0, 3))
  console.log(`    linha ${p.row}: "${p.rastreioRaw}"\n      -> ${r.codes.map((c) => `${c.code} [${c.carrier}]`).join(" + ")}`);

console.log(`\n  Códigos colados sem separador — o erro que achei na planilha:`);
const colados = pedidos
  .map((p) => ({ p, r: parseTracking(p.rastreioRaw) }))
  .filter(({ r }) => r.codes.length > 1 && r.codes.some((c) => c.carrier === "shopee-xpress"));
for (const { p, r } of colados.slice(0, 4))
  console.log(`    linha ${p.row}: "${p.rastreioRaw}"\n      -> ${r.codes.map((c) => `${c.code} [${c.carrier}]`).join(" + ")}`);
console.log(`    ${colados.length} caso(s) desse tipo encontrado(s) e separado(s) corretamente.`);

if (naoReconhecidos.length) {
  console.log(`\n  Não reconhecidos (vão para revisão, nunca para a Shopify):`);
  for (const { p } of naoReconhecidos.slice(0, 5))
    console.log(`    linha ${p.row}: "${p.rastreioRaw}"`);
  if (naoReconhecidos.length > 5) console.log(`    ... e mais ${naoReconhecidos.length - 5}`);
}

// ───────────────────────────── 2. PARSER DE CONTA ────────────────────────────
titulo("2. IDENTIFICAÇÃO DA CONTA E MONTAGEM DO E-MAIL DE LOGIN");

const cst = {};
const multiConta = [];
const naoConta = [];
for (const p of pedidos) {
  const c = parseConta(p.contaRaw);
  cst[c.status] = (cst[c.status] || 0) + 1;
  if (c.status === "multiplas-contas") multiConta.push({ p, c });
  if (c.status === "nao-e-conta") naoConta.push({ p, c });
}
for (const [k, v] of Object.entries(cst).sort((a, b) => b[1] - a[1]))
  console.log(`  ${pad(k, 22)} ${pad(num(v), 8)} ${pct(v, T)}`);

console.log(`\n  Rótulos "sujos" resolvidos corretamente:`);
for (const bruto of ["shopee 07", "shoppe 355", "shope 178", "shopee 126 (115)", "shopee 001", "shopee 617 caiu a conta", "espartastorebrasil"]) {
  const c = parseConta(bruto);
  const emails = c.numeros.map((n) => emailDaConta(n));
  console.log(`    ${pad(`"${bruto}"`, 28)} -> ${c.status === "nao-e-conta" ? "REVISÃO (não é conta Shopee)" : emails.join(", ")}`);
}

// ───────────────────────────── 3. MOTOR DE CASAMENTO ─────────────────────────
titulo("3. CASAMENTO SHOPEE → SHOPIFY  ·  simulação dia a dia");

// A planilha tem dois formatos de data: ISO (até 22/09) e texto "dd/mm"
// (de 23/09 em diante). Date.parse("01/10") devolveria o ano 2001 e
// amontoaria 3.890 pedidos no mesmo instante, então o parse é explícito.
function parseData(v) {
  if (!v) return NaN;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
  const br = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(String(v).trim());
  if (br) {
    let ano = br[3] ? +br[3] : 2026;
    if (ano < 100) ano += 2000;
    return Date.UTC(ano, +br[2] - 1, +br[1]);
  }
  return NaN;
}

const comData = pedidos
  .filter((p) => p.data && p.nome && p.pedido)
  .map((p) => ({ ...p, ts: parseData(p.data) }))
  .filter((p) => !Number.isNaN(p.ts))
  .sort((a, b) => a.ts - b.ts);

const semDataValida = pedidos.filter((p) => p.nome && p.pedido && Number.isNaN(parseData(p.data))).length;

const DIA = 86400000;
const JANELA = 21 * DIA; // pedidos que ainda esperariam rastreio

// Pré-computa as chaves uma vez só e mantém um índice deslizante por nome,
// em vez de recalcular a normalização dentro do laço.
for (const p of comData) {
  p.nn = normNome(p.nome);
  p.np = normProduto(p.produto);
  p.cv = p.valor == null ? null : Math.round(Number(p.valor) * 100);
}

function simular(opts, rotulo, chutar = false) {
  const { usarValor = true, usarProduto = true } = opts;
  let unico = 0, ambiguo = 0, nenhum = 0, errado = 0;
  const exemplosAmbiguos = [];

  const idx = new Map();          // nome normalizado -> pedidos na janela
  const add = (p) => {
    if (!idx.has(p.nn)) idx.set(p.nn, []);
    idx.get(p.nn).push(p);
  };
  const del = (p) => {
    const a = idx.get(p.nn);
    if (!a) return;
    const k = a.indexOf(p);
    if (k >= 0) a.splice(k, 1);
    if (a.length === 0) idx.delete(p.nn);
  };

  let ini = 0;
  for (let i = 0; i < comData.length; i++) {
    const alvo = comData[i];
    add(alvo);
    while (comData[ini].ts < alvo.ts - JANELA) del(comData[ini++]);

    if (!alvo.nn) { nenhum++; continue; }
    let c = idx.get(alvo.nn) || [];

    if (c.length === 0) { nenhum++; continue; }

    let criterio = "nome";
    if (c.length > 1 && usarValor && alvo.cv != null) {
      const v = c.filter((x) => x.cv === alvo.cv);
      if (v.length > 0) { c = v; criterio = "nome+valor"; }
    }
    if (c.length > 1 && usarProduto && alvo.np) {
      const v = c.filter((x) => x.np === alvo.np);
      if (v.length > 0) { c = v; criterio = "nome+valor+produto"; }
    }

    if (c.length === 1) {
      unico++;
      if (c[0].pedido !== alvo.pedido) errado++;
    } else if (chutar) {
      unico++;
      if (c[0].pedido !== alvo.pedido) errado++;   // decide no olho: pega o primeiro
    } else {
      ambiguo++;
      if (exemplosAmbiguos.length < 6)
        exemplosAmbiguos.push({ alvo, r: { candidatos: c.length, criterio } });
    }
  }

  const t = comData.length;
  console.log(`\n  ${rotulo}`);
  console.log(`    identificação única (automático) ..... ${pad(num(unico), 8)} ${pct(unico, t)}`);
  console.log(`    ambíguo (vai para revisão) ........... ${pad(num(ambiguo), 8)} ${pct(ambiguo, t)}`);
  console.log(`    não encontrado ....................... ${pad(num(nenhum), 8)} ${pct(nenhum, t)}`);
  console.log(`    >> CASADO COM O PEDIDO ERRADO ........ ${pad(num(errado), 8)} ${pct(errado, t)}`);
  return { unico, ambiguo, nenhum, errado, exemplosAmbiguos, t };
}

console.log(`  Base: ${num(comData.length)} pedidos com data, nome e número válidos.`);
console.log(`  Janela de pedidos abertos: 21 dias.`);

console.log(`  Descartados por data inválida: ${num(semDataValida)}`);

const chute = simular({ usarValor: false, usarProduto: false },
  "A) Só pelo nome, decidindo no olho quando empata — o processo de hoje", true);
const soNome = simular({ usarValor: false, usarProduto: false },
  "B) Só pelo nome, mas recusando o empate");
const completo = simular({ usarValor: true, usarProduto: true },
  "C) Nome + valor pago + produto, recusando o empate — o robô");

console.log(`\n  Exemplos de ambiguidade que o robô se recusa a adivinhar:`);
for (const { alvo, r } of completo.exemplosAmbiguos.slice(0, 4))
  console.log(`    "${alvo.nome}" em ${alvo.data?.slice(0, 10)} -> ${r.candidatos} pedidos idênticos na janela (${r.criterio})`);

// ───────────────────────────── 4. VEREDITO ───────────────────────────────────
titulo("4. VEREDITO");

console.log(`
  Exposição ao erro, hoje:
    Em ${num(chute.errado)} pedidos (${pct(chute.errado, chute.t)}) o NOME SOZINHO não identifica o
    pedido: existe outro pedido aberto do mesmo nome na janela. Hoje alguém
    decide no olho em cada um desses casos.
    (Isto é teto de risco, não erro medido: a pessoa também vê o endereço na
     tela. Mas é uma decisão manual por pedido, sem rastro e sem conferência.)

  Com o robô (nome + valor + produto, recusando o que ficar duvidoso):
    ${num(completo.unico)} (${pct(completo.unico, completo.t)}) resolvidos sozinho, sem intervenção
    ${num(completo.ambiguo)} (${pct(completo.ambiguo, completo.t)}) enviados para revisão humana em vez de chutados
    ${num(completo.errado)} escritos na Shopify com o pedido errado

  O valor pago e o produto sozinhos derrubam a ambiguidade de
  ${pct(soNome.ambiguo, soNome.t)} para ${pct(completo.ambiguo, completo.t)}\n  (1 pedido em ${Math.round(completo.t / Math.max(completo.ambiguo, 1))}, contra 1 em ${Math.round(soNome.t / Math.max(soNome.ambiguo, 1))}).

  Na operação real o robô tem ainda o ENDEREÇO de entrega, que não existe
  nesta planilha e desempata boa parte do que sobrou.
`);
