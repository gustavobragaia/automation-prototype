// O arranque honesto: abrir o app e afirmar que NADA inventado aparece.
//
//   npm run ensaio:arranque
//
// Este é o teste que faltava. A tela nasce com dados de exemplo para rodar
// sozinha num navegador, e eu fui ligando área por área ao robô — sem nunca
// varrer a tela inteira. Sobraram oito lugares mostrando coisa inventada,
// inclusive um "Conectado ao AdsPower" que ninguém tinha testado.
//
// Roda numa pasta de estado VAZIA: um app recém-instalado. Tudo que
// aparecer tem que ser estado vazio honesto, nunca exemplo.
import { app, BrowserWindow } from "electron";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

const dir = mkdtempSync(join(tmpdir(), "esteira-arranque-"));
process.env.ESTADO_DIR = join(dir, "estado");
process.env.TRABALHO_DIR = join(dir, "trabalho");

// Pasta de dados própria: com ela a trava de instância única é outra, e o
// ensaio roda mesmo com o Esteira de verdade aberto (antes ele saía calado).
app.setPath("userData", join(dir, "dados-electron"));
await import("./principal.mjs");

const ok = (c, m) => { console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`); return c; };
let tudo = true;

// Tudo que só existe no protótipo — colhido do PRÓPRIO arquivo da tela, a
// cada execução. Uma lista escrita à mão deixaria passar qualquer vazamento
// com um nome que eu não lembrei de pôr nela; colhendo do arquivo, quem
// acrescentar dado de exemplo novo já está coberto.
import { readFileSync } from "node:fs";
const fonte = readFileSync(new URL("./tela/index.html", import.meta.url), "utf8");
// a tabela ILUSTRATIVA da etapa 1 é instrução, não dado — e usa nomes que
// se anunciam como exemplo ("Maria Exemplo")
const SO_NO_EXEMPLO = [...new Set([
  ...fonte.match(/#16\d{4}/g) ?? [],                                  // pedidos
  ...fonte.match(/k1[a-z0-9]{6}/g) ?? [],                              // perfis
  ...fonte.match(/[a-z0-9-]+\.myshopify\.com/g) ?? [],               // lojas
  ...[...fonte.matchAll(/loja:"([a-z0-9-]{4,})"/g)].map((m) => m[1]),     // nome da loja
  ...fonte.match(/\bBR2\d{11}[A-Z0-9]\b|\bSPX[A-Z]{0,3}\d{6,}\b/g) ?? [], // rastreios
  ...[...fonte.matchAll(/c:"([A-ZÁÉÍÓÚÂÊÔÃÕ][^"]{4,})"/g)].map((m) => m[1]),   // pessoas
  ...[...fonte.matchAll(/"([A-ZÁÉÍÓÚ][a-záéíóúâêôãõç]+ [A-ZÁÉÍÓÚ][a-záéíóúâêôãõç]+(?: [A-ZÁÉÍÓÚ][a-záéíóúâêôãõç]+)?)"/g)]
      .map((m) => m[1]).filter((n) => !/Exemplo/.test(n)),                    // NOMES do histórico
])];
console.log(`  (vigiando ${SO_NO_EXEMPLO.length} marcas de dado de exemplo)`);

app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 4500));
  const w = BrowserWindow.getAllWindows()[0];

  const vazou = async (tela) => {
    if (tela) await w.webContents.executeJavaScript(
      `document.querySelector('[data-tela="${tela}"],[data-etapa="${tela}"],[data-ir="${tela}"]')?.click()`);
    await new Promise((r) => setTimeout(r, 400));
    const texto = await w.webContents.executeJavaScript(`document.body.innerText`);
    return SO_NO_EXEMPLO.filter((x) => texto.includes(x));
  };

  console.log("");
  for (const [tela, nome] of [["1","etapa 1"],["2","etapa 2"],["3","etapa 3"],["4","etapa 4"],
                              ["contas","Contas"],["historico","Histórico"],["ajustes","Ajustes"]]) {
    const v = await vazou(tela);
    tudo &= ok(!v.length, `${nome}: nenhum dado inventado` + (v.length ? ` — vazou: ${v.join(", ")}` : ""));
  }

  const fatos = await w.webContents.executeJavaScript(`({
    ads: document.getElementById("adsResultado").innerText,
    contasVazio: document.getElementById("tbContas").innerText,
    histVazio: document.getElementById("tbHist").innerText,
    selo: !!document.querySelector(".selo-proto"),
  })`);
  // O app testa o AdsPower sozinho ao abrir. A regra continua a mesma: o
  // cartão só pode dizer o que um teste de verdade disse. Então o ensaio
  // roda o mesmo teste pela ponte e compara — "Conectado" só vale se o
  // AdsPower desta máquina de fato respondeu.
  const real = await w.webContents.executeJavaScript(`(async () => {
    const r = await window.esteira.pedir("adspower:diagnosticar", {});
    const d = r.dado && r.dado.dado !== undefined ? r.dado.dado : r.dado; return d; })()`);
  tudo &= ok(fatos.ads.includes(real.titulo),
    `o cartão do AdsPower diz o que o teste de verdade disse ("${real.titulo}")`);
  tudo &= ok(real.ok || !/Conectado ao AdsPower/.test(fatos.ads),
    "e só diz 'Conectado' se o AdsPower respondeu mesmo");
  tudo &= ok(/Nenhuma conta visitada/.test(fatos.contasVazio),
    "a aba Contas vazia diz que está vazia");
  tudo &= ok(/Nenhuma rodada ainda/.test(fatos.histVazio),
    "o Histórico vazio diz que está vazio, em vez de 40 dias sorteados");
  tudo &= ok(!/null|undefined/.test(fatos.contasVazio + fatos.histVazio),
    "e nenhum 'null' ou 'undefined' escrito na tela");

  // ── "Testar conexão" nunca pode girar para sempre ──
  // Um servidor que aceita a conexão e NUNCA responde: o pior caso do
  // AdsPower travado sincronizando. Foi o que o Gustavo viu — a tela
  // "carregando só", sem prazo e sem explicação.
  const http = await import("node:http");
  const buraco = http.createServer(() => { /* aceita e nunca responde */ });
  await new Promise((r) => buraco.listen(39555, "127.0.0.1", r));
  await w.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-tela="ajustes"]').click();
    document.getElementById("adsBase").value = "http://127.0.0.1:39555";
    document.getElementById("bTestarAds").click();
  })()`);
  await new Promise((r) => setTimeout(r, 1000));
  const durante = await w.webContents.executeJavaScript(`({
    travado: document.getElementById("bTestarAds").disabled,
    texto: document.getElementById("adsResultado").innerText })`);
  // um segundo clique impaciente não pode empilhar outra chamada
  await w.webContents.executeJavaScript(`document.getElementById("bTestarAds").click()`);
  await new Promise((r) => setTimeout(r, 21000));
  const depois = await w.webContents.executeJavaScript(`({
    travado: document.getElementById("bTestarAds").disabled,
    texto: document.getElementById("adsResultado").innerText })`);
  buraco.close();

  tudo &= ok(durante.travado, "durante o teste o botão fica travado — clique impaciente não empilha");
  tudo &= ok(/Testando/.test(durante.texto), "e a tela diz que está testando");
  // Quem responde primeiro é o próprio robô ("não está respondendo… porta
  // 39555"), que é mais específico; o prazo de 20s da tela é a rede de
  // segurança para quando nem ele responder. O que se exige é o resultado:
  // parou de girar e explicou.
  tudo &= ok(!/Testando/.test(depois.texto) && /AdsPower n[ãa]o/.test(depois.texto),
    "com o AdsPower mudo, a tela PARA de girar e diz o que houve");
  tudo &= ok(/aberto|sincroniz/.test(depois.texto), "e diz o que fazer");
  tudo &= ok(!depois.travado, "e o botão volta a funcionar");

  await writeFile("/tmp/arranque.png", (await w.webContents.capturePage()).toPNG());
  console.log(tudo ? "\n\x1b[32m\x1b[1m  nada inventado na tela\x1b[0m\n"
                   : "\n\x1b[31m\x1b[1m  ainda há dado inventado na tela\x1b[0m\n");
  app.exit(tudo ? 0 : 1);
});
