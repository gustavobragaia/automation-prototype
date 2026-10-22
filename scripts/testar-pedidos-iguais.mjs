// Pedidos iguais do mesmo cliente — Chomps, 22/10/2026.
//
// O Matheus separou os 18 pedidos de 16/10 que nunca ganharam rastreio
// ("modelo-esteira_filtrado.xlsx"). 16 deles eram de cliente com 2 pedidos na
// mesma conta, e em 6 pares os dois tinham o MESMO valor (ex.: conta 220,
// #165569 e #165570, R$ 23,99 cada). O pareamento via isso como empate e
// deixava os dois na conferência para sempre: a etapa 4 não tinha nada para
// escrever. Dos 67 pedidos que ele resolveu à mão na Shopify, 54 eram pares
// assim.
//
// Caminho inteiro: a planilha (a real, se estiver em ~/Downloads; senão uma
// de mentira com a mesma forma), compras no formato da Shopee, a ponte do
// app ("conferencia:listar" e "escrita:listar") e a loja de mentira.
// Nenhum nome de cliente fica neste arquivo.
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "esteira-iguais-"));
process.env.TRABALHO_DIR = dir; process.env.ESTADO_DIR = join(dir, "estado");
process.env.REGISTRO_ESCRITAS = join(dir, "escritas.json");
process.env.SHOPIFY_CONEXAO_ARQUIVO = join(dir, "conexao.json");
writeFileSync(process.env.SHOPIFY_CONEXAO_ARQUIVO, JSON.stringify({ loja: "t.myshopify.com", modo: "token-fixo", accessToken: "x" }));

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

const { conciliar, pareamentoClaro } = await import("../src/conciliar.mjs");
const { lerPendentes } = await import("../src/planilha.mjs");
const { default: ExcelJS } = await import("../src/excel.mjs");

// ── a planilha ──
// PLANILHA_TESTE=<arquivo> roda com outra planilha (ex.: o dia 16 inteiro)
let planilha = process.env.PLANILHA_TESTE ?? join(homedir(), "Downloads", "modelo-esteira_filtrado.xlsx");
const real = existsSync(planilha);
if (!real) {
  // a mesma forma da real: pares iguais, um par de valores diferentes,
  // um pedido de 2 unidades + 1, e dois pedidos sozinhos
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("PEDIDOS");
  ws.addRow(["DATA", "NÚMERO DO PEDIDO", "NOME DO CLIENTE", "VALOR PAGO", "CÓDIGO DE RASTREIO", "ONDE FOI FEITO O PEDIDO"]);
  const L = (n, nome, v, c) => ws.addRow(["16/10", `Pedido #${n}`, nome, v, null, `shopee ${c}`]);
  L(165552, "Cliente A", 21.9, 217); L(165553, "Cliente A", 12.9, 217);
  L(165569, "Cliente B", 23.99, 220); L(165570, "Cliente B", 23.99, 220);
  L(165600, "Cliente C", 24.89, 224); L(165601, "Cliente C", 24.89, 224);
  L(165626, "Cliente D", 14.66, 228);
  L(165669, "Cliente E", 13, 234); L(165670, "Cliente E", 13, 234);
  L(165682, "Cliente F", 23.99, 236); L(165683, "Cliente F", 23.99, 236);
  L(165716, "Cliente G", 23.99, 241); L(165717, "Cliente G", 23.99, 241);
  L(165730, "Cliente H", 23.99, 244); L(165731, "Cliente I", 23.99, 244); L(165732, "Cliente I", 23.99, 244);
  L(165740, "Cliente J", 47.98, 245); L(165741, "Cliente J", 23.99, 245);
  planilha = join(dir, "filtrado.xlsx"); await wb.xlsx.writeFile(planilha);
}
const { contas } = await lerPendentes(planilha);

