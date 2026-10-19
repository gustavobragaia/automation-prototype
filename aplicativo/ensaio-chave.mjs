// Ensaio de "conectar com a chave do app" COM A JANELA ABERTA.
//
//   npm run ensaio:chave
//
// O caminho existe porque a Shopify recusou o app com distribuição
// personalizada na loja real ("link de instalação inválido", até com o dono
// logado). Aqui ele é percorrido com cliques de verdade em todas as telas
// que conectam: o guia da primeira vez, Ajustes (com "Trocar de loja" e uma
// chave errada no meio) e o que aparece depois na etapa 4 e na barra lateral.
// A Shopify é fingida, no formato da documentação (formulário).
import { app, BrowserWindow } from "electron";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raiz = new URL("..", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "esteira-chave-"));
process.env.ESTADO_DIR = join(dir, "estado");
process.env.TRABALHO_DIR = dir;
process.env.RECURSOS_DIR = raiz;
process.env.SHOPIFY_CONEXAO_ARQUIVO = join(dir, "conexao.json");
for (const k of ["SHOPIFY_LOJA", "SHOPIFY_TOKEN", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET"]) delete process.env[k];
const FOTOS = process.env.FOTOS;   // opcional: pasta para guardar as telas

const ID = "0123456789abcdef0123456789abcdef", CHAVE = "shpss_" + "c".repeat(32);
const { fingirShopify } = await import(`${raiz}scripts/cenario-conferencia.mjs`);
fingirShopify({});
const fingido = globalThis.fetch;
const trocas = [];
globalThis.fetch = async (url, o) => {
  if (String(url).endsWith("/admin/oauth/access_token")) {
    const b = Object.fromEntries(new URLSearchParams(o.body));
    trocas.push({ formato: o.headers["Content-Type"], grant: b.grant_type });
    if (b.client_id !== ID || b.client_secret !== CHAVE)
      return new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 });
    return new Response(JSON.stringify({ access_token: "shpat_fingido", scope: "read_orders", expires_in: 86399 }));
  }
  if (String(url).endsWith("/status")) return new Response(JSON.stringify({ code: 0 }));
  return fingido(url, o);
};

app.setPath("userData", join(dir, "dados-electron"));
await import("./principal.mjs");

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
let tudo = true;

