// Estas validações são a ÚNICA coisa entre um link forjado e o token de
// acesso da loja de um cliente. Testadas pelos dois lados: o que tem que
// passar, e sobretudo o que NÃO pode.

import { lojaValida, hmacValido, novoEstado, lerEstado, destinoLocal }
  from "../servidor/lib/validar.js";
import { appDaLoja } from "../servidor/lib/apps.js";
import worker from "../servidor/src/worker.js";

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

const SEGREDO = "segredo-de-teste";
// assina como a Shopify assina, com WebCrypto — o mesmo que o Worker usa
const assinar = async (p) => {
  const base = Object.keys(p).filter((k) => k !== "hmac").sort()
    .map((k) => `${k}=${p[k]}`).join("&");
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(SEGREDO),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const a = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(base));
  return [...new Uint8Array(a)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

sec("o endereço da loja");
tudo &= ok(lojaValida("testeloja-4ajtpkll.myshopify.com"), "loja real passa");
tudo &= ok(!lojaValida("evil.com"), "domínio qualquer é recusado");
tudo &= ok(!lojaValida("loja.myshopify.com.evil.com"), "sufixo grudado é recusado");
tudo &= ok(!lojaValida("evil.com/x.myshopify.com"), "barra no meio é recusada");
tudo &= ok(!lojaValida("-loja.myshopify.com"), "não pode começar com hífen");
tudo &= ok(!lojaValida("LOJA.myshopify.com"), "maiúscula é recusada");
tudo &= ok(!lojaValida(""), "vazio é recusado");
tudo &= ok(!lojaValida(null) && !lojaValida(undefined), "nulo é recusado");
tudo &= ok(!lojaValida("a".repeat(200) + ".myshopify.com"), "absurdamente longo é recusado");

sec("a assinatura da Shopify");
const bons = { code: "abc123", shop: "loja.myshopify.com", state: "4000.ff", timestamp: "1700000000" };
tudo &= ok(await hmacValido({ ...bons, hmac: await assinar(bons) }, SEGREDO), "retorno assinado passa");
tudo &= ok(!await hmacValido({ ...bons, hmac: await assinar(bons) }, "outro-segredo"),
           "assinatura de outro segredo é recusada");
tudo &= ok(!await hmacValido({ ...bons, code: "trocado", hmac: await assinar(bons) }, SEGREDO),
           "mexeu no code depois de assinar: recusado");
tudo &= ok(!await hmacValido({ ...bons, shop: "evil.myshopify.com", hmac: await assinar(bons) }, SEGREDO),
           "trocou a loja depois de assinar: recusado");
tudo &= ok(!await hmacValido({ ...bons }, SEGREDO), "sem hmac nenhum: recusado");
tudo &= ok(!await hmacValido({ ...bons, hmac: "" }, SEGREDO), "hmac vazio: recusado");
tudo &= ok(!await hmacValido({ ...bons, hmac: (await assinar(bons)).slice(0, 10) }, SEGREDO),
           "hmac curto não passa por comparação de tamanho");
tudo &= ok(!await hmacValido({ ...bons, hmac: await assinar(bons) }, ""), "sem segredo: recusado");
tudo &= ok(!await hmacValido(null, SEGREDO), "parâmetros nulos: recusado");
// parâmetro a mais tem que invalidar — senão dá para pendurar coisa na URL
tudo &= ok(!await hmacValido({ ...bons, extra: "1", hmac: await assinar(bons) }, SEGREDO),
           "parâmetro pendurado depois da assinatura: recusado");

sec("o state, que liga o retorno ao nosso pedido");
const st = novoEstado(3000);
tudo &= ok(lerEstado(st)?.porta === 3000, "guarda a porta de quem pediu");
tudo &= ok(lerEstado(st)?.nonce?.length === 48, "e um nonce de 24 bytes");
tudo &= ok(novoEstado(3000) !== novoEstado(3000), "dois pedidos nunca têm o mesmo state");
tudo &= ok(lerEstado("3000.xyz") === null, "nonce fora do formato é recusado");
tudo &= ok(lerEstado("80." + "a".repeat(48)) === null, "porta privilegiada é recusada");
tudo &= ok(lerEstado("99999." + "a".repeat(48)) === null, "porta fora da faixa é recusada");
tudo &= ok(lerEstado("") === null && lerEstado(null) === null, "vazio é recusado");
let errou = false;
try { novoEstado(80); } catch { errou = true; }
tudo &= ok(errou, "não deixa nem criar state com porta privilegiada");

sec("para onde o token volta");
tudo &= ok(destinoLocal(st) === "http://127.0.0.1:3000/shopify/pronto",
           "sempre 127.0.0.1, nunca um host de fora");
tudo &= ok(destinoLocal("3000.xyz") === null, "state inválido não gera destino");
tudo &= ok(!/esteira|https/.test(destinoLocal(st)), "o token nunca volta para a nuvem");


sec("o navegador recebe o endereço INTEIRO também no Windows");
// No Windows quem abre é o cmd, e "&" separa comandos para ele: o endereço
// chegava cortado, sem o state, e "Conectar Shopify" falhava sempre.
const { argumentosDoNavegador } = await import("../src/shopify-oauth.mjs");
const urlTeste = "https://esteira.cloud/shopify/instalar?loja=x.myshopify.com&state=3000.abc";
const [cmdW, argsW] = argumentosDoNavegador(urlTeste, "win32");
tudo &= ok(cmdW === "cmd", "no Windows abre pelo cmd");
tudo &= ok(argsW.at(-1).includes("^&state="), "com o & escapado (^&), que o cmd devolve como & ao navegador");
tudo &= ok(!/[^^]&/.test(argsW.at(-1)), "e nenhum & solto sobrando para o cmd cortar");
const [cmdM, argsM] = argumentosDoNavegador(urlTeste, "darwin");
tudo &= ok(cmdM === "open" && argsM[0] === urlTeste, "no Mac o endereço segue intacto, sem escape");


sec("cada loja vai para o app que pode ser instalado nela");
const ENV = {
  BASE_URL: "https://esteira.cloud",
  SHOPIFY_CLIENT_ID: "app-principal", SHOPIFY_CLIENT_SECRET: "segredo-principal",
  SHOPIFY_LOJAS: '{"loja-sparta-store.myshopify.com": "SPARTA"}',
  SHOPIFY_CLIENT_ID_SPARTA: "app-sparta", SHOPIFY_CLIENT_SECRET_SPARTA: "segredo-sparta",
};
tudo &= ok(appDaLoja("loja-sparta-store.myshopify.com", ENV)?.clientId === "app-sparta",
           "a loja da Sparta usa o app dela");
tudo &= ok(appDaLoja("testeloja-4ajtpkll.myshopify.com", ENV)?.clientId === "app-principal",
           "loja fora da lista usa o app principal");
const semSegredo = { ...ENV }; delete semSegredo.SHOPIFY_CLIENT_SECRET_SPARTA;
tudo &= ok(appDaLoja("loja-sparta-store.myshopify.com", semSegredo) === null,
           "faltando o segredo do app dela, RECUSA — não cai no app principal");
tudo &= ok(appDaLoja("x.myshopify.com", { ...ENV, SHOPIFY_LOJAS: "{quebrado" }) === null,
           "lista malformada: ninguém passa");
tudo &= ok(appDaLoja("x.myshopify.com", { ...ENV, SHOPIFY_LOJAS: '{"x.myshopify.com": "../X"}' }) === null,
           "nome de app esquisito é recusado");
tudo &= ok(appDaLoja("__proto__", ENV)?.clientId === "app-principal" &&
           appDaLoja("constructor", ENV)?.clientId === "app-principal",
           "chaves herdadas do objeto não viram app");

// pelo Worker de verdade, do jeito que o navegador chama
const estado = novoEstado(3000);
const ir = async (loja, env) => worker.fetch(new Request(
  `https://esteira.cloud/shopify/instalar?loja=${loja}&state=${estado}`), env);
const r1 = await ir("loja-sparta-store.myshopify.com", ENV);
tudo &= ok(r1.status === 302 && new URL(r1.headers.get("location")).searchParams.get("client_id") === "app-sparta",
           "/shopify/instalar manda a Sparta para a tela de permissão do app dela");
const r2 = await ir("testeloja-4ajtpkll.myshopify.com", ENV);
tudo &= ok(new URL(r2.headers.get("location")).searchParams.get("client_id") === "app-principal",
           "e a loja de teste para o app principal");
const r3 = await ir("loja-sparta-store.myshopify.com", semSegredo);
tudo &= ok(r3.status === 503, "sem o segredo da Sparta, a página diz que a loja não está configurada");

// o retorno da Shopify é conferido com o segredo do app DAQUELA loja
const cb = async (params, env) => worker.fetch(new Request(
  "https://esteira.cloud/shopify/callback?" + new URLSearchParams(params)), env);
const assinarCom = async (p, segredo) => {
  const base = Object.keys(p).sort().map((k) => `${k}=${p[k]}`).join("&");
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const a = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(base));
  return [...new Uint8Array(a)].map((b) => b.toString(16).padStart(2, "0")).join("");
};
const ret = { code: "abcdef123456", shop: "loja-sparta-store.myshopify.com", state: estado, timestamp: "1700000000" };
const comPrincipal = await cb({ ...ret, hmac: await assinarCom(ret, "segredo-principal") }, ENV);
tudo &= ok(comPrincipal.status === 400,
           "retorno da Sparta assinado com o segredo do app PRINCIPAL é recusado");
const fetchReal = globalThis.fetch; let pedido = null;
globalThis.fetch = async (url, o) => { pedido = { url: String(url), corpo: JSON.parse(o.body) };
  return new Response(JSON.stringify({ access_token: "shpat_teste", scope: "read_orders" })); };
const certo = await cb({ ...ret, hmac: await assinarCom(ret, "segredo-sparta") }, ENV);
globalThis.fetch = fetchReal;
tudo &= ok(certo.status === 200 && pedido?.corpo.client_id === "app-sparta" &&
           pedido?.corpo.client_secret === "segredo-sparta",
           "assinado com o segredo dela, troca o code usando as credenciais do app dela");

console.log(tudo ? "\n\x1b[32m\x1b[1m  link forjado não vira token\x1b[0m\n" : "\n\x1b[31m  FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
