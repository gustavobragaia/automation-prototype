// O feedback do Matheus de 22/10/2026, na janela de verdade, de ponta a ponta:
// a ponte, a carteira, o coletor (por HTTP) e a fila são os de verdade; a
// Shopify é de mentira e a "conta" da fila é um processar de mentira.
//
//   npm run ensaio:feedback          (ESTEIRA_FOTO=<pasta> grava os prints)
import { app, BrowserWindow } from "electron";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "esteira-feedback-"));
mkdirSync(join(dir, "estado"), { recursive: true });
process.env.ESTADO_DIR = join(dir, "estado"); process.env.TRABALHO_DIR = dir;
process.env.RECURSOS_DIR = join(import.meta.dirname, "..");
process.env.SHOPIFY_CONEXAO_ARQUIVO = join(dir, "conexao.json");
process.env.REGISTRO_ESCRITAS = join(dir, "escritas.json");
process.env.SHOPEE_SENHA = "s"; process.env.SHOPEE_PREFIXO = "c"; process.env.SHOPEE_EMAIL_DOMINIO = "x.com";
writeFileSync(process.env.SHOPIFY_CONEXAO_ARQUIVO, JSON.stringify({ loja: "loja-teste.myshopify.com", modo: "token-fixo", accessToken: "x" }));
writeFileSync(join(dir, "estado", "ajustes.json"), JSON.stringify({ guiaConcluido: true }));
app.setPath("userData", join(dir, "dados-electron"));

// a loja de mentira
const SITUACAO = { "165001": "FULFILLED", "165002": "UNFULFILLED", "165003": "UNFULFILLED" };
const fetchDeVerdade = globalThis.fetch;
globalThis.fetch = async (url, opcoes = {}) => {
  if (!String(url).includes("myshopify.com")) return fetchDeVerdade(url, opcoes);
  const corpo = JSON.parse(opcoes.body ?? "{}");
  const nums = [...String(corpo.variables?.q ?? "").matchAll(/name:(\d+)/g)].map((m) => m[1]);
  return new Response(JSON.stringify({ data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: nums.map((n) => ({
    name: "#" + n, id: "gid://O/" + n, createdAt: "2026-10-20T10:00:00Z", displayFulfillmentStatus: SITUACAO[n] ?? "UNFULFILLED",
    shippingAddress: { name: "Cliente", zip: "01000000" }, totalPriceSet: { shopMoney: { amount: "1" } },
    lineItems: { nodes: [] }, fulfillmentOrders: { nodes: [] } })) } } }), { status: 200 });
};

await import("./principal.mjs");
const { guardarPendentes, pendentesAbertos } = await import("../src/estado.mjs");
const { default: ExcelJS } = await import("../src/excel.mjs");
const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const FOTO = process.env.ESTEIRA_FOTO;
let tudo = true;

// a carteira como o Matheus a deixou: pedidos de 2 dias atrás, um deles já
// colado à mão na Shopify
const motivo = { codigo: "ambiguo", grupo: "precisa", rotulo: "dois candidatos" };
guardarPendentes([
  { pedido: "Pedido #165001", conta: 141, nome: "MARIA APARECIDA SOUZA", valor: 42.9, motivo },
  { pedido: "Pedido #165002", conta: 141, nome: "JOAO CARLOS PEREIRA", valor: 31.5, motivo },
  { pedido: "Pedido #165003", conta: 188, nome: "ANA PAULA LIMA", valor: 58.0, motivo },
], { em: "2026-10-20T12:00:00Z" });
// a planilha de hoje, que não traz esses pedidos
const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("PEDIDOS");
ws.addRow(["DATA", "NÚMERO DO PEDIDO", "NOME DO CLIENTE", "VALOR PAGO", "CÓDIGO DE RASTREIO", "ONDE FOI FEITO O PEDIDO"]);
ws.addRow(["22/10", "Pedido #170000", "CLIENTE DE HOJE", 20, null, "shopee 120"]);
const planilha = join(dir, "planilha.xlsx"); await wb.xlsx.writeFile(planilha);

