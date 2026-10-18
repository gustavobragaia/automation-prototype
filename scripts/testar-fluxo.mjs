// O fluxo inteiro, pela ponte que o aplicativo usa.
//
// Nada aqui é mock de função nossa: a planilha é um .xlsx de verdade, as
// coletas são os arquivos que o coletor grava, o armazenamento é o real e a
// conciliação é a mesma do robô. A única mentira é a rede da Shopify — e ela
// responde no formato da Shopify e anota o que recebeu, para o teste poder
// afirmar que a escrita saiu com o código certo no pedido certo.
//
// A pergunta é "o fluxo funciona de ponta a ponta?", então o teste segue a
// ordem em que a pessoa mexe: sobe a planilha, roda, confere, decide, desfaz
// — e fecha o app no meio para provar que nada disso vive só na memória.
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

const dir = mkdtempSync(join(tmpdir(), "esteira-fluxo-"));
process.env.ESTADO_DIR = join(dir, "estado");
process.env.TRABALHO_DIR = dir;
process.env.RECURSOS_DIR = process.cwd();
process.env.ARMAZENAMENTO = process.env.ARMAZENAMENTO ?? "json";
// Uma loja conectada de mentira, para o código seguir o caminho normal.
process.env.SHOPIFY_CONEXAO_ARQUIVO = join(dir, "conexao.json");
writeFileSync(process.env.SHOPIFY_CONEXAO_ARQUIVO, JSON.stringify({
  modo: "token-fixo", loja: "lojateste.myshopify.com", token: "shpat_faz-de-conta",
  conectadoEm: new Date().toISOString(),
}));

const { montarCenario, fingirShopify, PEDIDOS } = await import("./cenario-conferencia.mjs");
const { planilha } = await montarCenario(dir);

const escritas = fingirShopify({ pedidos: {
  "#1001": { nome: "Sônia Aparecida Pinto", valor: 88.30, cep: "80000000" },
  "#1002": { nome: "Antônio Paulo Borges", valor: 31.33, cep: "80000111" },
  "#1003": { nome: "Leonardo José de Freitas", valor: 57.65, cep: "80000222" },
  "#1004": { nome: "Maria Aparecida Santos", valor: 13.00, cep: "13485020" },
} });

const { construir } = await import("../aplicativo/ponte.mjs");
const { guardarPendentes, pendentesAbertos } = await import("../src/estado.mjs");
const { conciliar, lerColetas } = await import("../src/conciliar.mjs");
const { lerPendentes } = await import("../src/planilha.mjs");

const ponte = construir({ aoLog: () => {} });
// Uma chamada como o aplicativo faz: pelo nome, e desembrulhando igual.
async function chamar(acao, carga) {
  const r = await ponte[acao](carga ?? {});
  if (r && typeof r === "object" && "ok" in r && ("dado" in r || "erro" in r)) {
    if (!r.ok) throw new Error(r.erro);
    return r.dado;
  }
  return r;
}

/* ───────────────────── 1. a planilha do dia ───────────────────── */
sec("1 · o cliente sobe a planilha");
const lida = await chamar("planilha:ler", { caminho: planilha });
tudo &= ok(lida.total === 4, `a planilha tem 4 linhas (leu ${lida.total})`);
tudo &= ok(lida.pendentes === 4, "as 4 estão sem rastreio, então as 4 entram");
tudo &= ok(lida.contas.length === 2, `e são 2 contas a abrir (achou ${lida.contas.length})`);

/* ───────────────────── 2. a rodada ───────────────────── */
sec("2 · as contas da rodada saem da planilha");
const contas = await chamar("rodada:contas");
tudo &= ok(contas.length === 2, `2 contas (deu ${contas.length})`);
tudo &= ok(contas.map((c) => c.conta).sort().join(",") === "124,128",
  "e são a 124 e a 128, as que a planilha indicou");

// O que rodarCiclo faz depois da coleta: concilia e guarda a carteira.
const r = await lerPendentes(planilha);
const { linhas } = conciliar(r.contas, lerColetas());
guardarPendentes(linhas.filter((l) => l.motivo).map((l) => ({ ...l.p, conta: l.conta, motivo: l.motivo })));

