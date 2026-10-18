// Os arquivos que a pessoa baixa pela tela.
//
// Os três botões existiam e não faziam nada — `onclick = function(){}`.
// "Baixar esta planilha em branco" na etapa 1, e "baixar a planilha
// preenchida", "baixar em CSV", "exportar período" no Histórico. Um botão
// que não responde é pior que botão nenhum: a pessoa clica, espera, clica
// de novo, e acha que o programa travou.
import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";

// As colunas que o leitor da planilha reconhece. É o mesmo vocabulário de
// src/planilha.mjs: um modelo com outro cabeçalho seria um modelo que o
// próprio robô não consegue ler.
const MODELO = [
  { cab: "DATA", larg: 12, ex: "2026-10-18" },
  { cab: "NÚMERO DO PEDIDO", larg: 18, ex: "#164891" },
  { cab: "NOME DO CLIENTE", larg: 30, ex: "Nome de quem recebe" },
  { cab: "VALOR PAGO", larg: 12, ex: 88.3 },
  { cab: "CÓDIGO DE RASTREIO", larg: 30, ex: "" },
  { cab: "ONDE FOI FEITO O PEDIDO", larg: 26, ex: "shopee 124" },
];

export async function escreverModelo(caminho) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("PEDIDOS");
  ws.addRow(MODELO.map((c) => c.cab));
  ws.getRow(1).font = { bold: true };
  // uma linha de exemplo, em cinza, para mostrar o formato de cada coluna
  ws.addRow(MODELO.map((c) => c.ex));
  ws.getRow(2).font = { color: { argb: "FF9A9A9A" }, italic: true };
  MODELO.forEach((c, i) => { ws.getColumn(i + 1).width = c.larg; });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  await wb.xlsx.writeFile(caminho);
}

const SITUACAO = { escrito: "escrito", revisao: "na conferência", semcod: "sem rastreio ainda" };
const CAB = ["DATA", "HORA", "NÚMERO DO PEDIDO", "CONTA", "CÓDIGO DE RASTREIO", "SITUAÇÃO", "COMO"];
const linha = (d, p) => [d.br, p.h, p.p, p.ct != null ? `shopee ${p.ct}` : "",
  p.r || "", SITUACAO[p.s] ?? p.s, p.s === "escrito" ? (p.origem === "manual" ? "à mão" : "robô") : ""];

/** @returns {Promise<number>} quantas linhas saíram */
export async function exportarDias(dias, caminho, formato = "xlsx") {
  const linhas = [];
  for (const d of dias) for (const p of d.pedidos) linhas.push(linha(d, p));

  if (formato === "csv") {
    // ponto-e-vírgula e BOM: é como o Excel em português abre CSV sem
    // embaralhar as colunas e sem estragar os acentos
    const esc = (v) => {
      const t = String(v ?? "");
      return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    writeFileSync(caminho, "﻿" + [CAB, ...linhas].map((l) => l.map(esc).join(";")).join("\r\n"));
    return linhas.length;
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("HISTÓRICO");
  ws.addRow(CAB);
  ws.getRow(1).font = { bold: true };
  for (const l of linhas) ws.addRow(l);
  [12, 8, 18, 12, 34, 20, 8].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  await wb.xlsx.writeFile(caminho);
  return linhas.length;
}
