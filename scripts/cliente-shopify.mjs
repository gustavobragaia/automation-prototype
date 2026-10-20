// Registra a loja de um cliente novo no servidor de conexão (esteira.cloud)
// e confere o que dá para conferir daqui.
//
//   node scripts/cliente-shopify.mjs registrar <loja> <NOME> <client_id>
//   node scripts/cliente-shopify.mjs conferir  <loja>
//
//   ex.: node scripts/cliente-shopify.mjs registrar loja-x.myshopify.com LOJAX 25cb…f10
//
// "registrar" só mexe no servidor/wrangler.toml: põe a loja em SHOPIFY_LOJAS
// e o client_id em SHOPIFY_CLIENT_ID_<NOME>. NÃO faz deploy e NÃO toca no
// segredo — o segredo é do Gustavo (`wrangler secret put`), e o deploy vem
// depois de ele conferir o diff. Ver .claude/skills/conectar-shopify-cliente.
//
// "conferir" pergunta ao servidor no ar para onde ele manda a loja: tem que
// ser a tela de autorização da Shopify DAQUELA loja, com o client_id do app
// dela. 503 = falta o segredo (ou o deploy).
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const TOML = fileURLToPath(new URL("../servidor/wrangler.toml", import.meta.url));
const LOJA = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const NOME = /^[A-Z0-9_]{1,40}$/;            // o mesmo que servidor/lib/apps.js aceita
const ID = /^[a-f0-9]{32}$/;
const sair = (m) => { console.error(`✗ ${m}`); process.exit(1); };

const [acao, lojaBruta, nome, clientId] = process.argv.slice(2);
const loja = String(lojaBruta ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
if (!LOJA.test(loja)) sair(`loja inválida: "${lojaBruta}" — tem que ser algo.myshopify.com`);

if (acao === "registrar") {
  if (!NOME.test(nome ?? "")) sair(`NOME inválido: "${nome}" — só A-Z, 0-9 e _ (ex.: ESPARTA)`);
  if (!ID.test(clientId ?? "")) sair(`client_id inválido — são 32 letras/números (o "ID do cliente" do app)`);

  let s = readFileSync(TOML, "utf8");
  const m = s.match(/^SHOPIFY_LOJAS = '(.*)'$/m);
  if (!m) sair("não achei a linha SHOPIFY_LOJAS no wrangler.toml");
  const mapa = JSON.parse(m[1]);
  const outra = Object.entries(mapa).find(([l, n]) => n === nome && l !== loja);
  if (outra) sair(`o NOME ${nome} já é da loja ${outra[0]} — cada cliente tem o seu`);
  const antes = mapa[loja];
  mapa[loja] = nome;
  s = s.replace(m[0], `SHOPIFY_LOJAS = '${JSON.stringify(mapa)}'`);

  const linha = `SHOPIFY_CLIENT_ID_${nome} = "${clientId}"`;
  const existente = new RegExp(`^SHOPIFY_CLIENT_ID_${nome} = ".*"$`, "m");
  if (existente.test(s)) s = s.replace(existente, linha);
  else s = s.replace(/^SHOPIFY_LOJAS = .*$/m, (l) =>
    `${l}\n# ${loja} — distribuição personalizada, segredo em SHOPIFY_CLIENT_SECRET_${nome}\n${linha}`);
  writeFileSync(TOML, s);

  console.log(`✓ ${loja} → app ${nome} (${clientId.slice(0, 8)}…)${antes && antes !== nome ? ` — antes era ${antes}` : ""}`);
  console.log(`\nPróximos passos:`);
  console.log(`  1. git diff servidor/wrangler.toml   (conferir)`);
  console.log(`  2. cd servidor && npx wrangler deploy`);
  console.log(`  3. o Gustavo copia a "Chave secreta do cliente" do app e roda:`);
  console.log(`     cd ~/Documents/shopee-tracking-bot/servidor && pbpaste | npx wrangler secret put SHOPIFY_CLIENT_SECRET_${nome}`);
  console.log(`  4. node scripts/cliente-shopify.mjs conferir ${loja}`);
  process.exit(0);
}

if (acao === "conferir") {
  const state = `3000.${randomBytes(24).toString("hex")}`;
  const r = await fetch(`https://esteira.cloud/shopify/instalar?loja=${loja}&state=${state}`, { redirect: "manual" });
  if (r.status === 503) sair("o servidor diz que a loja não está configurada — falta o deploy ou o segredo (passos 2 e 3)");
  if (r.status !== 302) sair(`resposta inesperada do servidor: HTTP ${r.status}`);
  const destino = new URL(r.headers.get("location"));
  const certo = destino.host === loja && destino.pathname === "/admin/oauth/authorize";
  if (!certo) sair(`o servidor mandou para o lugar errado: ${destino.host}${destino.pathname}`);
  const id = destino.searchParams.get("client_id");
  console.log(`✓ o servidor manda ${loja} para a autorização da Shopify`);
  console.log(`  client_id: ${id}  (confira que é o "ID do cliente" do app DESTE cliente)`);
  console.log(`  retorno:   ${destino.searchParams.get("redirect_uri")}`);
  console.log(`\nIsto NÃO prova que o segredo está certo — só o "Conectar Shopify" de verdade prova`);
  console.log(`(no log do servidor: /shopify/callback com status 200).`);
  process.exit(0);
}

sair("use: registrar <loja> <NOME> <client_id>  |  conferir <loja>");
