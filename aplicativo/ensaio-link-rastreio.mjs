// O link de rastreio na janela de verdade: o campo em Ajustes (com o
// exemplo de como fica) e "Corrigir o link dos pedidos já escritos" em dois
// passos, contra uma Shopify de mentira que substitui o rastreio inteiro ao
// atualizar (como a de verdade, medido na loja de teste em 26/10/2026).
//
//   npm run ensaio:link          (ESTEIRA_FOTO=<pasta> grava os prints)
import { app, BrowserWindow } from "electron";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "esteira-link-"));
mkdirSync(join(dir, "estado"), { recursive: true });
process.env.ESTADO_DIR = join(dir, "estado"); process.env.TRABALHO_DIR = dir;
process.env.RECURSOS_DIR = join(import.meta.dirname, "..");
process.env.SHOPIFY_CONEXAO_ARQUIVO = join(dir, "conexao.json");
process.env.REGISTRO_ESCRITAS = join(dir, "escritas.json");
delete process.env.LINK_RASTREIO;
writeFileSync(process.env.SHOPIFY_CONEXAO_ARQUIVO, JSON.stringify({ loja: "loja-teste.myshopify.com", modo: "token-fixo", accessToken: "x" }));
writeFileSync(join(dir, "estado", "ajustes.json"), JSON.stringify({ guiaConcluido: true }));
app.setPath("userData", join(dir, "dados-electron"));