// ── as compras na Shopee, no formato de /api/v4/order/get_order_detail ──
// Pares iguais: a Shopee rateia frete/desconto (como no caso EDESIO), então os
// valores das compras não batem um a um — só a soma bate. Compradas em
// sequência, com 40 s entre uma e outra.
const T0 = Date.parse("2026-10-16T13:00:00Z") / 1000;
const detalhe = (id, nome, valor, codigo, criadoEm) => ({ orderId: String(id), bruto: { data: {
  address: { shipping_name: nome, shipping_address: "Rua Teste, 1, São Paulo, SP, 01000000" },
  info_card: { order_id: String(id), final_total: Math.round(valor * 100000) },
  pc_shipping: { forder_shipping_info_list: [{ tracking_number: codigo }] },
  pc_processing_info: { create_time: criadoEm } } } });
const { DIR_COLETAS } = await import("../src/caminhos.mjs");
mkdirSync(DIR_COLETAS, { recursive: true });
const esperado = new Map();    // pedido -> código que a ordem da compra dá
const tipo = new Map();        // código -> "IGUAL" | "DIF" | "TRES" | "SO"
let seq = 1000;
const contaTres = new Set();   // "conta|cliente" do pedido de 2 unidades + 1
// no formato de verdade (BR + 13), senão a escrita recusa como não reconhecido
const codigo = (t) => { const c = `BR26${String(++seq).padStart(10, "0")}${"ABCDEFGHJK"[seq % 10]}`; tipo.set(c, t); return c; };
for (const c of contas) {
  const porCliente = new Map();
  for (const p of c.pedidos) { const k = p.nome.toUpperCase(); if (!porCliente.has(k)) porCliente.set(k, []); porCliente.get(k).push(p); }
  const pedidos = [];
  for (const ps of porCliente.values()) {
    const unicos = [...new Map(ps.map((p) => [p.pedido, p])).values()];
    const iguais = unicos.length > 1 && unicos.every((p) => p.valor === unicos[0].valor);
    if (unicos.length === 2 && unicos[0].valor === 2 * unicos[1].valor) {
      // pedido de 2 unidades + 1 (R$ 47,98 + R$ 23,99): 3 compras iguais
      contaTres.add(`${c.conta}|${unicos[0].nome.toUpperCase()}`);
      for (let i = 0; i < 3; i++) pedidos.push(detalhe(seq + 1, unicos[0].nome, unicos[1].valor, codigo("TRES"), T0 + i * 40));
    } else if (iguais) {
      unicos.forEach((p, i) => {
        const cod = codigo("IGUAL");
        esperado.set(p.pedido, cod);
        // o id da compra na Shopee em ordem CONTRÁRIA à do horário: quem
        // decide é o horário da compra, não o id
        pedidos.push(detalhe(900000 - seq, p.nome, p.valor + (i === 0 ? -0.8 : 0.8), cod, T0 + i * 40));
      });
    } else if (unicos.length === 2) {
      // valores diferentes, rateio diferente, a soma bate (como EDESIO)
      pedidos.push(detalhe(seq + 1, unicos[0].nome, unicos[0].valor - 1.76, codigo("DIF"), T0));
      pedidos.push(detalhe(seq + 1, unicos[1].nome, unicos[1].valor + 1.76, codigo("DIF"), T0 + 40));
    } else {
      pedidos.push(detalhe(seq + 1, unicos[0].nome, unicos[0].valor, codigo("SO"), T0));
    }
  }
  writeFileSync(join(DIR_COLETAS, `conta-${c.conta}.json`), JSON.stringify({ conta: String(c.conta), listas: [{ ok: true }], pedidos }));
}

