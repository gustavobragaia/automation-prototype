// Ciclo real: estado da Shopee -> pedidos abertos da Shopify -> fulfillment.
//
//   node --env-file=.env run-final.mjs            # dry-run (padrão)
//   node --env-file=.env run-final.mjs --escrever # escreve de verdade
//
// notifyCustomer fica FALSO: é loja de teste, ninguém deve receber e-mail.

import { carregar, salvar } from "./src/estado.mjs";
import { parseTracking } from "./src/tracking.mjs";
import { normNome } from "./src/match.mjs";
import { pedidosAbertos, montarEntrada, transportadoraDe, enviar } from "./src/shopify.mjs";

const escrever = process.argv.includes("--escrever");
const SIMULADO = "BR269999999999S";

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const aten = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const info = (m) => console.log(`    ${m}`);
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const estado = carregar();
const daShopee = Object.values(estado);
sec(`1. Pedidos lidos da Shopee: ${daShopee.length}`);
for (const p of daShopee)
  info(`conta ${p.conta} · ${p.nome} · CEP ${p.cep} · R$ ${p.valor} · ${p.despachado ? p.codigos.join(",") : "sem rastreio ainda"}`);

sec("2. Pedidos abertos na Shopify");
const abertos = await pedidosAbertos({});
for (const o of abertos) info(`${o.pedido} · ${o.nome} · CEP ${o.cep} · R$ ${o.valor}`);

sec("3. Casamento");
const paraEnviar = [];
for (const p of daShopee) {
  if (p.enviadoShopify) { info(`${p.orderId}: já enviado antes, pulando`); continue; }

  let codigos = p.codigos ?? [];
  let simulado = false;
  if (codigos.length === 0) { codigos = [SIMULADO]; simulado = true; }

  let c = abertos.filter((o) => normNome(o.nome) === normNome(p.nome));
  let criterio = "nome";
  if (c.length > 1 && p.cep) {
    const porCep = c.filter((o) => o.cep === p.cep);
    if (porCep.length) { c = porCep; criterio = "nome+cep"; }
  }
  if (c.length > 1 && p.valor != null) {
    const porValor = c.filter((o) => Math.abs(o.valor - p.valor) < 0.01);
    if (porValor.length) { c = porValor; criterio += "+valor"; }
  }

  if (c.length !== 1) {
    aten(`${p.nome}: ${c.length} candidato(s) — REVISÃO, nada será escrito`);
    continue;
  }
  ok(`${p.nome} -> ${c[0].pedido} por ${criterio}${simulado ? "  \x1b[33m(rastreio simulado)\x1b[0m" : ""}`);
  paraEnviar.push({ p, alvo: c[0], t: parseTracking(codigos.join(" - ")), simulado });
}

sec(escrever ? "4. Escrevendo na Shopify" : "4. Dry-run (use --escrever para valer)");
for (const { p, alvo, t, simulado } of paraEnviar) {
  const entrada = montarEntrada({
    fulfillmentOrderId: alvo.fulfillmentOrderId,
    codigos: t.codes,
    transportadora: transportadoraDe(t.codes),
    notificar: false,
  });
  if (!escrever) { info(JSON.stringify(entrada.trackingInfo)); continue; }

  try {
    const f = await enviar(entrada, {});
    ok(`${alvo.pedido}: fulfillment ${f.id} · ${f.status} · ${f.trackingInfo.map((x) => x.number).join(", ")}`);
    estado[p.orderId].enviadoShopify = !simulado; // simulado não marca como feito
    estado[p.orderId].pedidoShopify = alvo.pedido;
    estado[p.orderId].unidades = alvo.unidades;
    if (simulado) estado[p.orderId].escritaSimulada = true;
  } catch (e) {
    console.log(`  \x1b[31m✗\x1b[0m ${alvo.pedido}: ${e.message}`);
  }
}
salvar(estado);
console.log();
