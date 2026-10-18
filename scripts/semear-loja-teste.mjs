// Cria pedidos de verdade na LOJA DE TESTE a partir do que foi colhido na
// Shopee, e gera a planilha correspondente.
//
//   node --env-file=.env scripts/semear-loja-teste.mjs [quantos]
//
// Por que existe: a planilha do cliente aponta para pedidos #164871+ da loja
// REAL dele, que não existem na nossa loja de teste. O número do pedido na
// Shopify é sequencial e não dá para escolher. Então o caminho honesto é o
// inverso: criar os pedidos aqui, anotar os números que a Shopify deu e
// montar a planilha com ELES. Nome, valor, conta e rastreio continuam sendo
// os reais — só o número é da loja de teste.
//
// NÃO rode isso na loja do cliente.

import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";
import { lerPendentes } from "../src/planilha.mjs";
import { lerColetas, conciliar, resolvido } from "../src/conciliar.mjs";
import { conexaoAtiva } from "../src/shopify-conexao.mjs";

const quantos = Number(process.argv[2] ?? 5);

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const ruim = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m) => console.log(`    ${m}`);
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const conexao = conexaoAtiva();
if (!/teste/i.test(conexao?.loja ?? "")) {
  ruim(`a loja conectada é "${conexao?.loja}" e não parece ser de teste — abortando`);
  info("este script CRIA pedidos; não deve tocar na loja do cliente");
  process.exit(1);
}

const { tokenDaConexao } = await import("../src/shopify-conexao.mjs");
const token = await tokenDaConexao(conexao);
const VERSAO = process.env.SHOPIFY_API_VERSAO ?? "2026-04";

async function gql(query, variables) {
  const r = await fetch(`https://${conexao.loja}/admin/api/${VERSAO}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 400));
  return j.data;
}

const CRIAR = `
mutation criar($order: OrderCreateOrderInput!) {
  orderCreate(order: $order) {
    order { id name }
    userErrors { field message }
  }
}`;

// ─── O que semear ────────────────────────────────────────────────────────────
sec("1. Escolhendo pedidos reais já conciliados");
const r = await lerPendentes(process.env.PLANILHA_ORIGEM ?? process.env.PLANILHA, {
  aba: process.env.PLANILHA_ABA,
});
const { linhas } = conciliar(r.contas, lerColetas());
const alvos = linhas.filter((l) => resolvido(l.estado) && l.achado?.nome).slice(0, quantos);
if (!alvos.length) { ruim("nada conciliado para semear"); process.exit(1); }
ok(`${alvos.length} pedido(s), de ${new Set(alvos.map((a) => a.conta)).size} conta(s)`);

// ─── Criar na Shopify ────────────────────────────────────────────────────────
sec("2. Criando na loja de teste");
const criados = [];
for (const l of alvos) {
  const nome = l.achado.nome;
  const partes = nome.trim().split(/\s+/);
  const valor = (l.p.valor ?? l.achado.valor ?? 10).toFixed(2);

  const order = {
    email: "teste@exemplo.com",
    financialStatus: "PAID",
    shippingAddress: {
      firstName: partes[0],
      lastName: partes.slice(1).join(" ") || partes[0],
      address1: l.achado.endereco?.slice(0, 80) || "Rua de Teste, 100",
      city: "São Paulo",
      provinceCode: "SP",
      countryCode: "BR",
      zip: l.achado.cep || "01001000",
    },
    lineItems: [{
      title: l.p.produto || "Produto de teste",
      quantity: l.p.unidades || 1,
      requiresShipping: true,
      priceSet: { shopMoney: { amount: valor, currencyCode: "BRL" } },
    }],
  };

  try {
    const d = await gql(CRIAR, { order });
    const erros = d.orderCreate.userErrors ?? [];
    if (erros.length) { ruim(`${nome}: ${erros.map((e) => e.message).join("; ")}`); continue; }
    const o = d.orderCreate.order;
    ok(`${o.name} · ${nome} · R$ ${valor} · conta ${l.conta}`);
    criados.push({ numero: o.name, l, valor });
  } catch (e) {
    ruim(`${nome}: ${e.message}`);
  }
}
if (!criados.length) { ruim("nenhum pedido criado"); process.exit(1); }

// ─── Planilha correspondente ─────────────────────────────────────────────────
sec("3. Planilha com os números que a Shopify deu");
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("PEDIDOS");
ws.addRow(["DATA", "NÚMERO DO PEDIDO", "NOME DO CLIENTE", "PRODUTO", "UNIDADES",
           "VALOR PAGO", "CÓDIGO DE RASTREIO", "ONDE FOI FEITO O PEDIDO"]);
for (const { numero, l, valor } of criados)
  ws.addRow([
    new Date().toISOString().slice(0, 10),
    numero,                       // o número REAL da loja de teste
    l.achado.nome,
    l.p.produto ?? "",
    l.p.unidades ?? 1,
    Number(valor),
    "",                           // vazio: é o que o robô preenche
    `shopee ${l.conta}`,
  ]);

mkdirSync("saida", { recursive: true });
const arq = "saida/planilha-teste.xlsx";
await wb.xlsx.writeFile(arq);
ok(`${arq} · ${criados.length} linha(s)`);

sec("Agora");
info(`PLANILHA="${arq}" PLANILHA_ABA=PEDIDOS node --env-file=.env run-shopify.mjs`);
console.log();
