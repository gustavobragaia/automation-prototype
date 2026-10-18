// Estas validações são a ÚNICA coisa entre um link forjado e o token de
// acesso da loja de um cliente. Testadas pelos dois lados: o que tem que
// passar, e sobretudo o que NÃO pode.
import { createHmac } from "node:crypto";
import { lojaValida, hmacValido, novoEstado, lerEstado, destinoLocal }
  from "../servidor/lib/validar.js";

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

const SEGREDO = "segredo-de-teste";
const assinar = (p) => createHmac("sha256", SEGREDO)
  .update(Object.keys(p).filter((k) => k !== "hmac").sort().map((k) => `${k}=${p[k]}`).join("&"))
  .digest("hex");

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
tudo &= ok(hmacValido({ ...bons, hmac: assinar(bons) }, SEGREDO), "retorno assinado passa");
tudo &= ok(!hmacValido({ ...bons, hmac: assinar(bons) }, "outro-segredo"),
           "assinatura de outro segredo é recusada");
tudo &= ok(!hmacValido({ ...bons, code: "trocado", hmac: assinar(bons) }, SEGREDO),
           "mexeu no code depois de assinar: recusado");
tudo &= ok(!hmacValido({ ...bons, shop: "evil.myshopify.com", hmac: assinar(bons) }, SEGREDO),
           "trocou a loja depois de assinar: recusado");
tudo &= ok(!hmacValido({ ...bons }, SEGREDO), "sem hmac nenhum: recusado");
tudo &= ok(!hmacValido({ ...bons, hmac: "" }, SEGREDO), "hmac vazio: recusado");
tudo &= ok(!hmacValido({ ...bons, hmac: assinar(bons).slice(0, 10) }, SEGREDO),
           "hmac curto não passa por comparação de tamanho");
tudo &= ok(!hmacValido({ ...bons, hmac: assinar(bons) }, ""), "sem segredo: recusado");
tudo &= ok(!hmacValido(null, SEGREDO), "parâmetros nulos: recusado");
// parâmetro a mais tem que invalidar — senão dá para pendurar coisa na URL
tudo &= ok(!hmacValido({ ...bons, extra: "1", hmac: assinar(bons) }, SEGREDO),
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

console.log(tudo ? "\n\x1b[32m\x1b[1m  link forjado não vira token\x1b[0m\n" : "\n\x1b[31m  FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
