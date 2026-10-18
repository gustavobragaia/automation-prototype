// Planilha do dia + rastreios colhidos -> fulfillment na Shopify.
//
//   node --env-file=.env run-shopify.mjs              # dry-run (padrão)
//   node --env-file=.env run-shopify.mjs --escrever   # escreve de verdade
//   node --env-file=.env run-shopify.mjs --notificar  # deixa a Shopify avisar o cliente
//
// A decisão mora em src/escrita.mjs — este arquivo é só a tela. O ciclo de
// produção (npm start) chama a MESMA função.

import { lerPendentes } from "./src/planilha.mjs";
import { lerColetas } from "./src/conciliar.mjs";
import { conexaoAtiva } from "./src/shopify-conexao.mjs";
import { identidadeDaLoja } from "./src/shopify.mjs";
import { escreverRastreios } from "./src/escrita.mjs";

const escrever = process.argv.includes("--escrever");
const notificar = process.argv.includes("--notificar");

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const ruim = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const aten = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const info = (m) => console.log(`    ${m}`);
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const conexao = conexaoAtiva();
if (!conexao?.loja) { ruim("nenhuma loja Shopify conectada — rode: npm run conectar"); process.exit(1); }

sec("1. Loja Shopify");
const loja = await identidadeDaLoja({ conexao });
ok(`"${loja.name}" · ${loja.myshopifyDomain} · modo ${conexao.modo}`);

sec("2. Planilha do dia × rastreios colhidos");
const r = await lerPendentes(process.env.PLANILHA, { aba: process.env.PLANILHA_ABA });
const coletas = lerColetas();
if (coletas.size === 0) { ruim("nenhuma coleta em captura/coletas/ — rode a coleta antes"); process.exit(1); }

const res = await escreverRastreios(r.contas, coletas, {
  escrever, notificar, conexao, aoLog: (m) => ok(m),
});

ok(`${res.resumo.casados} com rastreio · ${res.resumo.precisaDeVoce} precisam de você · ` +
   `${res.resumo.seResolveSozinho} aguardam a Shopee (de ${res.resumo.total})`);

sec(escrever ? "3. Escrita" : "3. Dry-run — use --escrever para valer");
if (!escrever) {
  info(`${res.planejado.length} fulfillment(s) seriam criados${notificar ? " com e-mail ao cliente" : " sem notificar o cliente"}`);
  for (const p of res.planejado)
    info(`${p.alvo.pedido} · ${p.alvo.nome} · ${p.codigos.map((c) => c.code ?? c).join(", ")}`);
} else {
  ok(`${res.escritos} escrito(s)`);
  if (res.falhas) ruim(`${res.falhas} falha(s)`);
}
if (res.pulados) info(`${res.pulados} pulado(s) — já escritos antes`);

if (res.pendencias.length) {
  sec("4. Para a conferência");
  const precisa = res.pendencias.filter((p) => p.motivo.grupo === "precisa");
  const sozinho = res.pendencias.filter((p) => p.motivo.grupo === "sozinho");
  for (const p of precisa) {
    aten(`${p.pedido} · conta ${p.conta} · ${p.nome}`);
    info(p.motivo.texto);
    info(p.motivo.acao);
    if (p.motivo.sugestoes) for (const s of p.motivo.sugestoes)
      info(`-> esse cliente aparece na conta ${s.conta}`);
  }
  if (sozinho.length) info(`\n${sozinho.length} aguardando a Shopee despachar (nada a fazer)`);
}
console.log();
