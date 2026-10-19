// "Conectar com a chave do app": o caminho que existe porque a Shopify
// recusou o app com distribuição personalizada na loja real. Testa pela
// ponte, do jeito que a tela chama, com a Shopify fingida.
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "esteira-cred-"));
process.env.ESTADO_DIR = join(dir, "estado");
process.env.TRABALHO_DIR = dir;
process.env.SHOPIFY_CONEXAO_ARQUIVO = join(dir, "conexao.json");
for (const k of ["SHOPIFY_LOJA", "SHOPIFY_TOKEN", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET"]) delete process.env[k];

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
let tudo = true;

const ID = "0123456789abcdef0123456789abcdef", CHAVE = "shpss_" + "a".repeat(32);
let resposta = "certo", trocas = 0, formato = null;
globalThis.fetch = async (url, o) => {
  const u = String(url);
  if (u.endsWith("/admin/oauth/access_token")) {
    trocas++;
    // o formato da documentação: formulário, com os três campos
    formato = o.headers["Content-Type"];
    const b = Object.fromEntries(new URLSearchParams(o.body));
    if (b.grant_type !== "client_credentials") return new Response("{}", { status: 400 });
    if (resposta === "outra-org")
      return new Response(JSON.stringify({ error: "shop_not_permitted" }), { status: 400 });
    if (b.client_secret !== CHAVE)
      return new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 });
    return new Response(JSON.stringify({ access_token: "shpat_x", scope: "read_orders", expires_in: 86399 }));
  }
  return new Response(JSON.stringify({ data: { shop: { name: "Esparta Store",
    myshopifyDomain: "loja-sparta-store.myshopify.com", email: "a@b.c", currencyCode: "BRL" } } }));
};

const { construir } = await import("../aplicativo/ponte.mjs");
const ponte = construir({ aoLog: () => {} });
const pedir = async (c) => { const r = await ponte["shopify:conectarCredenciais"](c); return r?.ok === false ? r : r; };
const salvo = () => existsSync(process.env.SHOPIFY_CONEXAO_ARQUIVO) &&
  JSON.parse(readFileSync(process.env.SHOPIFY_CONEXAO_ARQUIVO, "utf8"));

console.log("\n\x1b[1mconectar colando o ID e a chave do app\x1b[0m");
let r = await pedir({ loja: "loja-sparta-store.myshopify.com", clientId: "curto", clientSecret: CHAVE });
tudo &= ok(r.ok === false && /32 letras/.test(r.erro) && trocas === 0,
  "ID no formato errado: recusa antes de falar com a Shopify");
r = await pedir({ loja: "x", clientId: ID, clientSecret: "curta" });
tudo &= ok(r.ok === false && /incompleta/.test(r.erro), "chave curta demais: diz que parece incompleta");

resposta = "outra-org";
r = await pedir({ loja: "loja-sparta-store.myshopify.com", clientId: ID, clientSecret: CHAVE });
tudo &= ok(r.ok === false && /PRÓPRIA loja/.test(r.erro) && /shop_not_permitted/.test(r.erro),
  "app de outra organização: diz para criar pelo admin da própria loja (e guarda a mensagem crua)");
tudo &= ok(!salvo(), "e nada é gravado");

resposta = "certo";
r = await pedir({ loja: "loja-sparta-store.myshopify.com", clientId: ID, clientSecret: "shpss_" + "b".repeat(32) });
tudo &= ok(r.ok === false && /recusou o ID ou a chave/.test(r.erro), "chave errada: diz para copiar de novo");
tudo &= ok(!salvo(), "e nada é gravado");

r = await pedir({ loja: "https://admin.shopify.com/x", clientId: ID, clientSecret: CHAVE });
tudo &= ok(r.ok === false && /endereço de loja/.test(r.erro), "endereço que não é .myshopify.com: recusa");

r = await pedir({ loja: " loja-sparta-store.myshopify.com ", clientId: " " + ID + " ", clientSecret: CHAVE + "\n" });
const c = salvo();
tudo &= ok(r.ok !== false && c?.modo === "credenciais" && c.loja === "loja-sparta-store.myshopify.com" &&
  c.clientId === ID && c.clientSecret === CHAVE, "ID e chave certos (com espaço colado junto): conecta e grava no modo credenciais");

tudo &= ok(formato === "application/x-www-form-urlencoded",
  "a troca vai como formulário, no formato da documentação da Shopify");
// o furo achado pelo ensaio de janela: depois de uma conexão certa, uma
// chave ERRADA para a mesma loja passava, porque o acesso antigo ficava
// guardado na memória e respondia no lugar dela
const antes = trocas;
r = await pedir({ loja: "loja-sparta-store.myshopify.com", clientId: ID, clientSecret: "shpss_" + "d".repeat(32) });
tudo &= ok(r.ok === false && /recusou o ID ou a chave/.test(r.erro) && trocas === antes + 1,
  "depois de conectada, uma chave errada para a mesma loja é RECUSADA (pergunta à Shopify, não à memória)");
tudo &= ok(salvo().clientSecret === CHAVE, "e a conexão que funcionava continua gravada");
await ponte["shopify:desconectar"]();
r = await pedir({ loja: "loja-sparta-store.myshopify.com", clientId: ID, clientSecret: CHAVE });
const est = await ponte["shopify:estado"]();
const e = est?.dado ?? est;
tudo &= ok(e.conectada === true && e.loja === "Esparta Store", "e o cartão mostra o nome que veio da Shopify");
tudo &= ok(!JSON.stringify(est).includes(CHAVE), "a chave secreta nunca volta para a tela");

console.log(tudo ? "\n\x1b[32m\x1b[1m  conectar com a chave funciona\x1b[0m\n" : "\n\x1b[31m\x1b[1m  conectar com a chave tem furo\x1b[0m\n");
process.exit(tudo ? 0 : 1);
