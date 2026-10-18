// O barramento que faz a tela desenhar a rodada enquanto ela corre.
//
// O que importa aqui não é "chamou o ouvinte". É: nome errado estoura em
// vez de virar evento mudo, um ouvinte quebrado não derruba a coleta, e a
// parada não cancela a rodada seguinte.
import { aoEvento, emitir, limparOuvintes, TIPOS } from "../src/eventos.mjs";

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

sec("o vocabulário é fechado");
let estourou = false;
try { emitir("conta:dancando"); } catch { estourou = true; }
tudo &= ok(estourou, "tipo fora da lista estoura em vez de virar evento mudo");
tudo &= ok(TIPOS.has("conta:humano"), "e o que a tela espera está na lista");

sec("quem escuta, recebe");
const vistos = [];
const parar = aoEvento((e) => vistos.push(e));
emitir("conta:abrindo", { conta: 124 });
emitir("conta:feita", { conta: 124, pedidos: 9, segundos: 48 });
tudo &= ok(vistos.length === 2, `chegaram 2 eventos (chegaram ${vistos.length})`);
tudo &= ok(vistos[1].pedidos === 9, "com os dados junto");
tudo &= ok(typeof vistos[0].em === "number", "e com a hora, que a tela usa para ordenar");

sec("desinscrever funciona");
parar();
emitir("conta:lendo", { conta: 124 });
tudo &= ok(vistos.length === 2, "depois de cancelar, não chega mais nada");

sec("um ouvinte quebrado não derruba a coleta");
// Este é o ponto todo: a tela é enfeite, a coleta é o trabalho. Um erro ao
// desenhar não pode abortar uma rodada de 300 pedidos no meio.
limparOuvintes();
const bons = [];
aoEvento(() => { throw new Error("a tela explodiu"); });
aoEvento((e) => bons.push(e));
let derrubou = false;
try { emitir("conta:falhou", { conta: 130, erro: "x" }); } catch { derrubou = true; }
tudo &= ok(!derrubou, "emitir não propaga o erro do ouvinte");
tudo &= ok(bons.length === 1, "e o ouvinte seguinte ainda recebe");

sec("a parada vale só para a rodada de agora");
const { pedirParada, paradaPedida, rodarFila } = await import("../src/fila.mjs");
pedirParada();
tudo &= ok(paradaPedida() === true, "pedir parada marca");
// Uma parada esquecida de ontem faria a rodada de hoje não abrir conta
// nenhuma e terminar em silêncio — o pior resultado possível. Rodar a fila
// vazia é o jeito barato de provar que ela limpa a marca ao começar.
await rodarFila([]);
tudo &= ok(paradaPedida() === false, "e começar uma rodada limpa a marca");

limparOuvintes();
console.log(tudo ? "\n\x1b[32m\x1b[1m  eventos de pé\x1b[0m\n"
                 : "\n\x1b[31m\x1b[1m  eventos com furo\x1b[0m\n");
process.exit(tudo ? 0 : 1);
