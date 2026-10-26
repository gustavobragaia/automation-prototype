// O link de rastreio no pedido — Chomps, 26/10/2026.
//
// O link dos Correios que o robô punha (rastreamento.correios.com.br/app/
// index.php?objeto=) parou de funcionar: mostra o formulário vazio com
// captcha. E nem era a transportadora: BR26… é da Shopee Express. A Chomps
// pediu o parcelsapp (https://parcelsapp.com/pt/tracking).
//
// Aqui: o link e a transportadora de cada tipo de código; o campo de Ajustes
// chegando ao robô; a escrita (lote e "colei o rastreio") mandando o link
// novo; e a correção dos pedidos já escritos, contra uma Shopify de mentira
// que se comporta como a de verdade se comportou na loja de teste: ATUALIZAR
// SUBSTITUI o rastreio inteiro (mandar 1 de 2 códigos apaga o outro).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "esteira-link-"));
process.env.TRABALHO_DIR = dir; process.env.ESTADO_DIR = join(dir, "estado");
process.env.REGISTRO_ESCRITAS = join(dir, "escritas.json");
process.env.SHOPIFY_CONEXAO_ARQUIVO = join(dir, "conexao.json");
process.env.AJUSTES_ARQUIVO = join(dir, "ajustes.json");
delete process.env.LINK_RASTREIO;
writeFileSync(process.env.SHOPIFY_CONEXAO_ARQUIVO, JSON.stringify({ loja: "t.myshopify.com", modo: "token-fixo", accessToken: "x" }));

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

const { urlRastreio, transportadoraDe, montarEntrada } = await import("../src/shopify.mjs");
const { parseTracking } = await import("../src/tracking.mjs");
const P = (c) => `https://parcelsapp.com/pt/tracking/${c}`;

sec("1. Link e transportadora de cada código");
{
  tudo &= ok(urlRastreio("BR2620456593785") === P("BR2620456593785"), "BR26 (Shopee Express): parcelsapp");
  tudo &= ok(urlRastreio("SPXLM17442804") === P("SPXLM17442804"), "SPX: parcelsapp");
  tudo &= ok(urlRastreio("AN900000001BR") === P("AN900000001BR"), "Correios de verdade: parcelsapp também");
  tudo &= ok(transportadoraDe(parseTracking("BR2620456593785").codes) === "Shopee Xpress",
    "o código lido da planilha/coleta (com rótulo) também vira Shopee Xpress — antes: Correios");
  tudo &= ok(transportadoraDe(parseTracking("BR2620456593785 - SPXLM17442804").codes) === "Shopee Xpress", "BR26 com SPX: Shopee Xpress");
  tudo &= ok(transportadoraDe(parseTracking("AN900000001BR").codes) === "Correios", "AN900000001BR: Correios");
  tudo &= ok(transportadoraDe(parseTracking("AN900000001BR BR2620456593785").codes) === "Outros", "Correios + Shopee: Outros");
  const e = montarEntrada({ fulfillmentOrderId: "gid://1", codigos: ["BR2620456593785", "SPXLM17442804"], transportadora: "Shopee Xpress" });
  tudo &= ok(e.trackingInfo.urls.join() === [P("BR2620456593785"), P("SPXLM17442804")].join(), "vários códigos: um link para cada, na mesma ordem");
}

