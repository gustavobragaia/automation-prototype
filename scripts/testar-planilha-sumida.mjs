// A planilha que some depois de escolhida — Chomps, 26 e 27/10/2026.
//
// 27/10: o Matheus escolheu "modelo-esteira_filtrado (2).xlsx" em Downloads
// (255 pedidos, 35 contas). Quando a rodada foi montar a lista, o arquivo não
// estava mais lá, e o código caiu na varredura de TODOS os perfis do
// AdsPower: 500 contas, nenhuma da planilha (777, 779, 781…).
// 26/10: a "(8)" sumiu no meio da rodada; a coleta inteira não cruzou com
// nada ("escrita não realizada"), e isso só foi para o log.
//
// Aqui: a ponte do app de verdade, um AdsPower de mentira com 200 perfis, e a
// planilha numa pasta "Downloads" de mentira que é apagada no meio.
import { mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

const dir = mkdtempSync(join(tmpdir(), "esteira-sumida-"));
process.env.TRABALHO_DIR = join(dir, "trabalho"); process.env.ESTADO_DIR = join(dir, "estado");
process.env.AJUSTES_ARQUIVO = join(dir, "ajustes.json");
process.env.SHOPIFY_CONEXAO_ARQUIVO = join(dir, "conexao.json");
writeFileSync(process.env.SHOPIFY_CONEXAO_ARQUIVO, JSON.stringify({ loja: "t.myshopify.com", modo: "token-fixo", accessToken: "x" }));
const DOWNLOADS = join(dir, "Downloads"); mkdirSync(DOWNLOADS);

// Se uma trava falhar, a rodada COMEÇA (com 200 perfis de mentira) e o
// teste ficaria preso: falha em vez de travar.
setTimeout(() => { console.log("  \x1b[31m✗ passou de 90 s — a rodada provavelmente começou\x1b[0m"); process.exit(1); }, 90_000).unref();
const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

// ── um AdsPower de mentira: 200 perfis, "Shopee 1" a "Shopee 200" + 453..455 ──
let chamadasAds = 0;
const perfis = [...Array.from({ length: 197 }, (_, i) => 600 + i), 453, 454, 455, 456]
  .map((n) => ({ user_id: `u${n}`, serial_number: String(n), name: `Shopee ${n}` }));
const ads = createServer((req, res) => {
  chamadasAds++;
  const u = new URL(req.url, "http://x");
  const pagina = Number(u.searchParams.get("page") ?? 1), tam = Number(u.searchParams.get("page_size") ?? 100);
  res.end(JSON.stringify({ code: 0, msg: "ok", data: { list: perfis.slice((pagina - 1) * tam, pagina * tam) } }));
});
await new Promise((r) => ads.listen(0, "127.0.0.1", r));
process.env.ADSPOWER_BASE = `http://127.0.0.1:${ads.address().port}`;

const { default: ExcelJS } = await import("../src/excel.mjs");
async function planilha(caminho, contas) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("PEDIDOS");
  ws.addRow(["DATA", "NÚMERO DO PEDIDO", "NOME DO CLIENTE", "VALOR PAGO", "CÓDIGO DE RASTREIO", "ONDE FOI FEITO O PEDIDO"]);
  contas.forEach((c, i) => ws.addRow(["27/10", `Pedido #${180000 + i}`, `Cliente ${i}`, 10, null, `shopee ${c}`]));
  await wb.xlsx.writeFile(caminho);
}

const { construir } = await import("../aplicativo/ponte.mjs");
const { iniciarColetor } = await import("../src/coletor.mjs");
const { salvarAjustes, aplicarNoAmbiente } = await import("../src/ajustes.mjs");
aplicarNoAmbiente(salvarAjustes({ shopeeSenha: "x", codigoChave: "y", emailPrefixo: "loja", emailDominio: "ex.com" }));
const coletor = await iniciarColetor({ porta: 39821 });
const ponte = construir({ aoLog: () => {}, porta: 39821 });
const des = async (p) => { const r = await p; if (r && r.ok === false) throw new Error(r.erro); return r && "ok" in r && "dado" in r ? r.dado : r; };
const erroDe = async (p) => { try { await des(p); return null; } catch (e) { return e.message; } };

