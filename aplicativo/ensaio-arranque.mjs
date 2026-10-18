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
  tudo &= ok(!/Conectado ao AdsPower/.test(fatos.ads),
    "o AdsPower NÃO diz 'Conectado' antes de alguém testar");
  tudo &= ok(/não testado/i.test(fatos.ads), "diz que ainda não foi testado");
  tudo &= ok(/Nenhuma conta visitada/.test(fatos.contasVazio),
    "a aba Contas vazia diz que está vazia");
  tudo &= ok(/Nenhuma rodada ainda/.test(fatos.histVazio),
    "o Histórico vazio diz que está vazio, em vez de 40 dias sorteados");
  tudo &= ok(!/null|undefined/.test(fatos.contasVazio + fatos.histVazio),
    "e nenhum 'null' ou 'undefined' escrito na tela");

  await writeFile("/tmp/arranque.png", (await w.webContents.capturePage()).toPNG());
  console.log(tudo ? "\n\x1b[32m\x1b[1m  nada inventado na tela\x1b[0m\n"
                   : "\n\x1b[31m\x1b[1m  ainda há dado inventado na tela\x1b[0m\n");
  app.exit(tudo ? 0 : 1);
});