sec("2. O campo \"Link de rastreio\" em Ajustes");
{
  const { salvarAjustes, aplicarNoAmbiente } = await import("../src/ajustes.mjs");
  // o Matheus colou o endereço SEM o código: tem que funcionar assim
  aplicarNoAmbiente(salvarAjustes({ linkRastreio: "  https://parcelsapp.com/pt/tracking/  " }));
  tudo &= ok(urlRastreio("BR2620456593785") === P("BR2620456593785"), "endereço puro (com barra e espaço no fim): o código vai no fim");
  aplicarNoAmbiente(salvarAjustes({ linkRastreio: "https://rastreio.exemplo.com/busca?codigo={codigo}&pais=br" }));
  tudo &= ok(urlRastreio("BR2620456593785") === "https://rastreio.exemplo.com/busca?codigo=BR2620456593785&pais=br", "com {codigo}: entra onde está escrito");
  aplicarNoAmbiente(salvarAjustes({ linkRastreio: "" }));
  tudo &= ok(urlRastreio("BR2620456593785") === P("BR2620456593785"), "apagar o campo volta para o parcelsapp (não fica o último link)");
  for (const ruim of ["parcelsapp.com/pt/tracking", "http://parcelsapp.com/pt/tracking", "https://parcels app.com", "javascript:alert(1)"]) {
    let erro = null; try { salvarAjustes({ linkRastreio: ruim }); } catch (e) { erro = e; }
    tudo &= ok(/https:\/\//.test(erro?.message ?? ""), `recusa "${ruim}" ao salvar, dizendo por quê`);
  }
  tudo &= ok(urlRastreio("X1") === P("X1"), "e o link recusado não chega ao robô");
}

// ── uma Shopify de mentira, com o comportamento medido na loja de teste ──
const loja = new Map();     // fulfillmentId -> { status, pedido, trackingInfo: [...] }
let atualizacoes = 0, criacoes = [], throttleNa = 0;
globalThis.fetch = async (url, opcoes = {}) => {
  const corpo = JSON.parse(opcoes.body ?? "{}");
  const q = corpo.query ?? "", v = corpo.variables ?? {};
  const resp = (data) => new Response(JSON.stringify({ data }), { status: 200 });
  if (/fulfillmentTrackingInfoUpdate/.test(q)) {
    if (throttleNa && ++atualizacoes === throttleNa)
      return new Response(JSON.stringify({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }), { status: 200 });
    if (!throttleNa) atualizacoes++;
    const f = loja.get(v.id), t = v.t;
    const nums = t.numbers ?? [t.number], urls = t.urls ?? (t.url ? [t.url] : []);
    f.trackingInfo = nums.map((n, i) => ({ number: n, url: urls[i] ?? null, company: t.company }));   // SUBSTITUI tudo
    return resp({ fulfillmentTrackingInfoUpdate: { userErrors: [], fulfillment: { id: v.id, trackingInfo: f.trackingInfo } } });
  }
  if (/nodes\(ids/.test(q))
    return resp({ nodes: v.ids.map((id) => { const f = loja.get(id); return f ? { id, status: f.status, order: { name: f.pedido }, trackingInfo: f.trackingInfo } : null; }) });
  if (/fulfillmentCreateV2/.test(q)) {
    criacoes.push(v.f.trackingInfo);
    return resp({ fulfillmentCreateV2: { userErrors: [], fulfillment: { id: "gid://F/novo" + criacoes.length, status: "SUCCESS",
      trackingInfo: (v.f.trackingInfo.numbers ?? [v.f.trackingInfo.number]).map((n) => ({ number: n, url: "", company: v.f.trackingInfo.company })) } } });
  }
  const nums = [...String(v.q ?? "").matchAll(/name:(\d+)/g)].map((m) => m[1]);
  return resp({ orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: nums.map((n) => ({
    name: "#" + n, id: "gid://O/" + n, displayFulfillmentStatus: "UNFULFILLED",
    shippingAddress: { name: "Cliente Teste", zip: "01000000" }, totalPriceSet: { shopMoney: { amount: "1" } },
    lineItems: { nodes: [] }, fulfillmentOrders: { nodes: [{ id: "gid://FO/" + n, status: "OPEN" }] } })) } });
};

sec("3. A escrita manda o link novo (lote e \"colei o rastreio\")");
{
  const { escreverRastreios } = await import("../src/escrita.mjs");
  const conexao = { loja: "t.myshopify.com", modo: "token-fixo", accessToken: "x" };
  await escreverRastreios([{ conta: 1, pedidos: [{ pedido: "Pedido #170001", nome: "Cliente Teste", valor: 10 }] }],
    new Map([[1, [{ nome: "Cliente Teste", valor: 10, codigos: ["BR2620456593785"], cep: "01000000" }]]]), { escrever: true, conexao });
  tudo &= ok(criacoes[0]?.url === P("BR2620456593785") && criacoes[0]?.company === "Shopee Xpress",
    `lote: ${criacoes[0]?.company} · ${criacoes[0]?.url}`);
  const { resolverManual } = await import("../src/manual.mjs");
  const { guardarPendentes } = await import("../src/estado.mjs");
  guardarPendentes([{ pedido: "Pedido #170002", conta: 1, nome: "Cliente Teste", valor: 10, motivo: { codigo: "ambiguo", grupo: "precisa" } }]);
  await resolverManual("Pedido #170002", "BR266998634725G SPXLM17442804", { confirmado: true });
  const m = criacoes[1];
  tudo &= ok(m?.urls?.join() === [P("BR266998634725G"), P("SPXLM17442804")].join() && m?.company === "Shopee Xpress",
    `"colei o rastreio": ${m?.company} · ${m?.urls?.length} link(s) do parcelsapp`);
}

sec("4. Corrigir o link dos pedidos já escritos");
const { planejarCorrecao, corrigirLinks } = await import("../src/corrigir-links.mjs");
const C = (c) => `https://rastreamento.correios.com.br/app/index.php?objeto=${c}`;
const semear = () => {
  loja.clear();
  loja.set("gid://F/1", { status: "SUCCESS", pedido: "#165172", trackingInfo: [{ number: "BR2620456593785", url: C("BR2620456593785"), company: "Correios" }] });
  loja.set("gid://F/2", { status: "SUCCESS", pedido: "#166286", trackingInfo: [
    { number: "BR262833412675I", url: C("BR262833412675I"), company: "Correios" },
    { number: "BR266998634725G", url: C("BR266998634725G"), company: "Correios" },
    { number: "SPXLM17442804", url: "https://spx.com.br/track?key=SPXLM17442804", company: "Correios" }] });
  loja.set("gid://F/3", { status: "SUCCESS", pedido: "#165300", trackingInfo: [
    { number: "BR269253080925G", url: C("BR269253080925G"), company: "Correios" },
    { number: "BR2690287154255", url: "https://meu-link-manual.com/abc", company: "Correios" }] });
  loja.set("gid://F/4", { status: "CANCELLED", pedido: "#165400", trackingInfo: [{ number: "BR2600000000001A", url: C("BR2600000000001A"), company: "Correios" }] });
  loja.set("gid://F/5", { status: "SUCCESS", pedido: "#165500", trackingInfo: [{ number: "BR2600000000002B", url: P("BR2600000000002B"), company: "Shopee Xpress" }] });
};
// o registro do robô: tudo o que ELE escreveu (o #165600, processado à mão, não está aqui)
const registro = { "165172": { fulfillmentId: "gid://F/1" }, "166286": { fulfillmentId: "gid://F/2" },
  "165300": { fulfillmentId: "gid://F/3" }, "165400": { fulfillmentId: "gid://F/4" }, "165500": { fulfillmentId: "gid://F/5" },
  "165700": { fulfillmentId: "gid://F/sumiu" } };
{
  semear();
  loja.set("gid://F/mao", { status: "SUCCESS", pedido: "#165600", trackingInfo: [{ number: "BR2611111111111", url: C("BR2611111111111"), company: "Correios" }] });
  atualizacoes = 0;
  const plano = await planejarCorrecao({ registro });
  tudo &= ok(atualizacoes === 0, "conferir não muda nada na Shopify");
  tudo &= ok(plano.aCorrigir.length === 3 && plano.jaCertos === 1 && plano.cancelados === 1 && plano.naoAchados === 1 && plano.total === 6,
    `conferir: 3 a corrigir, 1 já certo, 1 cancelado, 1 não achado (${plano.aCorrigir.length}/${plano.jaCertos}/${plano.cancelados}/${plano.naoAchados})`);
  const r = await corrigirLinks(plano, { pausa: async () => {} });
  tudo &= ok(r.corrigidos === 3 && r.falhas.length === 0, `corrigir: ${r.corrigidos} corrigidos, ${r.falhas.length} falhas`);
  const f2 = loja.get("gid://F/2").trackingInfo;
  tudo &= ok(f2.length === 3 && f2.every((t) => t.url === P(t.number)), "pedido com 3 códigos: os 3 continuam, cada um com o seu link novo");
  tudo &= ok(loja.get("gid://F/1").trackingInfo[0].url === P("BR2620456593785") && loja.get("gid://F/1").trackingInfo[0].company === "Shopee Xpress",
    "transportadora corrigida para Shopee Xpress");
  const f3 = loja.get("gid://F/3").trackingInfo;
  tudo &= ok(f3[0].url === P("BR269253080925G") && f3[1].url === "https://meu-link-manual.com/abc", "link colocado à mão fica como está");
  tudo &= ok(loja.get("gid://F/4").trackingInfo[0].url === C("BR2600000000001A"), "pedido cancelado não é mexido");
  tudo &= ok(loja.get("gid://F/mao").trackingInfo[0].url === C("BR2611111111111"), "pedido que a pessoa processou na Shopify não é mexido");
  const de_novo = await planejarCorrecao({ registro });
  tudo &= ok(de_novo.aCorrigir.length === 0 && de_novo.jaCertos === 4, "rodar de novo: nada a corrigir");
}
{
  // a Shopify pede para ir mais devagar no meio: espera e continua
  semear(); throttleNa = 2; atualizacoes = 0;
  const esperas = [];
  const r = await corrigirLinks(await planejarCorrecao({ registro }), { pausa: async (ms) => { esperas.push(ms); } });
  tudo &= ok(r.corrigidos === 3 && esperas.length === 1, `"THROTTLED" no meio: esperou ${esperas[0]} ms e terminou os 3`);
  throttleNa = 0;
}
{
  // a Shopify gravou menos códigos do que mandamos: é falha, e diz qual pedido
  semear();
  const plano = await planejarCorrecao({ registro });
  const fetchAntes = globalThis.fetch;
  globalThis.fetch = async (url, opcoes) => {
    const corpo = JSON.parse(opcoes.body);
    if (/fulfillmentTrackingInfoUpdate/.test(corpo.query) && corpo.variables.id === "gid://F/2")
      return new Response(JSON.stringify({ data: { fulfillmentTrackingInfoUpdate: { userErrors: [], fulfillment: { trackingInfo: [{ number: "BR262833412675I" }] } } } }), { status: 200 });
    return fetchAntes(url, opcoes);
  };
  const r = await corrigirLinks(plano, { pausa: async () => {} });
  globalThis.fetch = fetchAntes;
  tudo &= ok(r.falhas.length === 1 && r.falhas[0].pedido === "#166286" && /outros códigos/.test(r.falhas[0].erro),
    `código sumido na resposta vira falha com o pedido: "${r.falhas[0]?.pedido}: ${r.falhas[0]?.erro}"`);
}

sec("5. Pela ponte do app: conferir antes de trocar");
{
  semear();
  writeFileSync(process.env.REGISTRO_ESCRITAS, JSON.stringify(registro));
  const { construir } = await import("../aplicativo/ponte.mjs");
  const ponte = construir({});
  const des = (r) => (r && "ok" in r && "dado" in r ? r.dado : r);
  const sem = await ponte["links:corrigir"]({});
  tudo &= ok(sem?.ok === false && /confira antes/.test(sem.erro), "trocar sem conferir antes: recusado");
  const c = des(await ponte["links:conferir"]({}));
  tudo &= ok(c.aCorrigir === 3 && c.exemplo?.para === P("BR2620456593785"), `conferir mostra quantos e um exemplo (${c.aCorrigir}, ${c.exemplo?.pedido} → ${c.exemplo?.para})`);
  const r = des(await ponte["links:corrigir"]({}));
  tudo &= ok(r.corrigidos === 3, `trocar: ${r.corrigidos}`);
  const de_novo = await ponte["links:corrigir"]({});
  tudo &= ok(de_novo?.ok === false, "trocar de novo sem conferir: recusado (o plano já foi usado)");
  const ex = des(await ponte["links:exemplo"]({ link: "https://parcelsapp.com/pt/tracking" }));
  tudo &= ok(ex.link === P("BR2620456593785"), `exemplo do campo: ${ex.link}`);
}

console.log(tudo ? "\n\x1b[32m\x1b[1m  link de rastreio: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  link de rastreio: FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
