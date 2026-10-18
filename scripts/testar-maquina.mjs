// A recomendação de navegadores. Errar para cima trava a máquina do cliente
// no meio de uma rodada de 300 pedidos; errar para baixo só o faz esperar.
// Então, na dúvida, para baixo.
import { calcular, custoGB, TETO } from "../src/maquina.mjs";

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

sec("máquinas reais");
const m16 = calcular({ ramGB: 16, nucleos: 16 });
tudo &= ok(m16.recomendado === 8, `16 GB e 16 núcleos -> 8 (deu ${m16.recomendado})`);
tudo &= ok(m16.limitadoPor === "núcleos", "e o limite são os núcleos, não a memória");

const m8 = calcular({ ramGB: 8, nucleos: 8 });
tudo &= ok(m8.recomendado === 4, `8 GB e 8 núcleos -> 4 (deu ${m8.recomendado})`);

sec("máquina fraca: nunca recomendar zero");
const fraca = calcular({ ramGB: 4, nucleos: 2 });
tudo &= ok(fraca.recomendado === 1, `4 GB e 2 núcleos -> 1 (deu ${fraca.recomendado})`);
const muitoFraca = calcular({ ramGB: 2, nucleos: 1 });
tudo &= ok(muitoFraca.recomendado === 1, "2 GB e 1 núcleo ainda roda 1 navegador, não 0");

sec("máquina forte: o teto manda");
const forte = calcular({ ramGB: 128, nucleos: 64 });
tudo &= ok(forte.recomendado === TETO, `128 GB e 64 núcleos -> ${TETO}, o teto`);
tudo &= ok(TETO === 10, "e o teto é 10, porque acima disso ninguém testou contra a Shopee");

sec("quem limita é quem for mais apertado");
const poucaRam = calcular({ ramGB: 6, nucleos: 32 });
tudo &= ok(poucaRam.limitadoPor === "memória", "muita CPU e pouca RAM -> limita a memória");
tudo &= ok(poucaRam.recomendado === 4, `6 GB -> 4 navegadores (deu ${poucaRam.recomendado})`);
const poucaCpu = calcular({ ramGB: 64, nucleos: 4 });
tudo &= ok(poucaCpu.limitadoPor === "núcleos", "muita RAM e pouca CPU -> limita os núcleos");
tudo &= ok(poucaCpu.recomendado === 2, `4 núcleos -> 2 navegadores (deu ${poucaCpu.recomendado})`);

sec("o custo de memória");
tudo &= ok(custoGB(1) === 0.5 && custoGB(10) === 5, "meio giga por navegador");

console.log(tudo ? "\n\x1b[32m\x1b[1m  a recomendação erra para baixo\x1b[0m\n" : "\n\x1b[31m  FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
