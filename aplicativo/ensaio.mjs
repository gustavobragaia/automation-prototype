// Ensaio da conferência COM A JANELA ABERTA.
//
//   npm run ensaio
//
// scripts/testar-fluxo.mjs já prova o robô, e roda no `npm test` porque é
// rápido e não precisa de tela. Este aqui prova o pedaço que aquele não
// alcança: o clique de verdade num botão de verdade, atravessando o IPC.
//
// Monta um cenário descartável numa pasta temporária — não encosta no
// estado da máquina — sobe o app, pede a conferência, clica em "Usar essa
// conta" e confere três coisas: o item sumiu da tela, virou uma decisão
// tratada, e está no disco com a conta nova.
//
// Sai com código 1 se qualquer uma falhar, para poder entrar numa esteira
// de verificação depois.
import { app, BrowserWindow } from "electron";
import { writeFile, writeFile as wf } from "node:fs/promises";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = "/Users/gustavobragaia/Documents/shopee-tracking-bot";
const dir = mkdtempSync(join(tmpdir(), "esteira-tela-"));
process.env.ESTADO_DIR = join(dir, "estado");
process.env.TRABALHO_DIR = dir;
process.env.RECURSOS_DIR = raiz;
process.env.SHOPIFY_CONEXAO_ARQUIVO = join(dir, "conexao.json");
writeFileSync(process.env.SHOPIFY_CONEXAO_ARQUIVO, JSON.stringify({
  modo: "token-fixo", loja: "lojateste.myshopify.com", token: "shpat_x" }));

const { montarCenario, fingirShopify } = await import(`${raiz}/scripts/cenario-conferencia.mjs`);
const { planilha } = await montarCenario(dir);
fingirShopify({ pedidos: {} });

await import("./principal.mjs");

app.whenReady().then(async () => {
  const { guardarPendentes } = await import(`${raiz}/src/estado.mjs`);
  const { conciliar, lerColetas } = await import(`${raiz}/src/conciliar.mjs`);
  const { lerPendentes } = await import(`${raiz}/src/planilha.mjs`);
  const r = await lerPendentes(planilha);
  const { linhas } = conciliar(r.contas, lerColetas());
  guardarPendentes(linhas.filter((l) => l.motivo)
    .map((l) => ({ ...l.p, conta: l.conta, motivo: l.motivo })));

  await new Promise((s) => setTimeout(s, 3500));
  const w = BrowserWindow.getAllWindows()[0];
  // a tela lê a planilha pela ponte (é assim que a ponte passa a conhecê-la)
  await w.webContents.executeJavaScript(
    `window.esteira.pedir("planilha:ler", { caminho: ${JSON.stringify(planilha)} })`);
  // e então monta a conferência, exatamente como faz no fim de uma rodada
  const quantos = await w.webContents.executeJavaScript(`(async () => {
    const r = await window.esteira.pedir("conferencia:listar", {});
    const d = r.dado && r.dado.dado ? r.dado.dado : r.dado;
    window.TELA.conferencia(d);
    document.querySelector('[data-etapa="3"],[data-ir="3"]')?.click();
    return document.querySelectorAll("#cxPrecisa .item[data-rev]").length;
  })()`);
  await new Promise((s) => setTimeout(s, 500));

  // Clica em "Usar essa conta" no #1003 e espera o item sumir — o que só
  // acontece se a ponte gravou. É o caminho inteiro: clique -> GANCHOS ->
  // IPC -> ponte -> armazenamento -> de volta à tela.
  await w.webContents.executeJavaScript(
    `document.querySelector('[data-pedido="#1003"] [data-usar-conta]').click()`);
  await new Promise((s) => setTimeout(s, 1200));
  const depois = await w.webContents.executeJavaScript(`({
    naTela: document.querySelectorAll("#cxPrecisa .item[data-rev]").length,
    tratados: document.querySelectorAll("#listaTratados .trat").length,
    aindaTem1003: !!document.querySelector('[data-pedido="#1003"]'),
  })`);
  const noDisco = (await import(`${raiz}/src/estado.mjs`))
    .pendentesAbertos().find((p) => p.pedido === "#1003");

  const ok = (c, m) => { console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`); return c; };
  let tudo = true;
  console.log("");
  tudo &= ok(quantos === 2, `a tela desenhou os 2 que precisam de você (desenhou ${quantos})`);
  tudo &= ok(depois.aindaTem1003 === false, "o item sumiu da lista depois do clique");
  tudo &= ok(depois.naTela === 1, `e sobrou 1 (sobrou ${depois.naTela})`);
  tudo &= ok(depois.tratados === 1, "virou uma decisão em 'já tratados'");
  tudo &= ok(noDisco?.conta === 128, `e no disco está na conta nova (${noDisco?.conta})`);
  tudo &= ok(noDisco?.contaCorrigida === true, "marcado como corrigido à mão");
  console.log(tudo ? "\n\x1b[32m\x1b[1m  a conferência responde ao clique\x1b[0m\n"
                   : "\n\x1b[31m\x1b[1m  a conferência NÃO responde ao clique\x1b[0m\n");
  process.exitCode = tudo ? 0 : 1;

  await new Promise((s) => setTimeout(s, 300));
  await writeFile("/tmp/conferencia.png", (await w.webContents.capturePage()).toPNG());
  console.log("[ensaio] foto tirada");
  app.exit(process.exitCode ?? 0);   // o código de saída tem que chegar ao shell
});
