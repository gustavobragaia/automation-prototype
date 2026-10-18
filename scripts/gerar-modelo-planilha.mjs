// Gera a planilha-modelo que o cliente baixa antes de enviar a do dia.
//
//   node scripts/gerar-modelo-planilha.mjs
//
// Existe porque exigir cabeçalho sem oferecer o formato pronto empurra o
// erro para quem envia: ele descobre que errou só depois do upload falhar.

import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";

const COLUNAS = [
  { cab: "DATA",                    larg: 12, ex: "13/10/2026",               obrigatoria: false, nota: "data do pedido" },
  { cab: "NÚMERO DO PEDIDO",        larg: 20, ex: "Pedido #164871",           obrigatoria: true,  nota: "exatamente como aparece na Shopify" },
  { cab: "NOME DO CLIENTE",         larg: 30, ex: "Celina Maria Bittencourt", obrigatoria: true,  nota: "nome de quem RECEBE, igual ao da entrega" },
  { cab: "PRODUTO",                 larg: 28, ex: "Tábua Inox - Pequeno",     obrigatoria: false, nota: "opcional — o nome na Shopee costuma ser outro" },
  { cab: "UNIDADES",                larg: 11, ex: 1,                          obrigatoria: false, nota: "opcional" },
  { cab: "VALOR PAGO",              larg: 13, ex: 27.99,                      obrigatoria: false, nota: "ajuda a desempatar cliente com mais de um pedido" },
  { cab: "CÓDIGO DE RASTREIO",      larg: 24, ex: "",                         obrigatoria: true,  nota: "DEIXE VAZIO — é o que o robô preenche" },
  { cab: "ONDE FOI FEITO O PEDIDO", larg: 26, ex: "shopee 120",               obrigatoria: true,  nota: "a conta Shopee usada, no formato \"shopee 120\"" },
];

const wb = new ExcelJS.Workbook();
wb.creator = "Robô de rastreios";
const ws = wb.addWorksheet("PEDIDOS");

ws.addRow(COLUNAS.map((c) => c.cab));
const cab = ws.getRow(1);
cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
cab.alignment = { horizontal: "center", vertical: "middle" };
cab.height = 26;
cab.eachCell((c) => {
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D4F4B" } };
  c.border = { bottom: { style: "thin", color: { argb: "FF999999" } } };
});

ws.addRow(COLUNAS.map((c) => c.ex));
ws.addRow(COLUNAS.map((c) => (c.cab === "DATA" ? "13/10/2026" : c.cab === "NÚMERO DO PEDIDO" ? "Pedido #164872"
  : c.cab === "NOME DO CLIENTE" ? "Luciano Farias" : c.cab === "PRODUTO" ? "Titanium Lamp - Preto"
  : c.cab === "UNIDADES" ? 1 : c.cab === "VALOR PAGO" ? 28.88 : c.cab === "ONDE FOI FEITO O PEDIDO" ? "shopee 121" : "")));

COLUNAS.forEach((c, i) => { ws.getColumn(i + 1).width = c.larg; });
ws.views = [{ state: "frozen", ySplit: 1 }];

// As instruções vão numa aba separada: na aba de dados elas virariam uma
// linha a mais para o leitor descartar, e alguém acabaria preenchendo nela.
const guia = wb.addWorksheet("COMO PREENCHER");
guia.addRow(["Coluna", "Obrigatória?", "O que preencher"]);
const cabGuia = guia.getRow(1);
cabGuia.font = { bold: true, color: { argb: "FFFFFFFF" } };
cabGuia.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D4F4B" } }; });
for (const c of COLUNAS)
  guia.addRow([c.cab, c.obrigatoria ? "sim" : "não", c.nota]);
guia.addRow([]);
guia.addRow(["", "", "A primeira linha da aba PEDIDOS precisa ser o cabeçalho, com estes nomes."]);
guia.addRow(["", "", "A coluna CÓDIGO DE RASTREIO fica vazia: é ela que o robô preenche."]);
guia.addRow(["", "", "Envie só os pedidos do dia, já pagos na Shopee."]);
guia.getColumn(1).width = 26;
guia.getColumn(2).width = 14;
guia.getColumn(3).width = 62;

mkdirSync("modelo", { recursive: true });
await wb.xlsx.writeFile("modelo/planilha-modelo.xlsx");
console.log("modelo/planilha-modelo.xlsx gerado");
console.log(`${COLUNAS.length} colunas · obrigatórias: NÚMERO DO PEDIDO, NOME DO CLIENTE, CÓDIGO DE RASTREIO (vazia), ONDE FOI FEITO O PEDIDO`);
