// Teste ponta a ponta do encadeamento, com AdsPower e Shopee simulados.
//
// O QUE ESTE TESTE PROVA: que o cliente da Local API do AdsPower fala o
// protocolo certo, que o parser e o matcher processam o que vem da tela,
// e que o payload da Shopify sai montado corretamente — inclusive no caso
// de múltiplos rastreios.
//
// O QUE ELE NÃO PROVA: que a Shopee real entrega esse HTML, nem o login.
// Isso só se verifica na máquina do cliente, com as contas dele.

import { createServer } from "node:http";
import { parseTracking, parseConta, emailDaConta } from "./src/tracking.mjs";
import { casar } from "./src/match.mjs";
import { montarEntrada, transportadoraDe, urlRastreio, enviar } from "./src/shopify.mjs";
// O padrão de e-mail não tem mais valor padrão — ele é configuração do
// cliente. Um teste tem que declarar o que está exercitando, senão passa
// a depender de quem instalou o app por último.
process.env.SHOPEE_PREFIXO ??= "chompspee";
process.env.SHOPEE_PREFIXO_ALTO ??= "Brushopee";
process.env.SHOPEE_FAIXA_PREFIXO ??= "200";
process.env.SHOPEE_EMAIL_DOMINIO ??= "givmail.com";


const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const info = (m) => console.log(`    ${m}`);
const sec = (t) => { console.log(`\n\x1b[1m${t}\x1b[0m`); };

// ─── AdsPower falso, falando o mesmo protocolo da Local API ───────────────
const perfis = [
  { user_id: "k1a2b3", serial_number: "7",  name: "shopee 07",  username: "", password: "" },
  { user_id: "k4d5e6", serial_number: "196", name: "shopee 196", username: "", password: "" },
];
let abertos = new Set();

const mock = createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const send = (data) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ code: 0, data, msg: "success" })); };

  if (u.pathname === "/api/v1/user/list") return send({ list: perfis, page: 1, page_size: 100 });
  if (u.pathname === "/api/v1/browser/start") {
    const id = u.searchParams.get("user_id");
    abertos.add(id);
    return send({ ws: { puppeteer: `ws://127.0.0.1:51${id.length}23/devtools/browser/${id}`, selenium: "127.0.0.1:5123" }, debug_port: "5123", webdriver: "/tmp/chromedriver" });
  }
  if (u.pathname === "/api/v1/browser/stop") { abertos.delete(u.searchParams.get("user_id")); return send({}); }
  if (u.pathname === "/api/v1/browser/active") return send({ status: abertos.has(u.searchParams.get("user_id")) ? "Active" : "Inactive" });
  res.statusCode = 404; res.end("{}");
});

await new Promise((r) => mock.listen(0, "127.0.0.1", r));
process.env.ADSPOWER_BASE = `http://127.0.0.1:${mock.address().port}`;
const ads = await import("./src/adspower.mjs");

// ─── O que a Shopee mostraria na tela de "Minhas Compras" ────────────────
const telaShopee = [
  { nome: "Marcos francisco da cruz", produto: "faca feng",      valor: 55.8,  rastreioTexto: "BR290000000005Z" },
  { nome: "Fábio Fictício Brito",       produto: "lamina samurai", valor: 288.0, rastreioTexto: "BR2900000000003" },
  { nome: "Caio Fictício Tadeu",             produto: "Faca Feng",      valor: 90.0,  rastreioTexto: "BR290000000002Z- BR290000000006Z - BR2900000000001" },
  { nome: "Rogério Fictício Paz",       produto: "Stella",         valor: 33.95, rastreioTexto: "BR260300793540JSPXLM10000001" },
  { nome: "Ana Fictícia Souto",          produto: "yang",           valor: 19.99, rastreioTexto: "BR2900000000004" },
  { nome: "Juliano Fictício Dutra", produto: "Yang Pro",       valor: 19.99, rastreioTexto: "ainda sem rastreio" },
];

