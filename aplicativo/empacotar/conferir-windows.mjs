// Confere o Esteira NO WINDOWS, do jeito que o cliente vai usar.
//
//   node aplicativo/empacotar/conferir-windows.mjs      (roda no runner Windows do CI)
//
// Daqui do Mac não há como saber se o app abre no Windows. Este roteiro roda
// numa máquina Windows de verdade, depois do empacotamento, e faz o caminho
// do cliente: instala com o PRÓPRIO instalador (em silêncio), abre o Esteira
// instalado numa pasta de estado vazia e, pela porta de depuração, confere o
// que importa. Sai com código 1 se qualquer coisa falhar — e aí o instalador
// não vai para o ar.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// fileURLToPath, e não .pathname: este decodifica espaço e acento e acerta a
// letra de unidade do Windows ("D:\...") sem remendo.
const RAIZ = fileURLToPath(new URL("../..", import.meta.url));
const DIST = join(RAIZ, "aplicativo", "dist");
const ok = (c, m) => { console.log(`${c ? "  ✓" : "  ✗"} ${m}`); return c; };
let tudo = true;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 1. instala com o instalador de verdade ──
const instalador = readdirSync(DIST).find((f) => /^Esteira-Setup-.*\.exe$/.test(f));
tudo &= ok(!!instalador, `o instalador existe (${instalador})`);
execFileSync(join(DIST, instalador), ["/S"], { stdio: "inherit" });   // /S = sem perguntas
await dormir(5000);
const programas = join(process.env.LOCALAPPDATA, "Programs");
const pasta = readdirSync(programas).find((d) => existsSync(join(programas, d, "Esteira.exe")));
const exe = pasta && join(programas, pasta, "Esteira.exe");
tudo &= ok(!!exe, `instalou em ${exe ?? "(lugar nenhum)"}`);

// ── 2. abre o Esteira instalado, como instalação nova ──
const estado = mkdtempSync(join(tmpdir(), "esteira-win-"));
const app = spawn(exe, ["--remote-debugging-port=9555"], {
  env: { ...process.env, ESTADO_DIR: join(estado, "estado"), TRABALHO_DIR: join(estado, "trabalho") },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
app.stdout.on("data", (d) => (log += d)); app.stderr.on("data", (d) => (log += d));

let alvo = null;
for (let i = 0; i < 60 && !alvo; i++) {
  await dormir(1000);
  try { alvo = (await (await fetch("http://127.0.0.1:9555/json")).json()).find((t) => t.type === "page"); } catch {}
}
tudo &= ok(!!alvo, "o app abriu e a janela carregou");
if (!alvo) { console.log(log); app.kill(); process.exit(1); }

const ws = new WebSocket(alvo.webSocketDebuggerUrl);
let id = 0; const pend = new Map(); const excecoes = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data);
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  else if (d.method === "Runtime.exceptionThrown") excecoes.push(d.params.exceptionDetails.exception?.description ?? "?"); };
await new Promise((r) => (ws.onopen = r));
const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await cmd("Runtime.enable");
const js = async (e) => (await cmd("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
const pedir = (a, c = {}) => js(`(async () => { const r = await window.esteira.pedir(${JSON.stringify(a)}, ${JSON.stringify(c)});
  const d = r && r.ok ? r.dado : r; return d && typeof d === "object" && "ok" in d && ("dado" in d || "erro" in d) ? d : { ok: r.ok, dado: d, erro: r.erro }; })()`);
await dormir(3000);

// ── 3. o que importa ──
const fonte = readFileSync(join(RAIZ, "aplicativo", "tela", "index.html"), "utf8");
const marcas = [...new Set([...fonte.match(/#16\d{4}/g) ?? [], ...fonte.match(/k1[a-z0-9]{6}/g) ?? [],
  ...[...fonte.matchAll(/c:"([A-ZÁÉÍÓÚÂÊÔÃÕ][^"]{4,})"/g)].map((m) => m[1])])];
for (const [t, nome] of [["1","etapa 1"],["2","etapa 2"],["3","etapa 3"],["4","etapa 4"],["contas","Contas"],["historico","Histórico"],["ajustes","Ajustes"]]) {
  await js(`document.querySelector('[data-tela="${t}"],[data-etapa="${t}"],[data-ir="${t}"]')?.click()`);
  await dormir(300);
  const txt = await js(`document.body.innerText`);
  const v = marcas.filter((x) => txt.includes(x));
  tudo &= ok(!v.length, `${nome}: nada inventado` + (v.length ? ` — vazou ${v.slice(0, 3).join(", ")}` : ""));
}

const { montarCenario } = await import(pathToFileURL(join(RAIZ, "scripts", "cenario-conferencia.mjs")).href);
const { planilha } = await montarCenario(join(estado, "cenario"));
const pl = await pedir("planilha:ler", { caminho: planilha });
tudo &= ok(pl.ok && pl.dado?.total === 4, `lê uma planilha (.xlsx) — o exceljs empacotado funciona no Windows (${pl.dado?.total ?? pl.erro})`);
const modelo = join(estado, "modelo.xlsx");
const mo = await pedir("planilha:modelo", { caminho: modelo });
const re = await pedir("planilha:ler", { caminho: modelo });
tudo &= ok(mo.ok && re.ok && re.dado?.aba === "PEDIDOS", "gera o modelo de planilha e relê o que gerou");
const rec = await pedir("rodada:iniciar", { contas: [{ conta: 124, serial: 1 }] });
tudo &= ok(rec.ok === false && /Ajustes/.test(rec.erro ?? ""), "recusa a rodada até preencher os Ajustes");
const ma = await pedir("maquina:ler");
tudo &= ok((ma.dado ?? ma).recomendado > 0, `lê a máquina (${(ma.dado ?? ma).ramGB} GB, ${(ma.dado ?? ma).nucleos} núcleos)`);

const forjada = await fetch("http://127.0.0.1:3000/shopify/pronto", { method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: "state=3000." + "a".repeat(48) + "&loja=x.myshopify.com&token=shpat_forjado" });
tudo &= ok(forjada.status === 400, `recusa uma volta forjada da Shopify (HTTP ${forjada.status})`);
tudo &= ok(!existsSync(join(estado, "estado", "conexao-shopify.json")) ||
           !/shpat_forjado/.test(readFileSync(join(estado, "estado", "conexao-shopify.json"), "utf8")),
  "e não grava nada");
tudo &= ok(!excecoes.length, "nenhuma exceção na tela" + (excecoes.length ? `: ${excecoes[0]}` : ""));

ws.close(); app.kill();
console.log(tudo ? "\nO ESTEIRA FUNCIONA NO WINDOWS\n" : "\nO ESTEIRA TEM PROBLEMA NO WINDOWS\n");
if (!tudo) console.log("--- log do app ---\n" + log);
process.exit(tudo ? 0 : 1);
