// O fluxo inteiro do cenário B, sem tocar na Shopify: o app começa, o
// "servidor" devolve o token por POST e o app grava. E, sobretudo: o que
// acontece quando o POST é forjado.
process.env.SHOPIFY_CONEXAO_ARQUIVO = "/tmp/oauth-conexao.json";
process.env.SHOPEE_SENHA = "x";
import { rmSync, existsSync, readFileSync } from "node:fs";
rmSync("/tmp/oauth-conexao.json", { force: true });

const { iniciarConexao, receberToken, conexaoEmAndamento, cancelarConexao } =
  await import("../src/shopify-oauth.mjs");
const { iniciarColetor } = await import("../src/coletor.mjs");

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

const PORTA = 3914;
const col = await iniciarColetor({ porta: PORTA, aoLog: () => {} });
const postar = (campos) => fetch(`http://127.0.0.1:${PORTA}/shopify/pronto`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(campos),
}).then(async (r) => ({ s: r.status, t: await r.text() }));

sec("começar a conexão");
let errou = false;
try { iniciarConexao("evil.com", { porta: PORTA, abrir: false }); } catch { errou = true; }
tudo &= ok(errou, "loja inválida nem começa");

const c = iniciarConexao("testeloja-4ajtpkll.myshopify.com", { porta: PORTA, abrir: false });
tudo &= ok(c.url.startsWith("https://esteira.cloud/shopify/instalar"), "manda para o nosso endpoint");
tudo &= ok(c.url.includes("state=" + c.state), "levando o state");
tudo &= ok(!c.url.includes("token") && !c.url.includes("secret"), "sem segredo na URL");
tudo &= ok(conexaoEmAndamento()?.loja === "testeloja-4ajtpkll.myshopify.com", "fica em andamento");

sec("POST forjado não conecta nada");
tudo &= ok((await postar({ state: "3000.fake", loja: c.loja, accessToken: "roubado" })).s === 400,
           "state malformado: recusado");
// O caso que importa: state com o formato CERTO, mas que não é o nosso.
// É o que uma página aberta no navegador conseguiria montar.
const outroState = `${PORTA}.${"ab".repeat(24)}`;
tudo &= ok((await postar({ state: outroState, loja: c.loja, accessToken: "roubado" })).s === 400,
           "state bem-formado de OUTRO pedido: recusado");
tudo &= ok((await postar({ state: c.state, loja: "evil.myshopify.com", accessToken: "x" })).s === 400,
           "loja diferente da pedida: recusado");
tudo &= ok((await postar({ state: c.state, loja: c.loja })).s === 400, "sem token: recusado");
tudo &= ok(!existsSync("/tmp/oauth-conexao.json"), "nada foi gravado em nenhuma das tentativas");

sec("o retorno de verdade");
const r = await postar({
  state: c.state, loja: c.loja, accessToken: "shpat_token_de_teste",
  refreshToken: "shprt_refresh", expiresIn: "3600",
  escopos: "read_orders,write_fulfillments",
});
tudo &= ok(r.s === 200, "aceito");
const conexao = await c.pronto;
tudo &= ok(conexao.loja === c.loja, "a conexão prometida resolveu com a loja certa");
tudo &= ok(conexao.modo === "oauth", "modo oauth, porque veio refresh token");
tudo &= ok(conexao.expiraEm > Date.now(), "com prazo de validade");
const salvo = JSON.parse(readFileSync("/tmp/oauth-conexao.json", "utf8"));
tudo &= ok(salvo.accessToken === "shpat_token_de_teste", "o token ficou NESTA máquina");
tudo &= ok(salvo.refreshToken === "shprt_refresh", "e o refresh token também");

sec("depois de conectado");
tudo &= ok(conexaoEmAndamento() === null, "não há mais conexão em andamento");
tudo &= ok((await postar({ state: c.state, loja: c.loja, accessToken: "repetido" })).s === 400,
           "repetir o mesmo POST não reconecta — o state é de uso único");
tudo &= ok(JSON.parse(readFileSync("/tmp/oauth-conexao.json", "utf8")).accessToken
             === "shpat_token_de_teste", "e o token salvo não foi trocado");

sec("token sem prazo");
cancelarConexao();
const c2 = iniciarConexao("outra.myshopify.com", { porta: PORTA, abrir: false });
await postar({ state: c2.state, loja: "outra.myshopify.com", accessToken: "shpat_eterno" });
const s2 = JSON.parse(readFileSync("/tmp/oauth-conexao.json", "utf8"));
tudo &= ok(s2.expiraEm === undefined, "sem expires_in, não inventa prazo de validade");
tudo &= ok(s2.modo === "token-fixo", "e o modo reflete que não há refresh token");

await col.fechar();
rmSync("/tmp/oauth-conexao.json", { force: true });
console.log(tudo ? "\n\x1b[32m\x1b[1m  o token só chega por onde a gente começou\x1b[0m\n" : "\n\x1b[31m  FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
