// Progresso da escrita na Shopify — "não tem um loader nem nada" (Matheus,
// 21/10/2026). A escrita de um lote grande passa de um minuto e a tela só
// dizia "Escrevendo…". Agora ela avisa "Conferindo os pedidos na Shopify…" e
// depois cada pedido: "Escrevendo 8 de 40…", com quantos a Shopify recusou.
//
// A loja é de mentira: as chamadas GraphQL são interceptadas. Um dos pedidos é
// recusado pela Shopify, como acontece de verdade.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "esteira-escrita-"));
process.env.TRABALHO_DIR = dir; process.env.ESTADO_DIR = join(dir, "estado");
process.env.REGISTRO_ESCRITAS = join(dir, "escritas.json");

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
let tudo = true;

const N = 25;
const nomes = Array.from({ length: N }, (_, i) => `Cliente Teste ${String.fromCharCode(65 + i)}`);
const RECUSADO = "#1007";

let mutacoes = 0;
globalThis.fetch = async (url, opcoes = {}) => {
  const corpo = JSON.parse(opcoes.body ?? "{}");
  const resp = (data) => new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
  if (/fulfillmentCreateV2/.test(corpo.query)) {
    mutacoes++;
    const fo = corpo.variables.f.lineItemsByFulfillmentOrder[0].fulfillmentOrderId;
    if (fo.endsWith("/1007"))
      return resp({ fulfillmentCreateV2: { fulfillment: null, userErrors: [{ field: "x", message: "Pedido já foi cancelado" }] } });
    const t = corpo.variables.f.trackingInfo;
    return resp({ fulfillmentCreateV2: { userErrors: [], fulfillment: { id: "gid://F/" + mutacoes, status: "SUCCESS",
      trackingInfo: [{ number: t.number ?? t.numbers[0], url: "", company: t.company }] } } });
  }
  // busca por número: devolve os pedidos pedidos, sem rastreio
  const nums = [...String(corpo.variables.q).matchAll(/name:(\d+)/g)].map((m) => m[1]);
  return resp({ orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: nums.map((n) => ({
    name: "#" + n, id: "gid://O/" + n, createdAt: "2026-10-21T10:00:00Z", displayFulfillmentStatus: "UNFULFILLED",
    shippingAddress: { name: nomes[Number(n) - 1001], zip: "01310100" },
    totalPriceSet: { shopMoney: { amount: "20.00" } }, lineItems: { nodes: [{ title: "Produto", quantity: 1 }] },
    fulfillmentOrders: { nodes: [{ id: "gid://FO/" + n, status: "OPEN" }] },
  })) } });
};

const { escreverRastreios } = await import("../src/escrita.mjs");

const contas = [{ conta: 124, pedidos: nomes.map((nome, i) => ({ pedido: `Pedido #${1001 + i}`, nome, valor: 20 })) }];
const coletas = new Map([[124, nomes.map((nome, i) => ({ nome, valor: 20, codigos: [`BR26${String(1001 + i).padStart(10, "0")}X`] }))]]);

const passos = [];
const r = await escreverRastreios(contas, coletas, {
  escrever: true, conexao: { loja: "teste.myshopify.com", modo: "token-fixo", accessToken: "x" },
  aoProgresso: (p) => passos.push(p),
});

console.log("\n\x1b[1mEscrevendo um lote de 25 pedidos\x1b[0m");
tudo &= ok(passos[0]?.fase === "conferindo" && passos[0].total === N, `começa avisando "Conferindo os ${N} pedidos na Shopify"`);
const escrevendo = passos.filter((p) => p.fase === "escrevendo");
tudo &= ok(escrevendo.length === N + 1 && escrevendo[0].feitos === 0, `um aviso no começo e um a cada pedido (${escrevendo.length})`);
tudo &= ok(escrevendo.every((p, i) => p.feitos === i && p.total === N), "a contagem anda de 1 em 1, sem pular nem voltar");
const fim = escrevendo.at(-1);
tudo &= ok(fim.feitos === N && fim.escritos === N - 1 && fim.falhas === 1, `no fim: ${fim.escritos} escritos e ${fim.falhas} recusado pela Shopify`);
tudo &= ok(r.escritos === fim.escritos && r.falhas === fim.falhas, "o que a tela mostra é o mesmo que a escrita devolve");
const sem = await escreverRastreios(contas, coletas, { escrever: false, conexao: { loja: "teste.myshopify.com", modo: "token-fixo", accessToken: "x" },
  aoProgresso: () => { throw new Error("não devia avisar"); } });
tudo &= ok(sem.escritos === 0, "conferir sem escrever (etapa 4 montando a lista) não mostra progresso de escrita");

console.log(tudo ? "\n\x1b[32m\x1b[1m  progresso da escrita: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  progresso da escrita: FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
