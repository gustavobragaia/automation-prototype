// Todo import do pacote tem que encontrar o seu arquivo DENTRO do pacote.
//
// Por que isto existe: `src/shopify-oauth.mjs` importa
// `../servidor/lib/validar.js`, e o empacotamento só levava `src/`. Em
// desenvolvimento o arquivo estava lá; empacotado, faltava. E o Electron
// empacotado não acusa módulo faltando — ele TRAVA, em silêncio, antes de
// abrir a janela. Sem log, sem erro, sem processo auxiliar: o app
// simplesmente não abre, e no computador do cliente.
//
// Então o empacotamento confere o grafo inteiro e PARA se faltar alguma
// coisa. Melhor um build que falha aqui do que um .dmg que não abre lá.
const asar = require("@electron/asar");
const { posix } = require("node:path");

function conferir(arquivoAsar) {
  const todos = new Set(asar.listPackage(arquivoAsar).map((p) => p.replace(/\\/g, "/")));
  // O arquivo único do exceljs fica de fora da varredura: o esbuild já
  // resolve tudo por dentro e falha na montagem se não conseguir — e o texto
  // dele tem comentários de tipagem como `import('./get')` que pareceriam
  // imports. A prova dele é o app empacotado abrir e ler uma planilha.
  const modulos = [...todos].filter((p) => /\.(mjs|cjs|js)$/.test(p) &&
    !p.includes("/node_modules/") && !p.includes("/vendor/"));
  const faltando = [];
  // O pacote não leva node_modules (ver src/excel.mjs). Então qualquer
  // pacote externo exigido pelo nosso código é um módulo que vai faltar —
  // e travar o app em silêncio. Só o runtime do Electron e o Node valem.
  const PERMITIDOS = /^(electron|node:.+)$/;
  // O SQLite não vai no app instalado (módulo nativo); src/armazenamento
  // /index.mjs confere a existência antes de importar e recusa com uma frase.
  const OPCIONAIS = new Set(["/src/armazenamento/index.mjs→./sqlite.mjs"]);
  for (const m of modulos) {
    const texto = asar.extractFile(arquivoAsar, m.replace(/^\//, "")).toString("utf8");
    // import estático, import() dinâmico e require, só os relativos
    const alvos = [...texto.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g)]
      .map((x) => x[1]);
    for (const alvo of alvos) {
      const resolvido = posix.normalize(posix.join(posix.dirname(m), alvo));
      if (todos.has(resolvido)) continue;
      // Ausências DE PROPÓSITO, cada uma protegida por um existsSync antes
      // do import, para recusar com mensagem em vez de travar.
      if (OPCIONAIS.has(`${m}→${alvo}`)) continue;
      faltando.push(`${m}  →  ${alvo}`);
    }
    // o arquivo único do exceljs é montado pelo esbuild e já resolve tudo
    // por dentro; os requires que sobram nele são do Node
    if (/\/vendor\//.test(m)) continue;
    const pacotes = [...texto.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^."'][^"']*)["']/g)]
      .map((x) => x[1]).filter((p) => !PERMITIDOS.test(p));
    for (const p of pacotes) faltando.push(`${m}  →  pacote externo "${p}" (o app não leva node_modules)`);
  }
  // Referências que não são import — a varredura acima não as vê. O
  // src/excel.mjs acha o arquivo único por new URL(); se ele faltasse, o app
  // cairia no require("exceljs"), que no pacote não existe.
  for (const obrigatorio of ["/src/vendor/exceljs.cjs", "/servidor/lib/validar.js"])
    if (!todos.has(obrigatorio)) faltando.push(`arquivo obrigatório ausente: ${obrigatorio}`);
  return { modulos: modulos.length, faltando };
}

exports.conferir = conferir;
