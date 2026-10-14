// Ponto de entrada único.
//
//   node --env-file=.env start.mjs                    uma rodada e sai
//   node --env-file=.env start.mjs --painel           painel + agendador
//   node --env-file=.env start.mjs --horarios 9,14,18 horários da varredura
//   node --env-file=.env start.mjs --simular          injeta rastreio falso
//   node --env-file=.env start.mjs --dry              não escreve na Shopify
//   node --env-file=.env start.mjs 2 7 196            contas específicas
//
// O coletor sobe dentro deste processo: não há mais dois terminais.

import { iniciarColetor } from "./src/coletor.mjs";
import { iniciarPainel } from "./src/painel.mjs";
import { rodarCiclo, descobrirContas } from "./src/ciclo.mjs";

const args = process.argv.slice(2);
const temFlag = (f) => args.includes(f);
const valor = (f, p) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : p; };
const seriais = args.filter((a) => /^\d+$/.test(a));

const comPainel = temFlag("--painel");
const simular = temFlag("--simular");
const escrever = !temFlag("--dry");
const horarios = String(valor("--horarios", "9,14,18")).split(",").map((h) => Number(h.trim())).filter((h) => h >= 0 && h <= 23);

const ts = () => new Date().toLocaleTimeString("pt-BR");
const log = (m) => console.log(`  \x1b[90m${ts()}\x1b[0m ${m}`);

const { porta } = await iniciarColetor({ aoLog: log });
log(`coletor em 127.0.0.1:${porta}`);

let emAndamento = false;
async function umaRodada() {
  if (emAndamento) { log("rodada já em andamento, ignorando"); return; }
  emAndamento = true;
  try {
    const contas = await descobrirContas(seriais);
    const r = await rodarCiclo({ contas, escrever, simular, aoLog: log });
    log(`\x1b[1mfim\x1b[0m · ${r.coletadas}/${r.contas} contas · ${r.pedidosVistos} pedidos · ${r.escritos} escritos · ${r.revisao} em revisão`);
    return r;
  } catch (e) {
    log(`\x1b[31mrodada falhou: ${e.message}\x1b[0m`);
  } finally {
    emAndamento = false;
  }
}

if (!comPainel) {
  await umaRodada();
  process.exit(0);
}

const p = await iniciarPainel({ porta: 4000, aoRodar: umaRodada });
console.log(`\n  \x1b[1mPainel:\x1b[0m http://127.0.0.1:${p.porta}`);
console.log(`  Varredura automática às ${horarios.map((h) => `${String(h).padStart(2, "0")}h`).join(", ")}\n`);

// Agendador simples: confere a cada minuto se bateu a hora. Resiste a
// suspensão da máquina melhor que setTimeout longo, que o macOS/Windows
// atrasam ou engolem ao dormir.
let ultimaHora = -1;
setInterval(() => {
  const agora = new Date();
  const h = agora.getHours();
  if (agora.getMinutes() === 0 && h !== ultimaHora && horarios.includes(h)) {
    ultimaHora = h;
    log(`horário agendado (${h}h) — iniciando`);
    umaRodada();
  }
  if (agora.getMinutes() !== 0) ultimaHora = -1;
}, 60_000);

process.on("SIGINT", () => { console.log("\n  encerrando"); process.exit(0); });
