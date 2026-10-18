// Gera a planilha no mesmo formato da que a operação já usa hoje:
// DATA | NÚMERO DO PEDIDO | NOME DO CLIENTE | PRODUTO | UNIDADES |
// VALOR PAGO | CÓDIGO DE RASTREIO | ONDE FOI FEITO O PEDIDO
//
//   node escrever-planilha.mjs                    -> saida/pedidos-AAAA-MM-DD.xlsx
//   node escrever-planilha.mjs --tudo             -> inclui os não despachados
//
// O trabalho de verdade mora em src/planilha-saida.mjs, para o app poder
// chamar em processo: aqui é só a casca de linha de comando.
import { escreverPlanilha } from "./src/planilha-saida.mjs";

const tudo = process.argv.includes("--tudo");
const r = await escreverPlanilha({ tudo });

if (!r) {
  console.log("nenhum pedido a escrever" + (tudo ? "" : " (use --tudo para incluir os não despachados)"));
  process.exit(0);
}
console.log(r.arquivo);
console.log(`${r.linhas} pedido(s) escritos`);
console.log(`(${tudo ? "incluindo não despachados" : "apenas despachados"})`);