app.whenReady().then(async () => {
  await dorme(4000);
  const w = BrowserWindow.getAllWindows()[0];
  const js = (c) => w.webContents.executeJavaScript(c);
  const clica = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
  const escreve = async (sel, v) => {
    const r = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return "faltou";
      e.focus(); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event("input", { bubbles: true })); return "ok"; })()`);
    if (r !== "ok") throw new Error(`o campo ${sel} não está na tela`);
  };
  const texto = (sel) => js(`(document.querySelector(${JSON.stringify(sel)}) || {}).innerText || ""`);
  // condição que dá erro (elemento sumiu) conta como "ainda não" — e no fim
  // diz o que estava na tela, para o ensaio explicar a falha em vez de travar
  const espera = async (cond, ms = 8000) => {
    for (let t = 0; t < ms; t += 250) {
      if (await js(`(() => { try { return !!(${cond}); } catch (e) { return false; } })()`)) return true;
      await dorme(250);
    }
    console.log("    (na tela: " + (await js(`(document.getElementById("shopCorpo")||{}).innerText||""`)).replace(/\s+/g, " ").slice(0, 300) + ")");
    return false;
  };
  const foto = async (nome) => { if (!FOTOS) return; await dorme(400); w.webContents.invalidate(); await dorme(300);
    writeFileSync(join(FOTOS, nome + ".png"), (await w.webContents.capturePage()).toPNG()); };

  console.log("\n\x1b[1m1 · o guia da primeira vez\x1b[0m");
  tudo &= ok(await espera(`!!document.getElementById("guia")`), "o guia abre numa instalação nova");
  await clica("#gSeguir");                                   // boas-vindas → AdsPower
  await clica("#gPular"); await clica("#gPular");            // AdsPower e contas, depois
  tudo &= ok(/Conectar a Shopify/.test(await texto("#gConteudo")), "chega no passo da Shopify");
  tudo &= ok(await js(`document.getElementById("gSeguir").disabled`), "e o Continuar está travado até conectar");
  await escreve("#gLoja", "loja-sparta-store.myshopify.com");
  if (!(await js(`(() => { const d = document.getElementById("gCred"); if (!d) return false; d.open = true; return true; })()`)))
    throw new Error("o \"conecte com a chave do app\" não está no guia");
  await escreve("#gCliId", ID); await escreve("#gCliChave", CHAVE);
  await foto("1-guia-preenchido");
  await clica("#gConectarCred");
  tudo &= ok(await espera(`/Conectada/.test(document.getElementById("gShopRes").innerText)`),
    "\"Conectar com a chave\" conecta e o guia mostra a loja conectada");
  tudo &= ok(/lojateste/.test(await texto("#gShopRes")), "com o nome que veio da Shopify");
  tudo &= ok(!(await js(`document.getElementById("gSeguir").disabled`)), "e o Continuar destrava");
  tudo &= ok(await js(`document.getElementById("gCliChave").value === ""`), "a chave some do campo depois de usada");
  await foto("2-guia-conectado");
  const c1 = JSON.parse(readFileSync(process.env.SHOPIFY_CONEXAO_ARQUIVO, "utf8"));
  tudo &= ok(c1.modo === "credenciais" && c1.clientId === ID, "gravado no modo credenciais");
  tudo &= ok(trocas.length && trocas.every((t) => t.formato === "application/x-www-form-urlencoded" && t.grant === "client_credentials"),
    "a troca foi como formulário, grant client_credentials (o formato da documentação)");

  // fecha o guia: ele marca concluído e recarrega a tela, que relê a loja
  await clica("#gFechar");
  await dorme(4500);

  console.log("\n\x1b[1m2 · Ajustes\x1b[0m");
  await clica('[data-tela="ajustes"]');
  tudo &= ok(await espera(`/está conectada/.test(document.getElementById("shopCorpo").innerText)`),
    "o cartão da Shopify mostra a loja conectada");
  tudo &= ok(/renova sozinho a cada 24 horas/.test(await texto("#shopCorpo")),
    "e diz que o acesso renova a cada 24 horas — não \"não expira\"");
  await foto("3-ajustes-conectado");

  await clica("#bTrocarShop");
  tudo &= ok(await espera(`!!document.getElementById("bConectarCred")`), "\"Trocar de loja\" desconecta e mostra o formulário de novo");
  tudo &= ok(!existsSync(process.env.SHOPIFY_CONEXAO_ARQUIVO) || readFileSync(process.env.SHOPIFY_CONEXAO_ARQUIVO, "utf8").trim() === "null",
    "e apaga a conexão do disco de verdade");
  await escreve("#shopLoja", "loja-sparta-store.myshopify.com");
  if (!(await js(`(() => { const d = document.getElementById("shopCred"); if (!d) return false; d.open = true; return true; })()`)))
    throw new Error("o \"Ou conecte com a chave do app\" não está no cartão");
  await escreve("#shopCliId", ID); await escreve("#shopCliChave", "shpss_" + "e".repeat(32));
  await clica("#bConectarCred");
  tudo &= ok(await espera(`/recusou o ID ou a chave/.test(document.getElementById("shopCredRes").innerText)`),
    "chave errada: o cartão diz que a Shopify recusou e o que fazer");
  tudo &= ok(!(await js(`document.getElementById("bConectarCred").disabled`)), "e o botão volta a funcionar");
  await foto("4-ajustes-chave-errada");
  await escreve("#shopCliChave", CHAVE);
  await clica("#bConectarCred");
  tudo &= ok(await espera(`/está conectada/.test(document.getElementById("shopCorpo").innerText)`),
    "chave certa: conecta pelo cartão de Ajustes");

  console.log("\n\x1b[1m3 · o resto da tela\x1b[0m");
  await clica('[data-etapa="4"]'); await dorme(400);
  tudo &= ok(/lojateste/.test(await texto("#e4Loja")) && /renova sozinho/.test(await texto("#e4Acesso")),
    "a etapa 4 mostra a loja e que o acesso renova");
  tudo &= ok(await espera(`/lojateste/.test(document.getElementById("ladoStatus").innerText)`),
    "o pé da barra lateral mostra a loja conectada");
  await foto("5-etapa4");
  const excecoes = await js(`window.__erros || []`);
  tudo &= ok(!excecoes.length, "nenhuma exceção na tela");

  console.log(tudo ? "\n\x1b[32m\x1b[1m  conectar com a chave funciona em todas as telas\x1b[0m\n"
                   : "\n\x1b[31m\x1b[1m  conectar com a chave tem furo\x1b[0m\n");
  app.exit(tudo ? 0 : 1);
}).catch((e) => {
  // um erro no meio não pode deixar o ensaio pendurado e calado
  console.log(`  \x1b[31m✗ o ensaio parou: ${e.message}\x1b[0m`);
  app.exit(1);
});
