// Conecta uma loja Shopify — CENÁRIO A.
//
// É o miolo do botão "Conectar Shopify" do painel: recebe os três dados,
// valida contra a Shopify de verdade e só salva se a loja responder. Quando
// o cenário B entrar, o painel chama o mesmo "conectar" com modo oauth e
// nada mais muda.
//
//   node --env-file=.env scripts/conectar-shopify.mjs                  # usa o .env
//   node --env-file=.env scripts/conectar-shopify.mjs <loja> <id> <secret>
//   node --env-file=.env scripts/conectar-shopify.mjs --status
//   node --env-file=.env scripts/conectar-shopify.mjs --desconectar

import {
  normalizarLoja, salvarConexao, lerConexao, conexaoAtiva, apagarConexao, ESCOPOS,
} from "../src/shopify-conexao.mjs";
import { identidadeDaLoja, escoposConcedidos } from "../src/shopify.mjs";

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const ruim = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const aten = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const info = (m) => console.log(`    ${m}`);
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const args = process.argv.slice(2);

if (args.includes("--desconectar")) {
  apagarConexao();
  ok("conexão apagada — o robô não escreve mais em nenhuma loja");
  process.exit(0);
}

/** Verifica se a conexão funciona de ponta a ponta. Retorna o que achou. */
export async function verificar(conexao) {
  const loja = await identidadeDaLoja({ conexao });
  const escopos = await escoposConcedidos({ conexao });
  const faltando = escopos ? ESCOPOS.filter((e) => !escopos.includes(e)) : [];
  return { loja, escopos, faltando };
}

if (args.includes("--status")) {
  const c = conexaoAtiva();
  if (!c) { ruim("nenhuma loja conectada"); process.exit(1); }
  sec("Conexão atual");
  info(`loja: ${c.loja}`);
  info(`modo: ${c.modo}${c.origem === "env" ? " (vindo do .env, não salva)" : ""}`);
  try {
    const { loja, escopos, faltando } = await verificar(c);
    ok(`"${loja.name}" responde · ${loja.myshopifyDomain} · ${loja.currencyCode}`);
    if (escopos) {
      ok(`${escopos.length} escopo(s) concedido(s)`);
      if (faltando.length) aten(`faltando: ${faltando.join(", ")}`);
    }
  } catch (e) {
    ruim(e.message);
    process.exit(1);
  }
  process.exit(0);
}

// ─── Conectar ────────────────────────────────────────────────────────────────

const posicionais = args.filter((a) => !a.startsWith("--"));
const loja = normalizarLoja(posicionais[0] ?? process.env.SHOPIFY_LOJA);
const clientId = posicionais[1] ?? process.env.SHOPIFY_CLIENT_ID;
const clientSecret = posicionais[2] ?? process.env.SHOPIFY_CLIENT_SECRET;

if (!loja) {
  ruim("loja inválida — esperado algo como minhaloja.myshopify.com");
  process.exit(1);
}
if (!clientId || !clientSecret) {
  ruim("faltam client_id e client_secret");
  info("no Dev Dashboard da Shopify: seu app -> Overview -> Client credentials");
  process.exit(1);
}

sec(`Conectando ${loja}`);
const conexao = { loja, modo: "credenciais", clientId, clientSecret, conectadoEm: new Date().toISOString() };

try {
  const { loja: l, escopos, faltando } = await verificar(conexao);
  ok(`token obtido e aceito pela loja "${l.name}"`);
  info(`domínio: ${l.myshopifyDomain}`);
  info(`moeda: ${l.currencyCode}`);

  if (escopos) {
    if (faltando.length) {
      aten(`escopos faltando: ${faltando.join(", ")}`);
      info("o robô vai conseguir ler, mas a escrita do rastreio pode falhar");
    } else {
      ok("todos os escopos necessários estão concedidos");
    }
  } else {
    aten("não foi possível listar os escopos — segue, a escrita é que vai dizer");
  }

  salvarConexao({ ...conexao, nomeLoja: l.name, escopos: escopos ?? undefined });
  sec("Pronto");
  info("conexão salva em estado/conexao-shopify.json (permissão 0600)");
  info("confira depois com: npm run conectar -- --status");
} catch (e) {
  ruim(e.message);
  sec("O que costuma ser");
  info("· client_secret errado ou de outro app");
  info("· o app foi criado em uma organização diferente da loja — client_credentials");
  info("  só funciona quando app e loja são da mesma organização (é o cenário B que resolve)");
  info("· escopos não concedidos no app");
  process.exit(1);
}
