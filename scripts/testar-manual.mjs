// A saída de emergência não pode virar porta dos fundos: ela escreve na
// Shopify igual ao robô, então recusa antes de chegar na rede o que não
// deve passar. (Os casos que dependem da loja estão provados contra a loja
// de teste; aqui ficam os que não precisam de rede.)
import { prepararManual } from "../src/manual.mjs";

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

sec("recusa antes de tocar na rede");
const r1 = await prepararManual("entregue", "BR263500935831Z");
tudo &= ok(r1.ok === false && /número de pedido/.test(r1.erro), "número de pedido ilegível");

const r2 = await prepararManual("#1008", "entregue ontem");
tudo &= ok(r2.ok === false && /código de rastreio/.test(r2.erro), "texto que não tem código");

const r3 = await prepararManual("#1008", "");
tudo &= ok(r3.ok === false, "texto vazio");

const r4 = await prepararManual("#1008", null);
tudo &= ok(r4.ok === false, "nada colado");

const r5 = await prepararManual("#1008", "BR269999999999X");
tudo &= ok(r5.ok === false && /simula/.test(r5.erro),
           "código de simulação é recusado também por aqui");

sec("aceita o código no meio de texto solto");
// o operador cola o que recebeu, não um campo limpo
const { parseTracking } = await import("../src/tracking.mjs");
const t = parseTracking("oi, segue o rastreio BR263500935831Z obrigado");
tudo &= ok(t.codes?.length === 1, "extrai o código de uma mensagem inteira");
const t2 = parseTracking("BR263500935831Z e também SPXLM17485496");
tudo &= ok(t2.codes?.length === 2, "e pega os dois quando o pedido veio em duas encomendas");

console.log(tudo ? "\n\x1b[32m\x1b[1m  a saída manual é tão rigorosa quanto o robô\x1b[0m\n" : "\n\x1b[31m  FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