// a loja de mentira: cada pedido em aberto, com o nome do cliente da planilha
const nomeDe = new Map(contas.flatMap((c) => c.pedidos.map((p) => [String(p.pedido).match(/\d+/)[0], p.nome])));
const escritos = [];   // o que chegou à Shopify: [fulfillmentOrderId, códigos]
globalThis.fetch = async (url, opcoes = {}) => {
  const corpo = JSON.parse(opcoes.body ?? "{}");
  if (/fulfillmentCreateV2/.test(corpo.query ?? "")) {
    const f = corpo.variables.f, t = f.trackingInfo;
    const numeros = t.numbers ?? [t.number];
    escritos.push([f.lineItemsByFulfillmentOrder[0].fulfillmentOrderId, numeros]);
    return new Response(JSON.stringify({ data: { fulfillmentCreateV2: { userErrors: [], fulfillment: {
      id: "gid://F/" + escritos.length, status: "SUCCESS", trackingInfo: numeros.map((n) => ({ number: n, url: "", company: t.company })) } } } }), { status: 200 });
  }
  const nums = [...String(corpo.variables?.q ?? "").matchAll(/name:(\d+)/g)].map((m) => m[1]);
  return new Response(JSON.stringify({ data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: nums.map((n) => ({
    name: "#" + n, id: "gid://O/" + n, displayFulfillmentStatus: "UNFULFILLED",
    shippingAddress: { name: nomeDe.get(n), zip: "01000000" }, totalPriceSet: { shopMoney: { amount: "1" } },
    lineItems: { nodes: [] }, fulfillmentOrders: { nodes: [{ id: "gid://FO/" + n, status: "OPEN" }] } })) } } }), { status: 200 });
};

sec(`1. A planilha ${real ? "REAL" : "de mentira (a real não está em ~/Downloads)"} do Matheus, de ponta a ponta`);
{
  const { construir } = await import("../aplicativo/ponte.mjs");
  const ponte = construir({});
  const des = (r) => (r && "ok" in r && "dado" in r ? r.dado : r);
  await ponte["planilha:ler"]({ caminho: planilha });
  const esc = des(await ponte["escrita:listar"]({}));
  const conf = des(await ponte["conferencia:listar"]({}));
  const naEtapa4 = new Map(esc.itens.map((i) => [i.pedido, i.codigos.join()]));
  const pares = [...esperado.keys()];
  tudo &= ok(pares.length >= (process.env.PLANILHA_TESTE ? 2 : 12), `${pares.length} pedidos em pares de mesmo valor na planilha`);
  tudo &= ok(pares.every((p) => naEtapa4.has(p)), `todos vão para a etapa 4 (antes: 0) — ${pares.filter((p) => naEtapa4.has(p)).length} de ${pares.length}`);
  tudo &= ok(pares.every((p) => naEtapa4.get(p) === esperado.get(p)),
    "cada um com o rastreio da compra feita na mesma ordem (1º pedido ↔ 1ª compra)");
  tudo &= ok(new Set(pares.map((p) => naEtapa4.get(p))).size === pares.length, "nenhum rastreio repetido em dois pedidos");
  const de = (t) => esc.itens.filter((i) => i.codigos.some((c) => tipo.get(c) === t));
  const diferentes = de("DIF").length;
  const difEsperados = [...tipo.values()].filter((t) => t === "DIF").length;
  tudo &= ok(diferentes === difEsperados, `os pares de valores diferentes também (pelo total, como antes): ${diferentes} de ${difEsperados}`);
  const tres = [];
  tudo &= ok(de("TRES").length === 0,
    `pedido de 2 unidades + 1 com 3 compras iguais: NÃO decide sozinho (fica para você: ${tres.join(", ") || "—"})`);
  console.log(`     etapa 4: ${esc.itens.length} pedido(s) para escrever · conferência: ${conf.pendencias.length} para você`);
}

