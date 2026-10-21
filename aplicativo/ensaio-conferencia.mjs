// Conferência com cliente de dois pedidos e pedido de dois produtos — Chomps,
// 21/10/2026. Confere O QUE cada botão manda escrever, e em qual pedido.
//
//   npm run ensaio:conferencia
import { app, BrowserWindow } from "electron";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "esteira-conf-"));
mkdirSync(join(dir, "estado"), { recursive: true });
process.env.ESTADO_DIR = join(dir, "estado"); process.env.TRABALHO_DIR = dir;
process.env.RECURSOS_DIR = join(import.meta.dirname, "..");
writeFileSync(join(dir, "estado", "ajustes.json"), JSON.stringify({ guiaConcluido: true }));
app.setPath("userData", join(dir, "dados-electron"));
await import("./principal.mjs");
const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let tudo = true;

const amb = (pedido, conta, nome, cands) => ({ pedido, conta, nome, dias: 1,
  motivo: { codigo: "ambiguo", grupo: "precisa", rotulo: "dois candidatos", texto: "x", acao: "y" },
  candidatos: cands.map(([c, v]) => ({ codigos: [c], valor: v, cep: "08900000" })) });
const EDESIO = [["BR2620456593785", 34.8], ["BR265742968962P", 14.66]];

app.whenReady().then(async () => {
  await espera(3500);
  const w = BrowserWindow.getAllWindows()[0];
  const js = (c) => w.webContents.executeJavaScript(c);
  const montar = (pend) => js(`window.__decisoes = [];
    window.GANCHOS.decidir = async (pedido, ordem) => { window.__decisoes.push([pedido, ordem.decisao, ordem.texto]); return { reversivel: false }; };
    window.TELA.conferencia({ pendencias: ${JSON.stringify(pend)}, sozinhos: [] });
    document.querySelector('[data-etapa="3"]').click();`);

  await montar([amb("Pedido #165172", 162, "EDESIO LOPES DE CERQUEIRA", EDESIO), amb("Pedido #165173", 162, "Edesio Lopes de Cerqueira", EDESIO),
                amb("Pedido #164925", 128, "JOSE ERNESTO", [["BR262981565516C", 51.9], ["BR269462194730E", 36.4]])]);
  await espera(400);
  const vis = await js(`[...document.querySelectorAll(".cand-todos")].map(t => t.closest(".item").dataset.pedido + ":" + (t.hidden ? "não" : "sim")).join(" ")`);
  tudo &= ok(vis === "Pedido #165172:não Pedido #165173:não Pedido #164925:sim",
    `"Usar os dois" só no pedido de 2 produtos, nunca nos dois pedidos do mesmo cliente (${vis})`);
  const rot = await js(`document.querySelector('#cxPrecisa .item[data-pedido="Pedido #165172"] .cand-irmao').innerText`);
  tudo &= ok(rot === "o Pedido #165173 fica com BR265742968962P", `diz o que acontece com o outro: "${rot}"`);

  await js(`[...document.querySelectorAll('#cxPrecisa .item[data-pedido="Pedido #165172"] [data-usar-codigo]')].find(b => b.dataset.usarCodigo === "BR2620456593785").click()`);
  await espera(500);
  let dec = await js(`JSON.stringify(window.__decisoes)`);
  tudo &= ok(dec === JSON.stringify([["Pedido #165172", "colar", "BR2620456593785"], ["Pedido #165173", "colar", "BR265742968962P"]]),
    `um clique escreve os dois, cada um com o seu rastreio (${dec})`);

  await js(`document.querySelector('#cxPrecisa .item[data-pedido="Pedido #164925"] [data-usar-todos]').click()`);
  await espera(400);
  dec = await js(`JSON.stringify(window.__decisoes.slice(-1))`);
  tudo &= ok(dec === JSON.stringify([["Pedido #164925", "colar", "BR262981565516C BR269462194730E"]]),
    `"Usar os dois" escreve os dois rastreios no mesmo pedido (${dec})`);

  // três pedidos do mesmo cliente: nenhum vira automático
  await montar([amb("Pedido #1", 7, "ANA", EDESIO), amb("Pedido #2", 7, "ANA", EDESIO), amb("Pedido #3", 7, "ANA", EDESIO)]);
  await espera(400);
  await js(`document.querySelector('#cxPrecisa .item[data-pedido="Pedido #1"] [data-usar-codigo]').click()`);
  await espera(400);
  dec = await js(`JSON.stringify(window.__decisoes)`);
  tudo &= ok(JSON.parse(dec).length === 1, "com três pedidos do mesmo cliente, só o escolhido é escrito (sem adivinhar os outros)");

  console.log(tudo ? "\n\x1b[32m\x1b[1m  conferência: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  conferência: FALHOU\x1b[0m\n");
  app.exit(tudo ? 0 : 1);
});