app.whenReady().then(async () => {
  await espera(3500);
  const w = BrowserWindow.getAllWindows()[0];
  w.setSize(1280, 860);
  const js = (c) => w.webContents.executeJavaScript(c);
  // a janela em segundo plano não redesenha: sem isso a foto sai com o quadro velho
  const foto = async (nome) => { if (FOTO) { w.show(); w.focus(); w.webContents.invalidate(); await espera(800); await writeFile(join(FOTO, nome), (await w.webContents.capturePage()).toPNG()); } };
  await js(`window.__avisos = []; const a = window.TELA.avisar; window.TELA.avisar = (t, c) => { window.__avisos.push(t + " — " + c); }; 1`);
  await js(`window.esteira.pedir("planilha:ler", { caminho: ${JSON.stringify(planilha)} }).then(() => 1)`);

  console.log("\n\x1b[1m1. Abrir a conferência limpa sozinha o que já está atendido na Shopify\x1b[0m");
  await js(`document.querySelector('[data-etapa="3"]').click(); 1`);
  await espera(1500);
  const lista = () => js(`[...document.querySelectorAll("#cxPrecisa .item[data-rev]")].map(i => i.dataset.pedido).join(", ")`);
  let itens = await lista();
  const nota = await js(`document.getElementById("confNaShopify").hidden ? "" : document.getElementById("confNaShopifyTxt").innerText`);
  tudo &= ok(!/165001/.test(itens) && /165002/.test(itens) && /165003/.test(itens), `o #165001 (colado à mão) saiu; ficam ${itens}`);
  tudo &= ok(/1 pedido já estava atendido na Shopify/.test(nota) && /#165001/.test(nota), `e diz: "${nota}"`);
  await foto("1-conferencia-limpa.png");

  console.log("\n\x1b[1m2. O botão \"Conferir na Shopify e limpar\"\x1b[0m");
  SITUACAO["165002"] = "FULFILLED";   // o Matheus colou mais um à mão
  await js(`document.getElementById("bLimparConf").click(); 1`);
  await espera(1500);
  itens = await lista();
  tudo &= ok(!/165002/.test(itens) && /165003/.test(itens), `o #165002 saiu também; fica ${itens}`);
  await js(`document.getElementById("bLimparConf").click(); 1`);
  await espera(1200);
  tudo &= ok((await js(`window.__avisos.join(" | ")`)).includes("Nada para limpar"), "clicar de novo: \"Nada para limpar\"");
  await js(`document.getElementById("bDesfazerLimpeza").scrollIntoView(); document.getElementById("bDesfazerLimpeza").click(); 1`);
  await espera(1200);
  itens = await lista();
  tudo &= ok(/165002/.test(itens), `"Desfazer" devolve (${itens})`);
  tudo &= ok(pendentesAbertos().some((p) => p.pedido === "Pedido #165002"), "e na carteira também");

  console.log("\n\x1b[1m3. Senha errada na conta 232, com a rodada rodando\x1b[0m");
  const { iniciarColetor } = await import("../src/coletor.mjs");
  const { rodarFila } = await import("../src/fila.mjs");
  const coletor = await iniciarColetor({ porta: 3931 });
  const evento = (m) => fetchDeVerdade("http://127.0.0.1:3931/", { method: "POST", body: JSON.stringify(m) });
  let corrigida = false; const ordem = [];
  const processar = async (c) => {
    ordem.push(c.conta);
    if (c.conta === 232 && !corrigida) {
      await evento({ tipo: "login-falhou", conta: "232", motivo: "a Shopee respondeu: senha inválida" });
      throw new Error("conta 232: o login automático falhou — a Shopee respondeu: senha inválida");
    }
    if (c.conta === 120) await evento({ tipo: "login-ok", conta: "120" });
    await espera(c.conta === 300 ? 6000 : 300);
    return join(dir, "x.json");
  };
  const rodada = rodarFila([120, 232, 300].map((conta) => ({ conta, serial: conta })),
    { concorrencia: 1, pausaMin: 0, pausaMax: 0, processar });
  await espera(1500);
  await js(`document.getElementById("bAlertas").click(); 1`);
  await espera(400);
  const alerta = await js(`[...document.querySelectorAll("#listaAlertas .alerta")].map(a => a.innerText).join(" || ")`);
  tudo &= ok(/senha da conta 232 é diferente da padrão/.test(alerta) && !/senha das contas/.test(alerta), "o alerta é da conta 232, não \"a senha das contas\"");
  const botao = await js(`document.querySelector('#listaAlertas [data-rerodar="232"]')?.innerText ?? ""`);
  tudo &= ok(botao === "Tentar de novo a conta 232", `botão: "${botao}"`);
  await foto("2-alerta-senha-232.png");

  corrigida = true;   // o Matheus entrou na conta e trocou a senha
  await js(`document.querySelector('#listaAlertas [data-rerodar="232"]').click(); 1`);
  await espera(600);
  const avisos = await js(`window.__avisos.join(" | ")`);
  tudo &= ok(/A conta 232 voltou para o fim da fila desta rodada/.test(avisos), "\"A conta 232 voltou para o fim da fila desta rodada\"");
  const res = await rodada;
  tudo &= ok(res.find((x) => x.conta === 232)?.ok === true && ordem.join(" ") === "120 232 300 232",
    `a 232 foi lida na mesma rodada, depois da 300 (${ordem.join(" ")})`);
  await coletor.fechar();

  console.log(tudo ? "\n\x1b[32m\x1b[1m  feedback 22/10 na janela: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  feedback 22/10 na janela: FALHOU\x1b[0m\n");
  app.exit(tudo ? 0 : 1);
});