sec("1. O caso de 27/10: a planilha some de Downloads depois de escolhida");
const original = join(DOWNLOADS, "modelo-esteira_filtrado (2).xlsx");
let contasDaRodada;
{
  await planilha(original, [453, 454, 455]);
  const r = await des(ponte["planilha:ler"]({ caminho: original }));
  tudo &= ok(r.contas.length === 3, `escolhida: ${r.contas.length} contas (453, 454, 455)`);
  rmSync(original);                                   // some de Downloads
  tudo &= ok(!existsSync(original), "o original foi apagado");
  chamadasAds = 0;
  contasDaRodada = await des(ponte["rodada:contas"]([]));
  tudo &= ok(contasDaRodada.map((c) => c.conta).sort().join() === "453,454,455",
    `a rodada monta com a cópia: só as 3 da planilha (${contasDaRodada.map((c) => c.conta).join(", ")}) — antes: os 200 perfis do AdsPower`);
  const copias = readdirSync(join(dir, "trabalho", "planilhas"));
  tudo &= ok(copias.length === 1 && /modelo-esteira_filtrado \(2\)\.xlsx$/.test(copias[0]), `a cópia está guardada com o Esteira (${copias[0]})`);
}

sec("2. A rodada só abre conta que veio da planilha");
{
  const fora = await erroDe(ponte["rodada:iniciar"]({ contas: [...contasDaRodada, { conta: 777, serial: 777 }] }));
  tudo &= ok(/1 conta\(s\) da rodada não estão na planilha \(777\)/.test(fora ?? ""), `com uma conta de fora: não começa ("${fora}")`);
  const muitas = await erroDe(ponte["rodada:iniciar"]({ contas: perfis.map((p) => ({ conta: Number(p.serial_number), serial: p.serial_number })) }));
  tudo &= ok(/não estão na planilha/.test(muitas ?? ""), "com os 200 perfis do AdsPower (o que aconteceu em 27/10): não começa");
  // o "Tentar de novo só essas" manda um pedaço da rodada: passa da trava
  const { travaDaRodada } = await import("../src/planilha-copia.mjs");
  const copiasAgora = readdirSync(join(dir, "trabalho", "planilhas")).map((f) => join(dir, "trabalho", "planilhas", f));
  const daPlanilha = new Set(contasDaRodada.map((c) => c.conta));
  tudo &= ok(travaDaRodada({ planilhas: copiasAgora, contas: [contasDaRodada[0]], daPlanilha }) === null,
    "só algumas contas da planilha (\"Tentar de novo só essas\"): passa da trava");
  tudo &= ok(travaDaRodada({ planilhas: copiasAgora, contas: contasDaRodada, daPlanilha }) === null, "a rodada inteira da planilha: passa da trava");
}

sec("3. Planilha que não existe mais: erro, nunca o AdsPower inteiro");
{
  const { descobrirContas } = await import("../src/ciclo.mjs");
  chamadasAds = 0;
  const e = await erroDe(descobrirContas([], { planilha: join(DOWNLOADS, "nao-existe.xlsx"), ignorarRecorte: true }));
  tudo &= ok(/não está mais acessível/.test(e ?? "") && chamadasAds === 0, `"${e}" — sem chamar o AdsPower (${chamadasAds} chamadas)`);
  // e a cópia apagada também: a rodada não começa
  for (const f of readdirSync(join(dir, "trabalho", "planilhas"))) rmSync(join(dir, "trabalho", "planilhas", f));
  const e2 = await erroDe(ponte["rodada:iniciar"]({ contas: contasDaRodada }));
  tudo &= ok(/não está mais acessível — escolha de novo na etapa 1/.test(e2 ?? "") && /modelo-esteira_filtrado \(2\)\.xlsx/.test(e2 ?? ""),
    `sem cópia e sem original: a rodada não começa ("${e2}")`);
}

