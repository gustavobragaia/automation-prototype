// Planilha do dia + rastreios colhidos na Shopee -> fulfillment na Shopify.
//
//   node --env-file=.env run-shopify.mjs              # dry-run (padrão)
//   node --env-file=.env run-shopify.mjs --escrever   # escreve de verdade
//   node --env-file=.env run-shopify.mjs --notificar  # deixa a Shopify avisar o cliente
//
// A planilha já diz QUAL pedido da Shopify é ("Pedido #164891"), então aqui
// não existe casamento por nome: o pedido é buscado pelo número. O nome só é
// usado para CONFERIR — se o nome na Shopify não bate com o da Shopee, não
// escreve. Rastreio no pedido errado é pior que rastreio ausente.

import { lerPendentes } from "./src/planilha.mjs";
import { lerColetas, conciliar, resolvido } from "./src/conciliar.mjs";
import { parseTracking } from "./src/tracking.mjs";
import { normNome } from "./src/match.mjs";
import { conexaoAtiva } from "./src/shopify-conexao.mjs";
import {
  pedidosPorNumero, normalizarNumero, montarEntrada, transportadoraDe, enviar, identidadeDaLoja,
} from "./src/shopify.mjs";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const escrever = process.argv.includes("--escrever");
const notificar = process.argv.includes("--notificar");

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const ruim = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const aten = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const info = (m) => console.log(`    ${m}`);
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

// ─── Registro de escritas: idempotência ──────────────────────────────────────
// Rodar duas vezes no mesmo dia não pode criar dois fulfillments.
const REGISTRO = "estado/escritas-shopify.json";
const registro = existsSync(REGISTRO) ? JSON.parse(readFileSync(REGISTRO, "utf8")) : {};
const gravarRegistro = () => {
  mkdirSync("estado", { recursive: true });
  writeFileSync(REGISTRO, JSON.stringify(registro, null, 2));
};

// ─── 1. Loja conectada ───────────────────────────────────────────────────────
const conexao = conexaoAtiva();
if (!conexao?.loja) {
  ruim("nenhuma loja Shopify conectada — rode: npm run conectar");
  process.exit(1);
}
sec("1. Loja Shopify");
const loja = await identidadeDaLoja({ conexao });
ok(`"${loja.name}" · ${loja.myshopifyDomain} · modo ${conexao.modo}`);

// ─── 2. Planilha e coletas ───────────────────────────────────────────────────
sec("2. Planilha do dia × rastreios colhidos");
const r = await lerPendentes(process.env.PLANILHA, { aba: process.env.PLANILHA_ABA });
const coletas = lerColetas();
if (coletas.size === 0) {
  ruim("nenhuma coleta em captura/coletas/ — rode a coleta antes");
  process.exit(1);
}
const { linhas, resumo } = conciliar(r.contas, coletas);
ok(`${resumo.casados} com rastreio · ${resumo.ambiguos} ambíguos · ${resumo.semCodigo} sem rastreio · ${resumo.naoAchados} não achados (de ${resumo.total})`);

const prontos = linhas.filter((l) => resolvido(l.estado) && normalizarNumero(l.p.pedido));
const semNumero = linhas.filter((l) => resolvido(l.estado) && !normalizarNumero(l.p.pedido));
if (semNumero.length) aten(`${semNumero.length} com rastreio mas sem número de pedido na planilha — fora desta rodada`);

// ─── 3. Buscar os pedidos na Shopify pelo número ─────────────────────────────
sec("3. Pedidos na Shopify");
const numeros = prontos.map((l) => normalizarNumero(l.p.pedido));
const naShopify = await pedidosPorNumero(numeros, { conexao });
ok(`${naShopify.size} de ${new Set(numeros).size} número(s) encontrado(s) na loja`);

// ─── 4. Conferência: só escreve o que passa em tudo ──────────────────────────
sec("4. Conferência");
const aEscrever = [];
for (const l of prontos) {
  const num = normalizarNumero(l.p.pedido);
  const rot = `${l.p.pedido} (conta ${l.conta})`;
  const alvo = naShopify.get(num);

  if (!alvo) { aten(`${rot}: não existe nessa loja — pulando`); continue; }
  if (registro[num]?.fulfillmentId) { info(`${rot}: já escrito antes (${registro[num].fulfillmentId}) — pulando`); continue; }
  if (alvo.situacao && alvo.situacao !== "UNFULFILLED") {
    info(`${rot}: já está ${alvo.situacao} na Shopify — pulando`);
    continue;
  }
  if (!alvo.fulfillmentOrderId) { aten(`${rot}: sem fulfillment order aberta — pulando`); continue; }

  // a conferência que importa: o destinatário é o mesmo nos dois lados?
  const nomeShopee = normNome(l.achado?.nome ?? l.p.nome);
  const nomeShopify = normNome(alvo.nome);
  if (nomeShopify && nomeShopee !== nomeShopify) {
    ruim(`${rot}: nome não confere — Shopee "${l.achado?.nome ?? l.p.nome}" vs Shopify "${alvo.nome}" — NÃO escrevendo`);
    continue;
  }

  const t = parseTracking(l.codigo.replace(/ · /g, " - "));
  if (!t.codes?.length) { aten(`${rot}: rastreio não reconhecido ("${l.codigo}") — pulando`); continue; }

  ok(`${rot} -> ${alvo.pedido} · ${alvo.nome} · ${t.codes.map((c) => c.code ?? c).join(", ")}`);
  aEscrever.push({ num, l, alvo, t });
}

// ─── 5. Escrita ──────────────────────────────────────────────────────────────
sec(escrever ? "5. Escrevendo na Shopify" : "5. Dry-run — use --escrever para valer");
if (!escrever) info(`${aEscrever.length} fulfillment(s) seriam criados${notificar ? " com e-mail ao cliente" : " sem notificar o cliente"}`);

let feitos = 0, falhas = 0;
for (const { num, l, alvo, t } of aEscrever) {
  const entrada = montarEntrada({
    fulfillmentOrderId: alvo.fulfillmentOrderId,
    codigos: t.codes,
    transportadora: transportadoraDe(t.codes),
    notificar,
  });

  if (!escrever) { info(`${alvo.pedido}: ${JSON.stringify(entrada.trackingInfo)}`); continue; }

  try {
    const f = await enviar(entrada, { conexao });
    ok(`${alvo.pedido}: ${f.status} · ${f.trackingInfo.map((x) => x.number).join(", ")}`);
    registro[num] = {
      fulfillmentId: f.id,
      pedido: alvo.pedido,
      conta: l.conta,
      codigos: f.trackingInfo.map((x) => x.number),
      em: new Date().toISOString(),
    };
    gravarRegistro();
    feitos++;
  } catch (e) {
    ruim(`${alvo.pedido}: ${e.message}`);
    falhas++;
  }
}

if (escrever) {
  sec("Resultado");
  ok(`${feitos} escrito(s)`);
  if (falhas) ruim(`${falhas} falha(s)`);
  info(`registro em ${REGISTRO}`);
}
console.log();
