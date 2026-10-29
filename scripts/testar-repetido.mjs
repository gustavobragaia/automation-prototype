// O que o Matheus trouxe em 29/10/2026: "clico em Usar este e parece que
// não vai para a escrita".
//
// 1. O "Usar este" escreve na hora do clique; a etapa 4 agora lista à parte
//    o que a conferência escreveu hoje, para ele ver que foi.
// 2. Dois pedidos ficaram com o mesmo rastreio sem aviso nenhum. Agora o
//    rastreio que já foi para outro pedido para e pergunta; só escreve com
//    "Escrever mesmo assim".
//
// Loja de mentira; conta as escritas (mutations) para provar que o aviso
// chega ANTES de qualquer escrita.
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "esteira-repetido-"));
process.env.TRABALHO_DIR = dir; process.env.ESTADO_DIR = join(dir, "estado");
process.env.REGISTRO_ESCRITAS = join(dir, "escritas.json");
process.env.SHOPIFY_CONEXAO_ARQUIVO = join(dir, "conexao.json");
process.env.RECURSOS_DIR = fileURLToPath(new URL("..", import.meta.url));
writeFileSync(process.env.SHOPIFY_CONEXAO_ARQUIVO, JSON.stringify({ loja: "t.myshopify.com", modo: "token-fixo", accessToken: "x" }));

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

let mutacoes = 0;
globalThis.fetch = async (url, opcoes = {}) => {
  const corpo = JSON.parse(opcoes.body ?? "{}");
  const resp = (data) => new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
  if (/fulfillmentCreateV2/.test(corpo.query)) {
    mutacoes++;
    const t = corpo.variables.f.trackingInfo;
    const nums = t.numbers ?? [t.number];
    return resp({ fulfillmentCreateV2: { userErrors: [], fulfillment: { id: "gid://F/" + mutacoes, status: "SUCCESS",
      trackingInfo: nums.map((n) => ({ number: n, url: "", company: "Shopee Xpress" })) } } });
  }
  const nums = [...String(corpo.variables?.q ?? "").matchAll(/name:(\d+)/g)].map((m) => m[1]);
  return resp({ orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: nums.map((n) => ({
    name: "#" + n, id: "gid://O/" + n, createdAt: "2026-10-28T10:00:00Z", displayFulfillmentStatus: "UNFULFILLED",
    shippingAddress: { name: "Cliente Teste", zip: "01000000" }, totalPriceSet: { shopMoney: { amount: "1" } },
    lineItems: { nodes: [] }, fulfillmentOrders: { nodes: [{ id: "gid://FO/" + n, status: "OPEN" }] } })) } });
};

const { codigosJaUsados, resolverManual, prepararManual, escritosNaConferencia } = await import("../src/manual.mjs");
const { lerRegistro, gravarRegistro } = await import("../src/escrita.mjs");

const X = "BR2600000000011", Y = "BR260000000002Y", Z = "BR260000000003X";
const agora = new Date();
const ontem = new Date(agora.getTime() - 86_400_000);
gravarRegistro({
  "170420": { fulfillmentId: "gid://F/a", pedido: "#170420", codigos: [X], em: agora.toISOString(), origem: "manual" },
  "170500": { fulfillmentId: "gid://F/b", pedido: "#170500", codigos: [Z], em: agora.toISOString() },  // escrita em lote
  "170300": { fulfillmentId: "gid://F/c", pedido: "#170300", codigos: ["BR2600000000099"], em: ontem.toISOString(), origem: "manual" },
});

sec("1. o rastreio que já foi para outro pedido é achado");
{
  const r = codigosJaUsados([X], "Pedido #170422");
  tudo &= ok(r.length === 1 && r[0].codigo === X && r[0].pedido === "#170420", `achou: ${JSON.stringify(r)}`);
  tudo &= ok(codigosJaUsados([X], "#170420").length === 0, "o próprio pedido não conta como repetido");
  tudo &= ok(codigosJaUsados([Y], "#170422").length === 0, "código novo não é repetido");
  tudo &= ok(codigosJaUsados([Z], "#170422").length === 1, "vale também para o que a escrita em lote escreveu");
  const p = await prepararManual("Pedido #170422", X);
  tudo &= ok(p.ok && p.repetidos.length === 1, "\"Colei o rastreio\": a conferência mostra o aviso antes de escrever");
}

sec("2. \"Usar este\" com rastreio repetido: para e pergunta, sem escrever");
{
  const antes = mutacoes;
  const r = await resolverManual("Pedido #170422", X, { confirmado: true });
  tudo &= ok(r.ok === false && r.repetidos?.length === 1 && /já foi escrito no pedido #170420/.test(r.erro), `recusou: ${r.erro}`);
  tudo &= ok(mutacoes === antes, "nenhuma escrita na Shopify");
  tudo &= ok(!lerRegistro()["170422"], "e nada no registro");

  const s = await resolverManual("Pedido #170422", X, { confirmado: true, aceitarRepetido: true });
  tudo &= ok(s.ok && mutacoes === antes + 1, "\"Escrever mesmo assim\": escreve, uma vez");
  tudo &= ok(lerRegistro()["170422"]?.origem === "manual", "e fica no registro como da conferência");

  const n = await resolverManual("Pedido #170423", Y, { confirmado: true });
  tudo &= ok(n.ok && mutacoes === antes + 2, "rastreio novo escreve direto, sem perguntar");
}

sec("3. a ponte devolve a pergunta para a tela, não um erro");
{
  const { construir } = await import("../aplicativo/ponte.mjs");
  const ponte = construir({ aoLog: () => {} });
  const antes = mutacoes;
  const r = await ponte["conferencia:decidir"]({ pedido: "Pedido #170424", decisao: "colar", texto: Y });
  tudo &= ok(r.ok && r.dado?.precisaConfirmar && r.dado.repetidos[0].pedido === "#170423", `pergunta: ${JSON.stringify(r.dado)}`);
  tudo &= ok(mutacoes === antes, "sem escrever");
  const s = await ponte["conferencia:decidir"]({ pedido: "Pedido #170424", decisao: "colar", texto: Y, aceitarRepetido: true });
  tudo &= ok(s.ok && s.dado?.reversivel === false && mutacoes === antes + 1, "com a confirmação, escreve");
  const m = await ponte["manual:escrever"]({ pedido: "Pedido #170425", texto: X });
  tudo &= ok(m.ok && m.dado?.ok === false && m.dado.repetidos?.length >= 1, "o caminho manual também pergunta");
}

sec("4. a etapa 4 mostra o que a conferência escreveu hoje");
{
  const l = escritosNaConferencia();
  const peds = l.map((x) => x.pedido).sort().join(",");
  tudo &= ok(peds === "#170420,#170422,#170423,#170424", `de hoje e da conferência: ${peds}`);
  tudo &= ok(!l.some((x) => x.pedido === "#170500"), "a escrita em lote fica de fora (ela já tem a lista dela)");
  tudo &= ok(!l.some((x) => x.pedido === "#170300"), "o de ontem fica de fora");
  const d = Object.fromEntries(l.map((x) => [x.pedido, x.repetidoEm.sort().join(",")]));
  tudo &= ok(d["#170420"] === "#170422" && d["#170422"] === "#170420", "o par com o mesmo rastreio aparece marcado dos dois lados");
  tudo &= ok(d["#170423"] === "#170424", "e o outro par também");
}

console.log(tudo ? "\n\x1b[32m\x1b[1m  rastreio repetido e etapa 4: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