sec("1b. Como está no app do Matheus: os pares na conferência desde 21/10 → escritos");
{
  // a carteira como a rodada de 21/10 deixou: todos como "dois candidatos"
  const { guardarPendentes, pendentesAbertos } = await import("../src/estado.mjs");
  const ambiguo = { codigo: "ambiguo", grupo: "precisa" };
  const todos = contas.flatMap((c) => [...new Map(c.pedidos.map((p) => [p.pedido, { ...p, conta: c.conta }])).values()]);
  guardarPendentes(todos.map((p) => ({ pedido: p.pedido, conta: p.conta, nome: p.nome, valor: p.valor, motivo: ambiguo })));
  const { construir } = await import("../aplicativo/ponte.mjs");
  const ponte = construir({});
  const des = (r) => (r && "ok" in r && "dado" in r ? r.dado : r);
  await ponte["planilha:ler"]({ caminho: planilha });
  const conf = des(await ponte["conferencia:listar"]({}));
  const sairam = new Set(conf.resolvidosAgora.map((r) => r.pedido));
  tudo &= ok([...esperado.keys()].every((p) => sairam.has(p)),
    `ao abrir a conferência, os ${esperado.size} dos pares saem de "Precisa de você" (vão para a etapa 4)`);
  // escrever (o botão da etapa 4)
  escritos.length = 0;
  const r = des(await ponte["escrita:executar"]({}));
  const pedidosTres = todos.filter((p) => contaTres.has(`${p.conta}|${p.nome.toUpperCase()}`)).length;
  const devemSer = new Set(todos.map((p) => p.pedido)).size - pedidosTres;
  tudo &= ok(r.escritos === devemSer && r.falhas === 0, `escrita na Shopify: ${r.escritos} de ${devemSer} escritos, ${r.falhas} falhas`);
  const porPedido = new Map(escritos.map(([fo, cods]) => [`Pedido #${fo.match(/\d+$/)[0]}`, cods.join()]));
  // pedido comprado em duas contas: um fulfillment, com os rastreios das duas
  const emDuas = [...new Set(todos.map((p) => p.pedido))].filter((p) => new Set(todos.filter((x) => x.pedido === p).map((x) => x.conta)).size > 1);
  if (emDuas.length)
    tudo &= ok(emDuas.every((p) => (porPedido.get(p) ?? "").split(",").length === 2),
      `pedido comprado em duas contas (${emDuas.join(", ")}): um fulfillment com os rastreios das duas`);
  tudo &= ok([...esperado].every(([p, cod]) => porPedido.get(p) === cod),
    "cada fulfillment foi para o pedido certo, com o rastreio certo (conferido no que chegou à Shopify)");
  tudo &= ok(escritos.length === new Set(escritos.map(([fo]) => fo)).size, "nenhum pedido recebeu dois fulfillments");
  const ficaram = pendentesAbertos().map((p) => p.pedido);
  tudo &= ok([...esperado.keys()].every((p) => !ficaram.includes(p)), "e saíram da carteira: não voltam amanhã");
  tudo &= ok(ficaram.length === pedidosTres, `na conferência ficam só os ${pedidosTres} de pedido de 2 unidades + 1 (${ficaram.join(", ") || "nenhum"})`);
  // de novo: nada é escrito duas vezes
  escritos.length = 0;
  const r2 = des(await ponte["escrita:executar"]({}));
  tudo &= ok(r2.escritos === 0 && escritos.length === 0, "rodar a escrita de novo não escreve nada duas vezes");
}

