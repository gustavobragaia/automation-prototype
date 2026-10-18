// De onde vem o ExcelJS. Um lugar só.
//
// Empacotado, o app NÃO carrega a pasta node_modules: o electron-builder 25
// podava errado as dependências "deduplicadas" e deixou 12 pacotes de fora
// — entre eles um que o exceljs usa por baixo. Módulo faltando, no Electron
// empacotado, não dá erro: trava em silêncio antes de abrir a janela.
//
// Então o exceljs vai junto como UM arquivo, montado com esbuild na hora de
// empacotar (aplicativo/empacotar/montar-vendor.mjs). Sem árvore de
// dependências, não há o que podar.
//
// Em desenvolvimento, se esse arquivo ainda não foi montado, usa o pacote
// normal. O existsSync antes do require importa: no app empacotado, um
// require de pacote ausente é exatamente o travamento mudo que isto evita.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const exigir = createRequire(import.meta.url);
const montado = fileURLToPath(new URL("./vendor/exceljs.cjs", import.meta.url));

export const origem = existsSync(montado) ? "arquivo único" : "pacote";
const ExcelJS = existsSync(montado) ? exigir(montado) : exigir("exceljs");
export default ExcelJS;
