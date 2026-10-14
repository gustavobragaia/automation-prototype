// Ciclo completo sobre o pedido REAL coletado da Shopee:
//   extrai -> casa com os pedidos abertos da Shopify -> monta o fulfillment
//
// O código de rastreio é simulado enquanto o vendedor não despacha; todo o
// resto (nome, endereço, CEP, valor, produto, transportadora) é real.
//
//   node run-ciclo.mjs

import { readFileSync } from "node:fs";
import { extrairPedido } from "./src/shopee.mjs";
import { parseTracking } from "./src/tracking.mjs";
import { normNome } from "./src/match.mjs";
import { montarEntrada, transportadoraDe, enviar } from "./src/shopify.mjs";

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const aten = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const info = (m) => console.log(`    ${m}`);
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const RASTREIO_SIMULADO = "BR269999999999S";

const coleta = JSON.parse(readFileSync("captura/coleta.json", "utf8"));
const bruto = coleta.pedidos.find((p) => p.bruto)?.bruto;
if (!bruto) { console.error("sem detalhe de pedido em captura/coleta.json — rode a rodada antes"); process.exit(1); }

sec("1. Pedido lido da Shopee (dados reais)");
const pedido = extrairPedido(bruto, { orderId: coleta.pedidos[0].orderId });
for (const [k, v] of Object.entries(pedido))
  info(`${k.padEnd(16)} ${JSON.stringify(v)}`);

if (!pedido.despachado) {
  aten(`ainda não despachado (tracking_number vazio) — simulando ${RASTREIO_SIMULADO}`);
  pedido.codigos = [RASTREIO_SIMULADO];
}

sec("2. Parser de rastreio");
const t = parseTracking(pedido.codigos.join(" - "));
ok(`status "${t.status}" · ${t.codes.map((c) => `${c.code} [${c.carrier}]`).join(" + ")}`);

sec("3. Casamento com os pedidos abertos da Shopify");
// pedidos de teste: um homônimo com CEP diferente, para provar o desempate
const abertos = [
  { pedido: "#1001", fulfillmentOrderId: "gid://shopify/FulfillmentOrder/1001",
    nome: "Gustavo Bragaia", cep: "01310100", valor: 43.1, produto: "cilios" },
  { pedido: "#1002", fulfillmentOrderId: "gid://shopify/FulfillmentOrder/1002",
    nome: "Gustavo Bragaia", cep: "13424165", valor: 43.1, produto: "cilios" },
  { pedido: "#1003", fulfillmentOrderId: "gid://shopify/FulfillmentOrder/1003",
    nome: "Maria Souza", cep: "20040002", valor: 19.9, produto: "yang" },
];
info(`${abertos.length} pedidos abertos, sendo 2 homônimos "Gustavo Bragaia"`);

let c = abertos.filter((p) => normNome(p.nome) === normNome(pedido.nome));
info(`por nome ............ ${c.length} candidato(s)`);
let criterio = "nome";
if (c.length > 1 && pedido.cep) {
  const porCep = c.filter((p) => p.cep === pedido.cep);
  if (porCep.length) { c = porCep; criterio = "nome+cep"; }
  info(`por nome+CEP ........ ${c.length} candidato(s)`);
}

if (c.length !== 1) {
  aten(`ambíguo (${c.length}) — iria para revisão humana, sem escrever nada`);
  process.exit(0);
}
ok(`identificado: ${c[0].pedido} por ${criterio}`);
info(`o CEP ${pedido.cep} desempatou o homônimo — a planilha nunca teve esse dado`);

sec("4. Payload da Shopify (dry-run, nada é enviado)");
const entrada = montarEntrada({
  fulfillmentOrderId: c[0].fulfillmentOrderId,
  codigos: t.codes,
  transportadora: transportadoraDe(t.codes),
});
const r = await enviar(entrada, { dryRun: true });
console.log(JSON.stringify(r.enviaria.variables.f, null, 2));

sec("Resultado");
ok(`pedido Shopee ${pedido.orderId} -> Shopify ${c[0].pedido} -> ${t.codes.map((x) => x.code).join(", ")}`);
console.log(`  \x1b[33múnico dado simulado: o código de rastreio\x1b[0m`);
