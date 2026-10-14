// Coletor avulso, para depuração. A rodada normal (start.mjs) sobe o
// coletor dentro do próprio processo.
import { iniciarColetor } from "./src/coletor.mjs";
const { porta } = await iniciarColetor({ aoLog: (m) => console.log(`  ${m}`) });
console.log(`coletor ouvindo em http://127.0.0.1:${porta} — Ctrl+C para sair`);