sec("4. Editar a planilha e escolher de novo: vale a versão nova");
{
  const outra = join(DOWNLOADS, "modelo-esteira.xlsx");
  await planilha(outra, [453]);
  await des(ponte["planilha:esquecer"]({}));
  await des(ponte["planilha:ler"]({ caminho: outra }));
  await planilha(outra, [453, 456]);                  // ele editou e salvou por cima
  await des(ponte["planilha:ler"]({ caminho: outra }));
  const c = await des(ponte["rodada:contas"]([]));
  tudo &= ok(c.map((x) => x.conta).sort().join() === "453,456", `a rodada usa a versão editada, uma vez só (${c.map((x) => x.conta).join(", ")})`);
  await des(ponte["planilha:esquecer"]({ caminho: outra }));   // a tela manda o ORIGINAL
  const e = await erroDe(ponte["rodada:contas"]([]));
  tudo &= ok(/nenhuma planilha/.test(e ?? ""), "\"tirar planilha\" pelo caminho original tira a cópia");
}

sec("5. O caso de 26/10: o original some no meio — conferência e escrita seguem");
{
  const p = join(DOWNLOADS, "modelo-esteira_filtrado (8).xlsx");
  await planilha(p, [453, 454]);
  await des(ponte["planilha:ler"]({ caminho: p }));
  rmSync(p);
  globalThis.fetch = (async (orig) => async (url, opcoes) => String(url).includes("myshopify")
    ? new Response(JSON.stringify({ data: { orders: { pageInfo: { hasNextPage: false }, nodes: [] } } }), { status: 200 })
    : orig(url, opcoes))(globalThis.fetch);
  const conf = await erroDe(ponte["conferencia:listar"]({}));
  const esc = await erroDe(ponte["escrita:listar"]({}));
  tudo &= ok(conf === null && esc === null, `conferência e etapa 4 montam com a cópia (${conf ?? "ok"} / ${esc ?? "ok"})`);
  // e se o cruzamento do fim da rodada falhar mesmo assim, vira alerta no sino
  const { rodarCiclo } = await import("../src/ciclo.mjs");
  const { lerAlertas } = await import("../src/alertas.mjs");
  await rodarCiclo({ contas: [], escrever: false, planilhas: [join(DOWNLOADS, "sumiu.xlsx")] });
  const a = lerAlertas().find((x) => x.id === "rodada-sem-cruzar");
  tudo &= ok(/não conseguiu cruzar com a planilha/.test(a?.titulo ?? "") && /escolha a planilha de novo/i.test(a?.acao ?? ""),
    `o cruzamento que falha no fim vira alerta: "${a?.titulo}" (antes: só no log)`);
}

sec("6. As cópias velhas saem; a cópia de um arquivo velho, não");
{
  const { copiarPlanilha, limparVelhas } = await import("../src/planilha-copia.mjs");
  const velho = join(DOWNLOADS, "baixada-em-agosto.xlsx");
  await planilha(velho, [453]);
  const quarentaDias = new Date(Date.now() - 40 * 86_400_000);
  utimesSync(velho, quarentaDias, quarentaDias);
  const copia = copiarPlanilha(velho);
  tudo &= ok(existsSync(copia), "arquivo de 40 dias atrás: a cópia de hoje fica (a data é a da cópia)");
  const antiga = join(dir, "trabalho", "planilhas", "1-antiga.xlsx");
  writeFileSync(antiga, "x"); utimesSync(antiga, quarentaDias, quarentaDias);
  tudo &= ok(limparVelhas() === 1 && !existsSync(antiga) && existsSync(copia), "cópia com mais de 30 dias é apagada; a nova fica");
}

await coletor.fechar();
ads.close();
console.log(tudo ? "\n\x1b[32m\x1b[1m  planilha que some: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  planilha que some: FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