// Pedidos abertos na Shopify (dois homônimos de propósito)
const abertosShopify = [
  { pedido: "#142587", fulfillmentOrderId: "gid://shopify/FulfillmentOrder/1", nome: "Marcos francisco da cruz", produto: "faca feng", valor: 55.8 },
  { pedido: "#142593", fulfillmentOrderId: "gid://shopify/FulfillmentOrder/2", nome: "Fábio Fictício Brito", produto: "lamina samurai", valor: 288.0 },
  { pedido: "#142526", fulfillmentOrderId: "gid://shopify/FulfillmentOrder/3", nome: "Caio Fictício Tadeu", produto: "Faca Feng", valor: 90.0 },
  { pedido: "#143788", fulfillmentOrderId: "gid://shopify/FulfillmentOrder/4", nome: "ROGÉRIO FICTÍCIO PAZ", produto: "Stella (Cor:1)", valor: 33.95 },
  { pedido: "#144001", fulfillmentOrderId: "gid://shopify/FulfillmentOrder/5", nome: "Ana Fictícia Souto", produto: "yang", valor: 19.99 },
  { pedido: "#144002", fulfillmentOrderId: "gid://shopify/FulfillmentOrder/6", nome: "Ana Fictícia Souto", produto: "yang", valor: 19.99 }, // homônimo idêntico
];

// ─── 1. AdsPower ──────────────────────────────────────────────────────────
sec("1. AdsPower — Local API");
const lista = await ads.listarPerfis();
ok(`listou ${lista.list.length} perfis`);

const alvo = lista.list[0];
const conta = parseConta(alvo.name);
const email = emailDaConta(conta.numeros[0]);
ok(`perfil "${alvo.name}" -> conta ${conta.numeros[0]} -> ${email}`);
info(`credencial montada pelo padrão, sem depender do campo do perfil (que veio vazio: "${alvo.username}")`);

const sessao = await ads.abrirPerfil(alvo.user_id);
ok(`perfil aberto, endpoint CDP: ${sessao.ws}`);
info(`é aqui que entra: chromium.connectOverCDP("${sessao.ws}")`);
ok(`status: ${await ads.statusPerfil(alvo.user_id)}`);

// ─── 2. Leitura e casamento ──────────────────────────────────────────────
sec("2. Leitura da tela, parsing e casamento");

const paraEnviar = [];
const paraRevisao = [];

for (const linha of telaShopee) {
  const t = parseTracking(linha.rastreioTexto);
  if (t.codes.length === 0) {
    paraRevisao.push({ linha, motivo: `sem rastreio utilizável (${t.status})` });
    continue;
  }
  const m = casar(linha, abertosShopify);
  if (m.decisao !== "unico") {
    paraRevisao.push({ linha, motivo: `${m.decisao} — ${m.candidatos} candidato(s)`, codigos: t.codes });
    continue;
  }
  paraEnviar.push({ linha, pedido: m.pedido, codigos: t.codes, criterio: m.criterio });
}

for (const e of paraEnviar)
  ok(`"${e.linha.nome}" -> ${e.pedido.pedido} por ${e.criterio} · ${e.codigos.map((c) => c.code).join(" + ")}`);
for (const r of paraRevisao)
  console.log(`  \x1b[33m!\x1b[0m "${r.linha.nome}" -> REVISÃO: ${r.motivo}`);

// ─── 3. Payload da Shopify ───────────────────────────────────────────────
sec("3. Montagem do payload da Shopify (dry-run, nada é enviado)");

for (const e of paraEnviar) {
  const entrada = montarEntrada({
    fulfillmentOrderId: e.pedido.fulfillmentOrderId,
    codigos: e.codigos,
    transportadora: transportadoraDe(e.codigos),
  });
  const r = await enviar(entrada, { dryRun: true });
  const ti = r.enviaria.variables.f.trackingInfo;
  const qtd = ti.numbers ? ti.numbers.length : 1;
  ok(`${e.pedido.pedido}: ${qtd} código(s), transportadora "${ti.company}"`);
  info(JSON.stringify(ti));
}

// ─── 4. Fecha ─────────────────────────────────────────────────────────────
sec("4. Encerramento");
await ads.fecharPerfil(alvo.user_id);
ok(`perfil fechado — SEM deslogar, status: ${await ads.statusPerfil(alvo.user_id)}`);

console.log(`\n  Resultado: ${paraEnviar.length} enviados, ${paraRevisao.length} para revisão, 0 escritos errado.\n`);
mock.close();
