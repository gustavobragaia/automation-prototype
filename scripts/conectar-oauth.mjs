// Conecta a Shopify pelo cenário B: dois cliques, sem copiar chave nenhuma.
//
//   node --env-file=.env scripts/conectar-oauth.mjs <loja> [--abrir]
//
// Sobe o coletor (é ele que recebe o token em 127.0.0.1) e imprime o link.
// Com --abrir, abre o navegador sozinho — que é o que o botão do aplicativo
// vai fazer.

import { iniciarColetor } from "../src/coletor.mjs";
import { iniciarConexao } from "../src/shopify-oauth.mjs";

const loja = process.argv.find((a) => a.includes(".myshopify.com"))
  ?? process.env.SHOPIFY_LOJA;
const abrir = process.argv.includes("--abrir");
const porta = Number(process.env.COLETOR_PORTA ?? 3000);

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const aten = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const ruim = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m) => console.log(`    ${m}`);
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

if (!loja) { ruim("passe a loja: ...myshopify.com"); process.exit(1); }

const col = await iniciarColetor({ porta, aoLog: (m) => info(m) });
ok(`coletor ouvindo em 127.0.0.1:${porta}`);

const c = iniciarConexao(loja, { porta, abrir });
sec("Abra este link e aprove na tela da Shopify");
console.log(`\n${c.url}\n`);
info("é exatamente o link que o cliente vai receber");

try {
  const conexao = await c.pronto;
  sec("Conectado");
  ok(`loja: ${conexao.loja}`);
  ok(`modo: ${conexao.modo}${conexao.expiraEm
      ? ` · expira em ${Math.round((conexao.expiraEm - Date.now()) / 60000)} min`
      : " · não expira"}`);

  // Não conta pelo campo `scope` que a Shopify devolve: ele traz só os de
  // ESCRITA, porque os de leitura são implícitos. Contar aquilo dizia
  // "4 escopos" quando os 8 estavam concedidos — e assustaria quem leu.
  const { escoposConcedidos } = await import("../src/shopify.mjs");
  const { ESCOPOS } = await import("../src/shopify-conexao.mjs");
  const reais = await escoposConcedidos({ conexao });
  if (reais) {
    const faltando = ESCOPOS.filter((e) => !reais.includes(e));
    if (faltando.length) aten(`faltando: ${faltando.join(", ")}`);
    else ok(`os ${ESCOPOS.length} escopos necessários estão concedidos`);
  }
  info("o token ficou nesta máquina, em estado/conexao-shopify.json");
} catch (e) {
  ruim(e.message);
} finally {
  await col.fechar();
}
