// Lê a planilha de controle do cliente e devolve o que o robô precisa:
// quais contas abrir e quais pedidos procurar em cada uma.
//
// É a entrada da fase 1. A planilha é a ÚNICA fonte que sabe em qual conta
// Shopee cada pedido foi pago — a Shopify não tem esse dado (DECISOES.md §4).
//
// Lida em JS puro (exceljs): exigir Python na máquina Windows do operador
// seria uma dependência a mais para falhar.

import ExcelJS from "exceljs";
import { parseTracking, parseConta } from "./tracking.mjs";

// Cabeçalhos aceitos por coluna. A planilha é editada por pessoas; o
// cabeçalho muda de acento e de maiúscula com o tempo.
const COLUNAS = {
  data:     ["data"],
  pedido:   ["numero do pedido", "n do pedido", "pedido"],
  nome:     ["nome do cliente", "cliente", "nome"],
  produto:  ["produto"],
  unidades: ["unidades", "qtd", "quantidade"],
  valor:    ["valor pago", "valor"],
  rastreio: ["codigo de rastreio", "rastreio", "codigo"],
  conta:    ["onde foi feito o pedido", "conta", "conta shopee"],
};

const normaliza = (s) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();

function mapearCabecalho(linha) {
  const achado = {};
  linha.eachCell((celula, col) => {
    const t = normaliza(celula.value);
    for (const [campo, nomes] of Object.entries(COLUNAS))
      if (achado[campo] == null && nomes.includes(t)) achado[campo] = col;
  });
  return achado;
}

const texto = (v) => {
  if (v == null) return "";
  if (typeof v === "object") {
    if (v.text) return String(v.text).trim();
    if (v.result != null) return String(v.result).trim();
    if (v.richText) return v.richText.map((r) => r.text).join("").trim();
    if (v instanceof Date) return v.toISOString();
  }
  return String(v).trim();
};

/**
 * @returns {{ contas: Array, pendentes: Array, ignorados: Array, total: number }}
 *   contas    — [{ conta, pedidos: [...] }] ordenado por nº de pedidos
 *   pendentes — linhas sem rastreio e com conta conhecida
 *   ignorados — linhas sem rastreio que o robô NÃO sabe onde procurar
 */
export async function lerPendentes(caminho, { aba } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(caminho);

  const ws = aba ? wb.getWorksheet(aba) : wb.worksheets[0];
  if (!ws) throw new Error(`aba não encontrada em ${caminho}`);

  const col = mapearCabecalho(ws.getRow(1));
  const faltando = ["pedido", "nome", "rastreio", "conta"].filter((c) => col[c] == null);
  if (faltando.length)
    throw new Error(`colunas não reconhecidas no cabeçalho: ${faltando.join(", ")} (aba "${ws.name}")`);

  const pendentes = [];
  const ignorados = [];
  let total = 0;

  ws.eachRow((linha, n) => {
    if (n === 1) return;
    const ler = (campo) => (col[campo] ? texto(linha.getCell(col[campo]).value) : "");

    const pedido = ler("pedido");
    const nome = ler("nome");
    if (!pedido && !nome) return;   // linha em branco
    total++;

    // O que a célula de rastreio diz decide se a linha é pendência:
    //   ok/multiplo/parcial  → já tem código, nada a fazer
    //   texto-nao-rastreio   → "entregue", "cancelado": resolvido por fora
    //   nao-reconhecido      → tem algo escrito que não é código: revisão
    //   vazio                → é isto que o robô vai buscar
    const r = parseTracking(ler("rastreio"));
    if (r.codes.length > 0 || r.status === "texto-nao-rastreio") return;

    const c = parseConta(ler("conta"));
    const item = {
      linha: n,
      pedido,
      nome,
      produto: ler("produto") || null,
      valor: Number(String(ler("valor")).replace(",", ".")) || null,
      unidades: Number(ler("unidades")) || null,
      contaBruta: ler("conta"),
    };

    if (r.status === "nao-reconhecido") {
      ignorados.push({ ...item, motivo: `rastreio ilegível: "${ler("rastreio")}"` });
      return;
    }
    if (c.numeros.length === 1) pendentes.push({ ...item, conta: c.numeros[0] });
    else ignorados.push({ ...item, motivo: c.numeros.length > 1 ? "mais de uma conta na célula" : "conta não reconhecida" });
  });

  const porConta = new Map();
  for (const p of pendentes) {
    if (!porConta.has(p.conta)) porConta.set(p.conta, []);
    porConta.get(p.conta).push(p);
  }
  const contas = [...porConta.entries()]
    .map(([conta, pedidos]) => ({ conta, pedidos }))
    .sort((a, b) => b.pedidos.length - a.pedidos.length);

  return { contas, pendentes, ignorados, total, aba: ws.name };
}
