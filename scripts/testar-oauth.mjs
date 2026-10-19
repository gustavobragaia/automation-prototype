// Estas validações são a ÚNICA coisa entre um link forjado e o token de
// acesso da loja de um cliente. Testadas pelos dois lados: o que tem que
// passar, e sobretudo o que NÃO pode.

import { lojaValida, hmacValido, novoEstado, lerEstado, destinoLocal }
  from "../servidor/lib/validar.js";

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

console.log(tudo ? "\n\x1b[32m\x1b[1m  link forjado não vira token\x1b[0m\n" : "\n\x1b[31m  FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
