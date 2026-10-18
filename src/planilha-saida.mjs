// A planilha que o cliente recebe no fim da rodada.
//
// Era um processo `node` chamando um processo `python3` com openpyxl. Nenhum
// dos três existe na máquina de quem instala o app, e a falha caía num
// try/catch que só escrevia no log — ou seja, o entregável do produto
// simplesmente não sairia, em silêncio.
//
// Agora é exceljs, em processo, que já era dependência do projeto.
//
// O formato é o mesmo de antes, coluna por coluna, porque é a planilha que
// a operação já usa: mudar a ordem quebraria quem lê do outro lado.
import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { carregar } from "./estado.mjs";
import { emTrabalho } from "./caminhos.mjs";
import { diaLocal } from "./datas.mjs";

const COLUNAS = [
  { cab: "DATA", campo: "data", larg: 12 },
  { cab: "NÚMERO DO PEDIDO", campo: "pedido", larg: 18 },
  { cab: "NOME DO CLIENTE", campo: "nome", larg: 30 },
  { cab: "PRODUTO", campo: "produto", larg: 42 },
  { cab: "UNIDADES", campo: "unidades", larg: 10 },
  { cab: "VALOR PAGO", campo: "valor", larg: 12 },
  { cab: "CÓDIGO DE RASTREIO", campo: "rastreio", larg: 34 },
  { cab: "ONDE FOI FEITO O PEDIDO", campo: "conta", larg: 24 },
  { cab: "ID SHOPEE", campo: "orderIdShopee", larg: 20 },
  { cab: "CEP", campo: "cep", larg: 12 },
];

export function linhasDoEstado(estado = carregar(), { tudo = false } = {}) {
  return Object.values(estado)
    .filter((p) => tudo || p.despachado)
    .sort((a, b) => (a.primeiroVistoEm ?? "").localeCompare(b.primeiroVistoEm ?? ""))
    .map((p) => ({
      data: (p.primeiroVistoEm ?? "").slice(0, 10),
      pedido: p.pedidoShopify ?? "",          // preenchido quando o casamento acontece
      nome: p.nome ?? "",
      produto: p.produto ?? "",
      unidades: p.unidades ?? "",
      valor: p.valor ?? "",
      rastreio: (p.codigos ?? []).join(" - "),
      conta: p.conta != null ? `shopee ${String(p.conta).padStart(3, "0")}` : "",
      orderIdShopee: p.orderId,
      cep: p.cep ?? "",
    }));
}

// Data local, não toISOString: no Brasil o UTC joga o nome do arquivo para
// o dia anterior durante a noite inteira, e o cliente abre "ontem" achando
// que a rodada de hoje não saiu.
const hojeLocal = (d = new Date()) => diaLocal(d);

/**
 * Escreve a planilha e devolve { arquivo, linhas }, ou null se não havia
 * nada a escrever — planilha vazia no lugar da de ontem seria pior.
 */
export async function escreverPlanilha({ tudo = false, estado, destino } = {}) {
  const linhas = linhasDoEstado(estado ?? carregar(), { tudo });
  if (!linhas.length) return null;

  const dir = emTrabalho("saida");
  mkdirSync(dir, { recursive: true });
  // Nunca sobrescreve a planilha mestre do cliente: arquivo novo, sempre.
  const arquivo = destino ?? join(dir, `pedidos-${hojeLocal()}.xlsx`);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("PEDIDOS");
  ws.addRow(COLUNAS.map((c) => c.cab));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { horizontal: "center" };
  for (const l of linhas) ws.addRow(COLUNAS.map((c) => l[c.campo]));
  COLUNAS.forEach((c, i) => { ws.getColumn(i + 1).width = c.larg; });
  ws.views = [{ state: "frozen", ySplit: 1 }];

  await wb.xlsx.writeFile(arquivo);
  return { arquivo, linhas: linhas.length };
}