sec("3. Pedido comprado em duas contas (#165688: conta 236 e 237)");
{
  const { escreverRastreios } = await import("../src/escrita.mjs");
  const conexao = { loja: "t.myshopify.com", modo: "token-fixo", accessToken: "x" };
  const L = (n, nome, v) => ({ pedido: `Pedido #${n}`, nome, valor: v });
  const C = (nome, v, cod) => ({ nome, valor: v, codigos: cod ? [cod] : [], cep: "01000000" });
  nomeDe.set("190001", "Cliente Dividido");
  const contasDiv = [{ conta: 236, pedidos: [L(190001, "Cliente Dividido", 70.3), L(190001, "Cliente Dividido", 70.3)] },
                     { conta: 237, pedidos: [L(190001, "Cliente Dividido", 15.99)] }];
  // as duas partes com rastreio
  escritos.length = 0;
  let r = await escreverRastreios(contasDiv, new Map([[236, [C("Cliente Dividido", 70.3, "BR261111111111A")]], [237, [C("Cliente Dividido", 15.99, "BR262222222222B")]]]), { escrever: true, conexao });
  tudo &= ok(r.escritos === 1 && escritos.length === 1 && escritos[0][1].sort().join() === "BR261111111111A,BR262222222222B",
    `um fulfillment com os rastreios das duas contas (${escritos[0]?.[1].join(", ")}) — antes: só o da 236, e o da 237 sumia`);
  // a parte da 237 ainda sem rastreio: o pedido espera inteiro
  writeFileSync(process.env.REGISTRO_ESCRITAS, "{}");
  escritos.length = 0;
  r = await escreverRastreios(contasDiv, new Map([[236, [C("Cliente Dividido", 70.3, "BR261111111111A")]], [237, [C("Cliente Dividido", 15.99, null)]]]), { escrever: true, conexao });
  const motivos = r.pendencias.filter((x) => x.pedido === "Pedido #190001").map((x) => `${x.conta}:${x.motivo.codigo}`).sort();
  tudo &= ok(r.escritos === 0 && escritos.length === 0, "uma parte ainda sem rastreio: nada é escrito (escrever só a outra fecharia a entrega)");
  tudo &= ok(motivos.includes("236:parte-pendente") && motivos.some((m) => m.startsWith("237:")),
    `e as duas ficam na carteira, sem sumir (${motivos.join(", ")})`);
  // nome diferente numa das contas: não escreve nenhuma
  escritos.length = 0;
  r = await escreverRastreios(contasDiv, new Map([[236, [C("Cliente Dividido", 70.3, "BR261111111111A")]], [237, [C("Outra Pessoa", 15.99, "BR262222222222B")]]]), { escrever: true, conexao });
  tudo &= ok(escritos.length === 0, "o nome na outra conta não confere: nada escrito");
  // a planilha com o nome escrito diferente numa das linhas (a Shopee bate
  // com cada linha, mas a Shopify tem um nome só)
  escritos.length = 0;
  const contasNome = [{ conta: 236, pedidos: [L(190001, "Cliente Dividido", 70.3)] }, { conta: 237, pedidos: [L(190001, "Cliente Dividida", 15.99)] }];
  r = await escreverRastreios(contasNome, new Map([[236, [C("Cliente Dividido", 70.3, "BR261111111111A")]], [237, [C("Cliente Dividida", 15.99, "BR262222222222B")]]]), { escrever: true, conexao });
  const m237 = r.pendencias.find((x) => x.conta === 237 && x.pedido === "Pedido #190001")?.motivo.codigo;
  tudo &= ok(escritos.length === 0 && m237 === "nome-nao-confere", `nome que não confere na 2ª conta: nada escrito, e ela diz por quê (${m237})`);
}