const C = (c) => `https://rastreamento.correios.com.br/app/index.php?objeto=${c}`;
const P = (c) => `https://parcelsapp.com/pt/tracking/${c}`;
const loja = new Map([
  ["gid://F/1", { status: "SUCCESS", pedido: "#165172", trackingInfo: [{ number: "BR2620456593785", url: C("BR2620456593785"), company: "Correios" }] }],
  ["gid://F/2", { status: "SUCCESS", pedido: "#166286", trackingInfo: ["BR262833412675I", "BR266998634725G", "SPXLM17442804"].map((n) => ({ number: n, url: C(n), company: "Correios" })) }],
  ["gid://F/3", { status: "SUCCESS", pedido: "#165300", trackingInfo: [{ number: "BR269253080925G", url: P("BR269253080925G"), company: "Shopee Xpress" }] }],
]);
writeFileSync(process.env.REGISTRO_ESCRITAS, JSON.stringify({ "165172": { fulfillmentId: "gid://F/1" }, "166286": { fulfillmentId: "gid://F/2" }, "165300": { fulfillmentId: "gid://F/3" } }));
let atualizacoes = 0;
globalThis.fetch = async (url, opcoes = {}) => {
  const { query: q = "", variables: v = {} } = JSON.parse(opcoes.body ?? "{}");
  const resp = (data) => new Response(JSON.stringify({ data }), { status: 200 });
  if (/fulfillmentTrackingInfoUpdate/.test(q)) {
    atualizacoes++;
    const f = loja.get(v.id), t = v.t, nums = t.numbers ?? [t.number], urls = t.urls ?? [t.url];
    f.trackingInfo = nums.map((n, i) => ({ number: n, url: urls[i], company: t.company }));
    await new Promise((r) => setTimeout(r, 250));
    return resp({ fulfillmentTrackingInfoUpdate: { userErrors: [], fulfillment: { id: v.id, trackingInfo: f.trackingInfo } } });
  }
  if (/nodes\(ids/.test(q)) return resp({ nodes: v.ids.map((id) => { const f = loja.get(id); return f && { id, status: f.status, order: { name: f.pedido }, trackingInfo: f.trackingInfo }; }) });
  return resp({});
};

await import("./principal.mjs");
const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const FOTO = process.env.ESTEIRA_FOTO;
let tudo = true;

// um passo que quebra não pode deixar a janela aberta para sempre
process.on("unhandledRejection", (e) => { console.log("  \x1b[31m✗ quebrou: " + (e?.message ?? e) + "\x1b[0m"); app.exit(1); });
setTimeout(() => { console.log("  \x1b[31m✗ passou de 90 s\x1b[0m"); app.exit(1); }, 90_000).unref?.();
app.whenReady().then(async () => {
  await espera(3500);
  const w = BrowserWindow.getAllWindows()[0];
  w.setSize(1280, 900);
  const js = (c) => w.webContents.executeJavaScript(c);
  const foto = async (nome) => { if (FOTO) { w.show(); w.focus(); w.webContents.invalidate(); await espera(800); await writeFile(join(FOTO, nome), (await w.webContents.capturePage()).toPNG()); } };
  await js(`window.__avisos = []; window.TELA.avisar = (t, c) => window.__avisos.push(t + " — " + c); document.querySelector('.apoio [data-tela="ajustes"]').click(); 1`);
  await espera(800);

  console.log("\n\x1b[1mO link de rastreio, na janela\x1b[0m");
  const ex0 = await js(`document.getElementById("ajLinkEx").textContent`);
  tudo &= ok(ex0 === P("BR2620456593785"), `campo vazio: o exemplo já mostra o parcelsapp (${ex0})`);
  // o Matheus cola o endereço sem o código, como fez na Shopify
  await js(`{ const c = document.getElementById("ajLink"); c.value = "https://parcelsapp.com/pt/tracking"; c.dispatchEvent(new Event("input")); c.dispatchEvent(new Event("change")); } 1`);
  await espera(600);
  const ex1 = await js(`document.getElementById("ajLinkEx").textContent`);
  const { lerAjustes } = await import("../src/ajustes.mjs");
  tudo &= ok(ex1 === P("BR2620456593785") && lerAjustes().linkRastreio === "https://parcelsapp.com/pt/tracking" && process.env.LINK_RASTREIO === "https://parcelsapp.com/pt/tracking",
    "colado sem o código: guardado, chega ao robô, e o exemplo mostra o código no fim");
  // link torto: recusado ao salvar, com o motivo
  await js(`{ const c = document.getElementById("ajLink"); c.value = "parcelsapp.com/pt/tracking"; c.dispatchEvent(new Event("input")); c.dispatchEvent(new Event("change")); } 1`);
  await espera(600);
  const ex2 = await js(`document.getElementById("ajLinkEx").textContent`);
  const av = await js(`window.__avisos.join(" | ")`);
  tudo &= ok(/https:\/\//.test(ex2) && /Não consegui guardar o link/.test(av) && process.env.LINK_RASTREIO === "https://parcelsapp.com/pt/tracking",
    "sem https://: o exemplo avisa, não guarda, e o robô continua com o link bom");
  await js(`{ const c = document.getElementById("ajLink"); c.value = "https://parcelsapp.com/pt/tracking"; c.dispatchEvent(new Event("input")); } 1`);
  await espera(400);

  // conferir: só lê
  await js(`document.getElementById("blLink").scrollIntoView(); document.getElementById("bConferirLinks").click(); 1`);
  await espera(1200);
  const txt = await js(`document.getElementById("linksTxt").innerText`);
  const botao = await js(`document.getElementById("linksBotoes").hidden ? "" : document.getElementById("bCorrigirLinks").innerText`);
  tudo &= ok(/2 pedido\(s\) com o link antigo/.test(txt) && /1 já certos/.test(txt) && botao === "Trocar 2" && atualizacoes === 0,
    `conferir: "${txt.split("\n")[0]}" e o botão "${botao}" — nada mudou na Shopify ainda`);
  await foto("8-ajustes-link.png");

  await js(`document.getElementById("bCorrigirLinks").click(); 1`);
  for (let i = 0; i < 30 && !/com o link novo/.test(await js(`document.getElementById("linksTxt").innerText`)); i++) await espera(200);
  const fim = await js(`document.getElementById("linksTxt").innerText`);
  const f2 = loja.get("gid://F/2").trackingInfo;
  tudo &= ok(/2 pedido\(s\) com o link novo/.test(fim), `trocar: "${fim}"`);
  tudo &= ok(f2.length === 3 && f2.every((t) => t.url === P(t.number) && t.company === "Shopee Xpress"), "o pedido de 3 códigos ficou com os 3, todos com o link novo");
  await foto("9-ajustes-link-trocado.png");

  console.log(tudo ? "\n\x1b[32m\x1b[1m  link de rastreio na janela: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  link de rastreio na janela: FALHOU\x1b[0m\n");
  app.exit(tudo ? 0 : 1);
});
