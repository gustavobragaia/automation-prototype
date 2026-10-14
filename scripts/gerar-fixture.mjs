// Gera data/pedidos.json SINTÉTICO, reproduzindo as patologias reais
// encontradas na planilha do cliente, sem nenhum dado pessoal verdadeiro.
//
// Permite rodar run-proof.mjs em qualquer máquina, inclusive em CI.
//
//   node scripts/gerar-fixture.mjs [quantidade]

import { writeFileSync, mkdirSync } from "node:fs";

const N = Number(process.argv[2] ?? 20000);

// gerador determinístico, para o fixture ser reprodutível
// mulberry32: um LCG ingênuo em JS perde precisão (seed * 1103515245 passa
// de 2^53) e a sequência degenera, repetindo poucos valores.
let seed = 42 >>> 0;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const NOMES = ["Jose", "Maria", "Antonio", "Francisco", "Carlos", "Paulo", "Ana", "Marcos",
  "Luiz", "Marcelo", "Rafael", "Daniel", "Bruno", "Rogerio", "Sandra", "Patricia", "Joao",
  "Pedro", "Lucas", "Gabriel", "Mateus", "Felipe", "Rodrigo", "Eduardo", "Fernando", "Ricardo",
  "Sergio", "Andre", "Juliana", "Camila", "Fernanda", "Aline", "Bianca", "Leticia", "Vanessa",
  "Cristina", "Simone", "Adriana", "Renata", "Priscila", "Tatiane", "Jefferson", "Wesley",
  "Alexandre", "Leandro", "Gustavo", "Thiago", "Vinicius", "Douglas", "Everton"];
const SOBRE = ["Silva", "Santos", "Oliveira", "Souza", "Costa", "Pereira", "Lima", "Gomes",
  "Ribeiro", "Alves", "Barbosa", "Rocha", "Dias", "Nunes", "Carvalho", "Martins", "Araujo",
  "Melo", "Cardoso", "Teixeira", "Correia", "Fernandes", "Moreira", "Monteiro", "Freitas",
  "Cavalcante", "Vieira", "Machado", "Azevedo", "Campos", "Lopes", "Pinto", "Moura", "Caldeira",
  "Furtado", "Peixoto", "Siqueira", "Andrade", "Macedo", "Borges", "Figueiredo", "Tavares",
  "Castro", "Duarte", "Nogueira", "Guimaraes", "Sampaio", "Bastos", "Xavier", "Rezende"];
const PRODUTOS = ["serrote saw", "lamina samurai", "faca feng", "tesoura inox", "mini faca milit",
  "Yang Pro", "Stella (Cor:1)", "Bling", "wing"];

const letra = () => "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[int(0, 35)];
const codCorreios = () => `BR26${String(int(0, 99999999999)).padStart(11, "0")}${letra()}`;
const codSpx = () => `SPXLM${int(10000000, 99999999)}`;

// A base real tem 16.231 nomes distintos em ~19.9 mil linhas: a maioria
// aparece uma vez só, e cerca de 14% se repetem. O fixture reproduz essa
// proporção — se os nomes colidirem demais, a medição de ambiguidade mente.
const MEIO = ["", "da", "de", "do", "dos", "das"];
function poolDeNomes(qtd) {
  const vistos = new Set();
  let voltas = 0;
  while (vistos.size < qtd) {
    if (++voltas > qtd * 60) throw new Error(`espaço de nomes pequeno demais: ${vistos.size}/${qtd}`);
    const m = pick(MEIO);
    vistos.add(`${pick(NOMES)} ${m ? m + " " : ""}${pick(SOBRE)} ${pick(SOBRE)}${rnd() < 0.3 ? " " + pick(SOBRE) : ""}`);
  }
  return [...vistos];
}

// 81,3% de nomes únicos, como na base real
const UNICOS = Math.round(N * 0.813);
const pool = poolDeNomes(UNICOS);
const nomesAtribuidos = [...pool];
while (nomesAtribuidos.length < N) nomesAtribuidos.push(pick(pool));
// embaralha para as repetições não ficarem todas no fim
for (let i = nomesAtribuidos.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [nomesAtribuidos[i], nomesAtribuidos[j]] = [nomesAtribuidos[j], nomesAtribuidos[i]];
}

const INICIO = Date.UTC(2026, 2, 13);
const out = [];

for (let i = 0; i < N; i++) {
  const dia = Math.floor((i / N) * 193);
  const ts = INICIO + dia * 86400000;
  const d = new Date(ts);

  // 20% das linhas usam data em texto dd/mm, como na planilha real
  const data = rnd() < 0.2
    ? `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    : d.toISOString().replace("Z", "");

  // rastreio, com a mesma distribuição de defeitos da base real
  const r = rnd();
  let rastreio;
  if (r < 0.05) rastreio = null;                                   // 5% vazio
  else if (r < 0.052) rastreio = pick(["entregue", "cancelado", "SEM ACESSO", "ainda sem rastreio"]);
  else if (r < 0.057) rastreio = `${codCorreios()}${codSpx()}`;     // colados sem separador
  else if (r < 0.077) rastreio = Array.from({ length: int(2, 3) }, codCorreios).join(" - ");
  else rastreio = codCorreios();

  // rótulo da conta, com os erros de digitação reais
  const n = int(1, 999);
  const c = rnd();
  let conta;
  if (c < 0.044) conta = null;
  else if (c < 0.046) conta = pick(["espartastorebrasil", "site terceiro"]);
  else if (c < 0.049) conta = `${pick(["shoppe", "shope"])} ${n}`;
  else if (c < 0.051) conta = `shopee ${n} e shopee ${int(1, 999)}`;
  else conta = `shopee ${n < 10 ? "0" + n : n}`;

  out.push({
    row: i + 2,
    data,
    pedido: `Pedido #${142584 + i}`,
    nome: nomesAtribuidos[i],
    produto: pick(PRODUTOS),
    unidades: int(1, 6),
    valor: Math.round((10 + rnd() * 290) * 100) / 100,
    rastreioRaw: rastreio,
    contaRaw: conta,
  });
}

mkdirSync("data", { recursive: true });
writeFileSync("data/pedidos.json", JSON.stringify(out));
console.log(`${out.length} pedidos sintéticos gravados em data/pedidos.json`);
console.log(`${new Set(out.map((o) => o.nome)).size} nomes distintos (${((new Set(out.map((o) => o.nome)).size / out.length) * 100).toFixed(1)}%)`);
console.log("Nenhum dado pessoal real. Para usar a planilha de verdade: scripts/importar-planilha.mjs");
