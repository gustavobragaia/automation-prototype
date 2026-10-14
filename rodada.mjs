// Rodada completa: varre as contas, coleta, grava o estado e escreve a planilha.
//
//   node --env-file=.env rodada.mjs                 # usa contas.json
//   node --env-file=.env rodada.mjs 2 7 196         # contas específicas
//
// Pré-requisito: o coletor precisa estar rodando (node coletor.mjs).

import { readFileSync, existsSync } from "node:fs";
import { rodarFila } from "./src/fila.mjs";
import { extrairPedido } from "./src/shopee.mjs";
import { carregar, salvar, registrar } from "./src/estado.mjs";
import { listarPerfisOuNull } from "./src/adspower.mjs";
import { parseConta } from "./src/tracking.mjs";

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const aten = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const falha = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m) => console.log(`    ${m}`);
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

// ── de onde vêm as contas ────────────────────────────────────────────
async function descobrirContas() {
  const args = process.argv.slice(2);
  if (args.length) return args.map((a) => ({ serial: Number(a), conta: Number(a) }));

  if (existsSync("contas.json")) {
    const c = JSON.parse(readFileSync("contas.json", "utf8"));
    info(`${c.length} contas lidas de contas.json`);
    return c;
  }

  // no plano pago do cliente, o próprio AdsPower lista os 700 perfis
  const lista = await listarPerfisOuNull(1, 500);
  if (!lista) throw new Error("sem contas.json e user/list indisponível (plano free) — passe os seriais como argumento");
  return lista.list
    .map((p) => ({ userId: p.user_id, conta: parseConta(p.name).numeros[0] }))
    .filter((c) => c.conta != null);
}

const contas = await descobrirContas();
sec(`Rodada · ${contas.length} conta(s)`);

// checagem de sanidade: coletor no ar? sem ele a rodada seria vazia e
// pareceria "nenhum pedido novo"
try {
  await fetch("http://127.0.0.1:3000/captura", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo: "ping" }),
    signal: AbortSignal.timeout(3000),
  });
  ok("coletor respondendo em 127.0.0.1:3000");
} catch {
  falha("coletor não está rodando — abra outro terminal e rode: node coletor.mjs");
  process.exit(1);
}

const t0 = Date.now();
const resultados = await rodarFila(contas, {
  concorrencia: Number(process.env.CONCORRENCIA ?? 3),
  aoLog: (m) => info(m),
});

sec("Consolidando");
const estado = carregar();
let novos = 0, despachados = 0;

for (const r of resultados.filter((x) => x.ok)) {
  const pacote = JSON.parse(readFileSync(r.arq, "utf8"));
  for (const p of pacote.pedidos ?? []) {
    if (!p.bruto) continue;
    const pedido = extrairPedido(p.bruto, { orderId: p.orderId });
    const antes = estado[pedido.orderId];
    registrar(estado, r.conta, pedido);
    if (!antes) novos++;
    if (pedido.despachado) despachados++;
  }
}
salvar(estado);

const falhas = resultados.filter((x) => !x.ok);
ok(`${resultados.length - falhas.length}/${contas.length} contas coletadas em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
ok(`${Object.keys(estado).length} pedidos no estado · ${novos} novo(s) · ${despachados} já despachado(s)`);
if (falhas.length) {
  aten(`${falhas.length} conta(s) falharam — vão para a próxima rodada:`);
  for (const f of falhas) info(`conta ${f.conta}: ${f.erro}`);
}
console.log("\n  Para gerar a planilha:  node escrever-planilha.mjs\n");
