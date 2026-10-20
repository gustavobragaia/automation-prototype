// Prova a atualização automática NO WINDOWS, do começo ao fim.
//
//   node aplicativo/empacotar/conferir-atualizacao.mjs   (CI, depois de conferir-windows)
//
// O Esteira da versão atual já está instalado (conferir-windows instalou).
// O CI montou também uma "versão seguinte" (9.9.9) em dist-proxima. Este
// roteiro serve essa pasta por HTTP, abre o Esteira instalado apontando
// para ela, espera ele achar e baixar a versão nova, clica em "Reiniciar e
// atualizar" como a pessoa clicaria, e confere que o Esteira instalado
// virou o 9.9.9 — e voltou a abrir sozinho.
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, existsSync, readdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("../..", import.meta.url));
const PROXIMA = join(RAIZ, "aplicativo", "dist-proxima");
const ok = (c, m) => { console.log(`${c ? "  ✓" : "  ✗"} ${m}`); return c; };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let tudo = true;

// ── 0. a versão seguinte existe, com o latest.yml que o atualizador lê ──
const yml = join(PROXIMA, "latest.yml");
tudo &= ok(existsSync(yml) && /version: 9\.9\.9/.test(readFileSync(yml, "utf8")), "a versão seguinte (9.9.9) foi montada, com latest.yml");

const programas = join(process.env.LOCALAPPDATA, "Programs");
const pasta = readdirSync(programas).find((d) => existsSync(join(programas, d, "Esteira.exe")));
const exe = join(programas, pasta, "Esteira.exe");
// O Windows grava a versão com quatro números ("9.9.9.0"); o app usa três.
const versaoDe = (f) => execFileSync("powershell", ["-NoProfile", "-Command", `(Get-Item '${f}').VersionInfo.ProductVersion`])
  .toString().trim().replace(/^(\d+\.\d+\.\d+)\.0$/, "$1");
const antes = versaoDe(exe);
tudo &= ok(!!antes && antes !== "9.9.9", `o Esteira instalado está na versão atual (${antes})`);
tudo &= ok(existsSync(join(programas, pasta, "resources", "app-update.yml")),
  "o instalado sabe onde procurar versão nova (resources/app-update.yml)");

// ── 1. a "página de versões": a pasta servida por HTTP ──
const servidor = createServer((req, res) => {
  const f = join(PROXIMA, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!f.startsWith(PROXIMA) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-length": statSync(f).size });
  createReadStream(f).pipe(res);
}).listen(8765, "127.0.0.1");

// ── 2. abre o Esteira instalado apontando para ela ──
const estado = mkdtempSync(join(tmpdir(), "esteira-atu-"));
const app = spawn(exe, ["--remote-debugging-port=9556", `--user-data-dir=${join(estado, "dados")}`], {
  env: { ...process.env, ESTADO_DIR: join(estado, "estado"), TRABALHO_DIR: join(estado, "trabalho"),
         ESTEIRA_ATUALIZACAO_URL: "http://127.0.0.1:8765/" },
  stdio: "ignore",
});
let alvo = null;
for (let i = 0; i < 60 && !alvo; i++) {
  await dormir(1000);
  try { alvo = (await (await fetch("http://127.0.0.1:9556/json")).json()).find((t) => t.type === "page"); } catch {}
}
tudo &= ok(!!alvo, "o Esteira instalado abriu");
const ws = new WebSocket(alvo.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
await new Promise((r) => (ws.onopen = r));
const js = (e) => new Promise((r) => { const i = ++id; pend.set(i, r);
  ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression: e, awaitPromise: true, returnByValue: true } })); })
  .then((d) => d.result?.result?.value);

// ── 3. ele acha a versão nova e baixa sozinho ──
let e = null;
for (let i = 0; i < 180; i++) {
  e = await js(`window.esteira.atualizacao.estado()`);
  if (e?.estado === "pronta") break;
  await dormir(1000);
}
tudo &= ok(e?.estado === "pronta" && e.versao === "9.9.9", `achou e baixou a versão nova sozinho (${JSON.stringify(e)})`);
const aviso = await js(`(() => { const c = document.getElementById("ladoAtualiza"); return c && !c.hidden ? c.innerText : ""; })()`);
tudo &= ok(/9\.9\.9 pronta/.test(aviso) && /Reiniciar e atualizar/.test(aviso), "a barra lateral avisa e mostra o botão");

// ── 4. a pessoa clica; o Esteira fecha, instala e volta ──
await js(`document.getElementById("bAtualizar").click()`);
let depois = antes;
for (let i = 0; i < 120 && depois !== "9.9.9"; i++) {
  await dormir(2000);
  try { depois = versaoDe(exe); } catch {}   // some por instantes enquanto o instalador troca os arquivos
}
tudo &= ok(depois === "9.9.9", `o Esteira instalado agora é o 9.9.9 (era ${antes})`);
let voltou = false;
for (let i = 0; i < 30 && !voltou; i++) {
  await dormir(1000);
  voltou = /Esteira\.exe/i.test(execFileSync("tasklist", ["/FI", "IMAGENAME eq Esteira.exe"]).toString());
}
tudo &= ok(voltou, "e reabriu sozinho depois de atualizar");

try { execFileSync("taskkill", ["/F", "/IM", "Esteira.exe"]); } catch {}
servidor.close(); try { ws.close(); } catch {}
console.log(tudo ? "\nA ATUALIZAÇÃO AUTOMÁTICA FUNCIONA NO WINDOWS\n" : "\nA ATUALIZAÇÃO AUTOMÁTICA TEM PROBLEMA\n");
process.exit(tudo ? 0 : 1);
