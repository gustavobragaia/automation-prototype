// Monta o exceljs num arquivo único, antes de empacotar. Ver src/excel.mjs.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const aqui = (p) => fileURLToPath(new URL(p, import.meta.url));
mkdirSync(aqui("../../src/vendor"), { recursive: true });
await build({
  entryPoints: [aqui("../node_modules/exceljs/lib/exceljs.nodejs.js")],
  bundle: true, platform: "node", format: "cjs", target: "node20",
  outfile: aqui("../../src/vendor/exceljs.cjs"),
  logLevel: "warning",
});
console.log("  • exceljs montado em src/vendor/exceljs.cjs (um arquivo, sem node_modules)");

// O electron-updater, pelo mesmo motivo: um arquivo só, sem node_modules.
// "electron" fica de fora — é o próprio runtime. Ver atualizacao.mjs.
mkdirSync(aqui("../vendor"), { recursive: true });
await build({
  entryPoints: [aqui("../node_modules/electron-updater/out/main.js")],
  bundle: true, platform: "node", format: "cjs", target: "node20",
  external: ["electron"],
  outfile: aqui("../vendor/atualizador.cjs"),
  logLevel: "warning",
});
console.log("  • electron-updater montado em aplicativo/vendor/atualizador.cjs");