sec("2. Onde o robô continua perguntando");
{
  const linha = (pedido, nome, valor) => ({ pedido: `Pedido #${pedido}`, nome, valor });
  const compra = (valor, codigo, criadoEm = T0, cep = "01000000") => ({ nome: "Ana Teste", valor, codigos: [codigo], cep, criadoEm });
  const rodar = (pedidos, compras) => conciliar([{ conta: 1, pedidos }], new Map([[1, compras]])).linhas;
  // pedidos de valores diferentes, compras de mesmo valor: trocar muda o produto
  let l = rodar([linha(1, "Ana Teste", 30), linha(2, "Ana Teste", 20)], [compra(25, "BR_A"), compra(25, "BR_B", T0 + 40)]);
  tudo &= ok(l.every((x) => x.estado === "ambiguo"), "R$ 30 e R$ 20 contra duas compras de R$ 25: não decide (os produtos podem ser outros)");
  // pedidos iguais, mas uma compra a mais (de outro dia): o total não bate
  l = rodar([linha(1, "Ana Teste", 23.99), linha(2, "Ana Teste", 23.99)], [compra(23.99, "BR_A"), compra(23.99, "BR_B", T0 + 40), compra(19.9, "BR_C", T0 - 86400)]);
  tudo &= ok(l.every((x) => x.estado === "ambiguo"), "pedidos iguais com uma compra antiga a mais: não decide");
  // pedidos iguais, uma compra ainda sem rastreio
  l = rodar([linha(1, "Ana Teste", 23.99), linha(2, "Ana Teste", 23.99)], [compra(23.99, "BR_A"), { ...compra(23.99, null, T0 + 40), codigos: [] }]);
  tudo &= ok(!l.some((x) => /^ok/.test(x.estado)), "pedidos iguais, uma compra sem rastreio ainda: não decide");
  // quase empate de verdade continua
  tudo &= ok(pareamentoClaro([{ valor: 30 }, { valor: 20.2 }], [{ valor: 25 }, { valor: 25.2 }]) === null,
    "valores que não decidem (30 + 20,2 contra 25 + 25,2): não decide, como antes");
  // três pedidos iguais, três compras: em ordem
  l = rodar([linha(3, "Ana Teste", 13), linha(1, "Ana Teste", 13), linha(2, "Ana Teste", 13)],
    [compra(13, "BR_3", T0 + 80), compra(13, "BR_1", T0), compra(13, "BR_2", T0 + 40)]);
  const cod = (n) => l.find((x) => x.p.pedido === `Pedido #${n}`)?.codigo;
  tudo &= ok(cod(1) === "BR_1" && cod(2) === "BR_2" && cod(3) === "BR_3", `três pedidos iguais: um a um, pela ordem (${cod(1)}, ${cod(2)}, ${cod(3)})`);
  // 1 centavo de diferença (#165264/#165265: R$ 19,49 e R$ 19,50) é o mesmo valor
  l = rodar([linha(165264, "Ana Teste", 19.49), linha(165265, "Ana Teste", 19.5)], [compra(17.73, "BR_P", T0), compra(21.26, "BR_Q", T0 + 40)]);
  tudo &= ok(l.find((x) => x.p.pedido === "Pedido #165264")?.codigo === "BR_P" && l.find((x) => x.p.pedido === "Pedido #165265")?.codigo === "BR_Q",
    "R$ 19,49 e R$ 19,50 (1 centavo): pedidos iguais, pela ordem da compra");
  // 11 centavos já não é o mesmo valor: o rateio não decide, fica para você
  l = rodar([linha(1, "Ana Teste", 19.49), linha(2, "Ana Teste", 19.6)], [compra(18, "BR_P", T0), compra(21.09, "BR_Q", T0 + 40)]);
  tudo &= ok(l.every((x) => x.estado === "ambiguo"), "R$ 19,49 e R$ 19,60: não são iguais, e o valor não decide — fica para você");
  // mesmo segundo (um checkout só): ainda decide, de forma estável
  const a = rodar([linha(1, "Ana Teste", 23.99), linha(2, "Ana Teste", 23.99)], [compra(23.99, "BR_X"), compra(23.99, "BR_Y")]);
  const b = rodar([linha(1, "Ana Teste", 23.99), linha(2, "Ana Teste", 23.99)], [compra(23.99, "BR_X"), compra(23.99, "BR_Y")]);
  tudo &= ok(a.every((x) => x.estado === "ok-total") && a.map((x) => x.codigo).join() === b.map((x) => x.codigo).join(),
    "compras no mesmo segundo: decide, e sempre do mesmo jeito");
}

console.log(tudo ? "\n\x1b[32m\x1b[1m  pedidos iguais: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  pedidos iguais: FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
