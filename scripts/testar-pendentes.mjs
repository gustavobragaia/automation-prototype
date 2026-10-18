// A planilha do cliente traz só os pagos do dia. Quem não resolveu ontem
// não está nela — e sem esta fusão, some.
import { juntarPendentes } from "../src/ciclo.mjs";

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

const hoje = [
  { conta: 124, pedidos: [{ pedido: "#165200", nome: "Novo Cliente", valor: 10 }] },
];

sec("sem atrasados, nada muda");
const a = juntarPendentes(hoje, []);
tudo &= ok(a.length === 1 && a[0].pedidos.length === 1, "a planilha passa intacta");

sec("atrasado de uma conta que JÁ ia ser aberta");
const b = juntarPendentes(hoje, [
  { pedido: "#164891", conta: 124, nome: "Ana Lima", valor: 37.89, dias: 2 }]);
tudo &= ok(b.length === 1, "não cria conta nova");
tudo &= ok(b[0].pedidos.length === 2, "o pedido antigo entra junto");
tudo &= ok(b[0].pedidos[1].deDiasAnteriores === 2, "e carrega há quantos dias está penando");

sec("atrasado de uma conta que NÃO ia ser aberta hoje");
const c = juntarPendentes(hoje, [
  { pedido: "#165091", conta: 152, nome: "José Tolentino", valor: 23.99, dias: 4 }]);
tudo &= ok(c.length === 2, "a conta 152 passa a ser aberta por causa dele");
tudo &= ok(c.find((x) => x.conta === 152).pedidos[0].pedido === "#165091", "com o pedido certo dentro");

sec("o mesmo pedido na planilha de hoje E na carteira");
const d = juntarPendentes(
  [{ conta: 124, pedidos: [{ pedido: "#164891", nome: "Ana Lima CORRIGIDA", valor: 40 }] }],
  [{ pedido: "#164891", conta: 124, nome: "Ana Lima", valor: 37.89, dias: 3 }]);
tudo &= ok(d[0].pedidos.length === 1, "não duplica");
tudo &= ok(d[0].pedidos[0].nome === "Ana Lima CORRIGIDA",
           "e a planilha de hoje vence — é a correção do cliente");

sec("correção de conta sobrevive à planilha de amanhã");
// O operador corrigiu sabendo que a planilha estava errada. Sem isto, a
// planilha do dia seguinte reverteria e a correção duraria um dia.
const corr = juntarPendentes(
  [{ conta: 124, pedidos: [{ pedido: "#165091", nome: "José Tolentino", valor: 23.99 }] }],
  [{ pedido: "#165091", conta: 161, nome: "José Tolentino", valor: 23.99, dias: 6,
     contaCorrigida: true }]);
tudo &= ok(!corr.find((c) => c.conta === 124)?.pedidos.length,
           "sai da conta errada que a planilha repetiu");
tudo &= ok(corr.find((c) => c.conta === 161)?.pedidos[0].pedido === "#165091",
           "e fica na conta que o operador corrigiu");
tudo &= ok(corr.flatMap((c) => c.pedidos).length === 1, "sem duplicar");

const semCorr = juntarPendentes(
  [{ conta: 124, pedidos: [{ pedido: "#165091", nome: "Nome corrigido pelo cliente" }] }],
  [{ pedido: "#165091", conta: 161, nome: "Nome velho", dias: 6 }]);
tudo &= ok(semCorr.find((c) => c.conta === 124)?.pedidos[0].nome === "Nome corrigido pelo cliente",
           "sem correção manual, a planilha continua vencendo");

sec("o original não é modificado");
const orig = [{ conta: 9, pedidos: [{ pedido: "#1", nome: "X" }] }];
juntarPendentes(orig, [{ pedido: "#2", conta: 9, nome: "Y", dias: 1 }]);
tudo &= ok(orig[0].pedidos.length === 1, "juntar não mexe na lista que recebeu");

sec("atrasado sem número de pedido");
const e = juntarPendentes(hoje, [{ conta: 124, nome: "Sem número", dias: 1 }]);
tudo &= ok(e[0].pedidos.length === 1, "é ignorado — sem número não dá para escrever");

console.log(tudo ? "\n\x1b[32m\x1b[1m  nada atravessa o dia sem ser visto\x1b[0m\n" : "\n\x1b[31m  FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