/* ───────────────────── 3. a conferência ───────────────────── */
sec("3 · a conferência separa quem precisa de você");
const conf = await chamar("conferencia:listar");
const porPedido = Object.fromEntries(conf.pendencias.map((p) => [p.pedido, p]));

tudo &= ok(conf.pendencias.length === 2,
  `2 pedidos precisam de você (vieram ${conf.pendencias.length}: ${conf.pendencias.map((p) => p.pedido).join(", ")})`);
tudo &= ok(!porPedido["#1001"], "o que casou redondo NÃO aparece — não precisa de ninguém");
tudo &= ok(conf.sozinhos.some((p) => p.pedido === "#1002"),
  "o que a Shopee não despachou vai para o grupo que se resolve sozinho");

const naoAchado = porPedido["#1003"];
tudo &= ok(naoAchado?.motivo.codigo === "nao-achado-na-conta",
  `#1003 veio como não achado na conta (veio ${naoAchado?.motivo.codigo})`);
tudo &= ok(naoAchado?.sugestoes?.[0]?.conta === 128,
  `e o robô achou o cliente na conta 128 (sugeriu ${naoAchado?.sugestoes?.[0]?.conta})`);
tudo &= ok(naoAchado?.sugestoes?.[0]?.codigos?.includes("BR264983069926O"),
  "com o rastreio que está lá, para a pessoa decidir olhando");

const empate = porPedido["#1004"];
tudo &= ok(empate?.motivo.codigo === "ambiguo", "#1004 veio como empate entre dois");
tudo &= ok(empate?.candidatos?.length === 2,
  `e os DOIS candidatos vieram junto (vieram ${empate?.candidatos?.length})`);
tudo &= ok(empate?.candidatos?.every((c) => c.codigos.length),
  "cada um com seu rastreio — sem isso não dá para escolher");

/* ───────────────────── 4. decidir: colar o rastreio ───────────────────── */
sec("4 · a pessoa escolhe um dos dois e manda escrever");
const escolhido = empate.candidatos[0].codigos[0];
const antes = await chamar("manual:conferir", { pedido: "#1004", texto: escolhido });
tudo &= ok(antes.ok === true, "antes de escrever, o robô mostra o lado da Shopify");
tudo &= ok(antes.alvo?.nome === "Maria Aparecida Santos",
  `e é o cliente certo (${antes.alvo?.nome})`);

const dec = await chamar("conferencia:decidir",
  { pedido: "#1004", decisao: "colar", texto: escolhido });
tudo &= ok(dec.reversivel === false, "escrever na Shopify NÃO é reversível, e a ponte diz isso");
tudo &= ok(escritas.length === 1, `a Shopify recebeu 1 escrita (recebeu ${escritas.length})`);
tudo &= ok(escritas[0]?.codigos?.includes(escolhido),
  `com o código que a pessoa escolheu (${escritas[0]?.codigos?.join(",")})`);

/* ───────────────────── 5. decidir: era outra conta ───────────────────── */
sec("5 · a outra pendência era conta errada");
const dec2 = await chamar("conferencia:decidir",
  { pedido: "#1003", decisao: "conta", conta: 128 });
tudo &= ok(dec2.volta === true, "o pedido VOLTA na próxima rodada — não foi resolvido, mudou de conta");
tudo &= ok(dec2.reversivel === true, "e dá para desfazer, porque nada foi escrito na Shopify");

/* ───────────────────── 6. a lista não repete o que já foi decidido ───────── */
sec("6 · a conferência não ressuscita o que você já tratou");
const conf2 = await chamar("conferencia:listar");
const nums2 = conf2.pendencias.map((p) => p.pedido);
tudo &= ok(!nums2.includes("#1004"), "o escrito à mão sumiu da lista");
tudo &= ok(!nums2.includes("#1003"), "o de conta corrigida também sai — ele volta na RODADA, não aqui");

/* ───────────────────── 7. fechar e abrir o app ───────────────────── */
sec("7 · fecha o app, abre de novo: nada disso vivia na memória");
const sobreviveu = JSON.parse(
  (await import("node:child_process")).execFileSync(process.execPath,
    ["--input-type=module", "-e", `
      const { pendentesAbertos } = await import("${process.cwd()}/src/armazenamento/index.mjs");
      console.log(JSON.stringify(pendentesAbertos().map((p) => ({
        pedido: p.pedido, conta: p.conta, corrigida: p.contaCorrigida ?? false }))));
    `], { encoding: "utf8",
          env: { ...process.env } }).trim());

