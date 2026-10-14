// Gera a planilha no mesmo formato da que a operação já usa hoje:
// DATA | NÚMERO DO PEDIDO | NOME DO CLIENTE | PRODUTO | UNIDADES |
// VALOR PAGO | CÓDIGO DE RASTREIO | ONDE FOI FEITO O PEDIDO
//
//   node escrever-planilha.mjs                    -> saida/pedidos-AAAA-MM-DD.xlsx
//   node escrever-planilha.mjs --tudo             -> inclui os não despachados
//
// Nunca sobrescreve a planilha mestre do cliente: escreve arquivo novo.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { carregar } from "./src/estado.mjs";

const tudo = process.argv.includes("--tudo");
const estado = carregar();

const linhas = Object.values(estado)
  .filter((p) => tudo || p.despachado)
  .sort((a, b) => (a.primeiroVistoEm ?? "").localeCompare(b.primeiroVistoEm ?? ""))
  .map((p) => ({
    data: (p.primeiroVistoEm ?? "").slice(0, 10),
    pedido: p.pedidoShopify ?? "",              // preenchido quando o casamento acontece
    nome: p.nome ?? "",
    produto: p.produto ?? "",
    unidades: p.unidades ?? "",
    valor: p.valor ?? "",
    rastreio: (p.codigos ?? []).join(" - "),
    conta: p.conta != null ? `shopee ${String(p.conta).padStart(3, "0")}` : "",
    orderIdShopee: p.orderId,
    cep: p.cep ?? "",
  }));

if (linhas.length === 0) {
  console.log("nenhum pedido a escrever" + (tudo ? "" : " (use --tudo para incluir os não despachados)"));
  process.exit(0);
}

mkdirSync("saida", { recursive: true });
const arq = `saida/pedidos-${new Date().toISOString().slice(0, 10)}.xlsx`;
writeFileSync("saida/.linhas.json", JSON.stringify(linhas));

const py = `
import json, sys
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment
from openpyxl.utils import get_column_letter

linhas = json.load(open("saida/.linhas.json"))
wb = Workbook(); ws = wb.active; ws.title = "PEDIDOS"

cab = ["DATA","NÚMERO DO PEDIDO","NOME DO CLIENTE","PRODUTO","UNIDADES",
       "VALOR PAGO","CÓDIGO DE RASTREIO","ONDE FOI FEITO O PEDIDO",
       "ID SHOPEE","CEP"]
ws.append(cab)
for c in ws[1]:
    c.font = Font(bold=True)
    c.alignment = Alignment(horizontal="center")

for l in linhas:
    ws.append([l["data"], l["pedido"], l["nome"], l["produto"], l["unidades"],
               l["valor"], l["rastreio"], l["conta"], l["orderIdShopee"], l["cep"]])

for i, larg in enumerate([12,18,30,42,10,12,34,24,20,12], start=1):
    ws.column_dimensions[get_column_letter(i)].width = larg
ws.freeze_panes = "A2"
wb.save(sys.argv[1])
print(len(linhas))
`;

const n = execFileSync("python3", ["-c", py, arq], { encoding: "utf8" }).trim();
console.log(`${n} pedido(s) escritos em ${arq}`);
console.log(`(${tudo ? "incluindo" : "apenas"} ${tudo ? "não despachados" : "despachados"})`);