const mapa = Object.fromEntries(sobreviveu.map((p) => [p.pedido, p]));
tudo &= ok(!mapa["#1004"], "o escrito à mão continua fora da carteira");
tudo &= ok(mapa["#1003"]?.conta === 128,
  `o de conta corrigida está na carteira com a conta nova (${mapa["#1003"]?.conta})`);
tudo &= ok(mapa["#1003"]?.corrigida === true,
  "marcado como corrigido à mão, para a planilha de amanhã não desfazer");

/* ───────────────────── 8. desfazer ───────────────────── */
sec("8 · desfazer faz o que promete, e só isso");
await chamar("conferencia:desfazer", { pedido: "#1003" });
const aberto = pendentesAbertos().find((p) => p.pedido === "#1003");
tudo &= ok(!!aberto, "o de conta corrigida volta para a carteira");

let recusou = false;
try { await chamar("conferencia:desfazer", { pedido: "#1004" }); }
catch { recusou = true; }
tudo &= ok(recusou, "mas o que já foi escrito na Shopify é RECUSADO — não existe desfazer de verdade");
tudo &= ok(escritas.length === 1, "e nenhuma escrita a mais saiu por causa disso");

/* ───────────────────── 9. o que a Shopify recusar não some ───────────── */
sec("9 · quando a Shopify recusa, o pedido continua na sua lista");
const escritas2 = fingirShopify({
  pedidos: { "#1002": { nome: "Antônio Paulo Borges", valor: 31.33, cep: "80000111" } },
  recusar: "fulfillment order is closed",
});
guardarPendentes([{ pedido: "#1002", conta: 124, nome: "Antônio Paulo Borges",
                    motivo: { codigo: "sem-rastreio-ainda", grupo: "sozinho" } }]);
let falhou = false;
try {
  await chamar("conferencia:decidir",
    { pedido: "#1002", decisao: "colar", texto: "BR263500935831Z" });
} catch (e) { falhou = /closed|recus/i.test(e.message); }
tudo &= ok(falhou, "a recusa da Shopify chega como erro, não como sucesso");
tudo &= ok(!!pendentesAbertos().find((p) => p.pedido === "#1002"),
  "e o pedido CONTINUA na carteira — sumir aqui seria perdê-lo para sempre");

/* ───────────────────── 10. decisões que a ponte não conhece ───────────── */
sec("10 · a ponte não obedece o que não conhece");
let barrou = false;
try { await chamar("conferencia:decidir", { pedido: "#1003", decisao: "apagar-tudo" }); }
catch { barrou = true; }
tudo &= ok(barrou, "decisão fora da lista é recusada");

let semPedido = false;
try { await chamar("conferencia:decidir", { decisao: "adiar" }); }
catch { semPedido = true; }
tudo &= ok(semPedido, "e decisão sem número de pedido também");

/* ───────────────────── 11. a etapa 4: o lote ───────────────────── */
sec("11 · a etapa 4 mostra o que vai sair, antes de sair");
const escritas3 = fingirShopify({ pedidos: {
  "#1001": { nome: "Sônia Aparecida Pinto", valor: 88.30, cep: "80000000" },
} });
const lote = await chamar("escrita:listar");
tudo &= ok(lote.itens.length === 1,
  `1 pedido pronto para escrever (veio ${lote.itens.length}: ${lote.itens.map((i) => i.pedido).join(", ")})`);
tudo &= ok(lote.itens[0]?.pedido === "#1001", "e é o que casou redondo, o #1001");
tudo &= ok(lote.itens[0]?.codigos?.includes("BR263500935831Z"),
  "com o rastreio que a Shopee tinha");
tudo &= ok(lote.itens[0]?.transportadora === "Correios", "e a transportadora resolvida pelo código");
tudo &= ok(escritas3.length === 0, "e NADA foi escrito só por listar");

sec("12 · escrever o lote");
const feito = await chamar("escrita:executar", {});
tudo &= ok(feito.escritos === 1, `1 escrito (deu ${feito.escritos})`);
tudo &= ok(feito.falhas === 0, "sem falhas");
tudo &= ok(escritas3.length === 1, "a Shopify recebeu exatamente 1 escrita");
tudo &= ok(escritas3[0]?.codigos?.includes("BR263500935831Z"), "com o código certo");

sec("13 · escrever duas vezes não escreve duas vezes");
const denovo = await chamar("escrita:executar", {});
tudo &= ok(denovo.escritos === 0, `a segunda vez escreve 0 (escreveu ${denovo.escritos})`);
tudo &= ok(denovo.pulados >= 1, "e pula o que já tinha ido");
tudo &= ok(escritas3.length === 1,
  `a Shopify continua com 1 escrita só (tem ${escritas3.length})`);

sec("14 · o que foi colado à mão não é reescrito pelo lote");
// O #1004 foi escrito na etapa 4 deste teste, pela saída manual. O lote
// não pode mandar de novo — e a prova não pode depender de a Shopify já
// responder FULFILLED, porque aí a idempotência moraria no outro lado.
const registro = JSON.parse((await import("node:fs"))
  .readFileSync(join(dir, "estado", "escritas-shopify.json"), "utf8"));
tudo &= ok(!!registro["1004"], "a escrita manual ficou registrada aqui também");
tudo &= ok(registro["1004"]?.origem === "manual", "marcada como manual, para dar para auditar depois");

/* ──────────── 15. o que a escrita barra tem que aparecer ──────────── */
sec("15 · o que a ESCRITA barra aparece na conferência, com os dois lados");
// A conciliação só enxerga o lado Shopee. Tudo que a escrita barra ao
// comparar com a Shopify — nome divergente, pedido que não existe na loja,
// entrega fechada — nasce depois dela. Se a conferência for montada só a
// partir da conciliação, isso fica invisível: o pedido não é escrito e a
// pessoa nunca descobre por quê.
const { writeFileSync: wf2 } = await import("node:fs");
const ExcelJS2 = (await import("exceljs")).default;
const wb2 = new ExcelJS2.Workbook();
const ws2 = wb2.addWorksheet("PEDIDOS");
ws2.addRow(["DATA","NÚMERO DO PEDIDO","NOME DO CLIENTE","VALOR PAGO","CÓDIGO DE RASTREIO","ONDE FOI FEITO O PEDIDO"]);
// a planilha diz Sônia; a loja vai responder com outro destinatário
ws2.addRow(["2026-10-18", "#1099", "Sônia Aparecida Pinto", 88.30, "", "shopee 124"]);
const planilha2 = join(dir, "divergente.xlsx");
await wb2.xlsx.writeFile(planilha2);

fingirShopify({ pedidos: {
  "#1099": { nome: "Outra Pessoa Entrega", valor: 88.30, cep: "99999999" },
} });
await chamar("planilha:esquecer", {});
await chamar("planilha:ler", { caminho: planilha2 });
const r15 = await chamar("escrita:executar", {});
tudo &= ok(r15.escritos === 0, `nada escrito: o nome não confere (escreveu ${r15.escritos})`);

const conf15 = await chamar("conferencia:listar");
const barrado = conf15.pendencias.find((p) => p.pedido === "#1099");
tudo &= ok(!!barrado, "o pedido barrado APARECE na conferência");
tudo &= ok(barrado?.motivo.codigo === "nome-nao-confere",
  `com o motivo certo (${barrado?.motivo.codigo})`);
tudo &= ok(barrado?.motivo.rotulo === "nome não confere", "e com rótulo legível, não o código cru");
tudo &= ok(barrado?.lados?.shopee?.nome === "Sônia Aparecida Pinto",
  `mostrando o nome da Shopee (${barrado?.lados?.shopee?.nome})`);
tudo &= ok(barrado?.lados?.shopify?.nome === "Outra Pessoa Entrega",
  `e o da Shopify ao lado (${barrado?.lados?.shopify?.nome})`);

sec("16 · e sobrevive a fechar o app");
const sobrou = JSON.parse((await import("node:child_process")).execFileSync(process.execPath,
  ["--input-type=module", "-e", `
    const { pendentesAbertos } = await import("${process.cwd()}/src/armazenamento/index.mjs");
    const { lerDetalhe } = await import("${process.cwd()}/src/armazenamento/detalhe.mjs");
    const p = pendentesAbertos().find((x) => x.pedido === "#1099");
    console.log(JSON.stringify(p ? { motivo: p.motivo, det: lerDetalhe(p.detalhe) } : null));
  `], { encoding: "utf8", env: { ...process.env } }).trim());
tudo &= ok(sobrou?.motivo === "nome-nao-confere", "o motivo ficou guardado");
tudo &= ok(sobrou?.det?.shopify === "Outra Pessoa Entrega",
  "e o detalhe que explica o motivo também — sem ele a tela não ajuda a decidir");

/* ───────── 17. o ambiente não manda na planilha escolhida ───────── */
sec("17 · a planilha que a pessoa escolheu vence o ambiente");
// No app, o .env do projeto é carregado em desenvolvimento. Ele traz o
// PLANILHA_ABA da planilha ANTIGA, e isso procurava uma aba que não existe
// no arquivo novo: a rodada morria com "aba não encontrada" logo depois de
// a etapa 1 mostrar os números certos.
process.env.PLANILHA_ABA = "Página1";          // a aba do OUTRO arquivo
process.env.PLANILHA = "/nao/existe.xlsx";
await chamar("planilha:esquecer", {});
const lida17 = await chamar("planilha:ler", { caminho: planilha });
tudo &= ok(lida17.aba === "PEDIDOS", `a etapa 1 lê a aba do arquivo (${lida17.aba})`);

let contas17 = null, erro17 = null;
try { contas17 = await chamar("rodada:contas"); } catch (e) { erro17 = e.message; }
tudo &= ok(!erro17, `e a rodada também, sem "aba não encontrada" (${erro17 ?? "sem erro"})`);
tudo &= ok(contas17?.length === 2, `achou as 2 contas (achou ${contas17?.length})`);
// E a camada de baixo também: quem chama descobrirContas com um arquivo
// explícito não pode receber a aba do ambiente por tabela. Sem esta linha,
// a ponte podia estar consertada e o ciclo continuar quebrado para quem o
// chama direto — e foi por ali que a rodada morreu.
const { descobrirContas: descobrir } = await import("../src/ciclo.mjs");
let erroDireto = null, contasDireto = null;
try {
  contasDireto = await descobrir([], { planilha, ignorarRecorte: true });
} catch (e) { erroDireto = e.message; }
tudo &= ok(!erroDireto,
  `chamando o ciclo direto, sem dizer a aba, também passa (${erroDireto ?? "sem erro"})`);
tudo &= ok(contasDireto?.length === 2, `e acha as 2 contas (achou ${contasDireto?.length})`);

delete process.env.PLANILHA_ABA;
delete process.env.PLANILHA;

/* ───────── 18. sem configurar, a rodada nem começa ───────── */
sec("18 · a rodada recusa antes de abrir o primeiro navegador");
// Checar no meio seria tarde: a essa altura já abriu dois perfis, mexeu em
// duas sessões da Shopee e gastou dez minutos — para descobrir algo que
// dava para saber antes de clicar.
process.env.AJUSTES_ARQUIVO = join(dir, "ajustes-vazio.json");
let semConfig = null;
try {
  await chamar("rodada:iniciar", { contas: [{ conta: 124, serial: 1 }] });
} catch (e) { semConfig = e.message; }
tudo &= ok(!!semConfig, "a rodada foi recusada");
tudo &= ok(/Ajustes/.test(semConfig ?? ""), `e a mensagem diz onde resolver (${semConfig})`);
tudo &= ok(/senha/.test(semConfig ?? ""), "dizendo o que falta, não só que falta algo");
tudo &= ok(!(await chamar("rodada:emCurso")), "e nenhuma rodada ficou pendurada");

rmSync(dir, { recursive: true, force: true });
console.log(tudo ? "\n\x1b[32m\x1b[1m  o fluxo fecha de ponta a ponta\x1b[0m\n"
                 : "\n\x1b[31m\x1b[1m  o fluxo tem furo\x1b[0m\n");
process.exit(tudo ? 0 : 1);
