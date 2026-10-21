// Rodada de verdade, sem escrever nada: abre as contas pedidas no AdsPower,
// coleta e cruza com a planilha. Para tentativa e erro em contas reais.
//
//   node scripts/ao-vivo.mjs <planilha.xlsx> [conta ...]       (sem contas = todas)
//   CONCORRENCIA=1 node scripts/ao-vivo.mjs ~/Downloads/modelo.xlsx 124 133
//
// Pasta de trabalho e de estado próprias (ao-vivo/ na raiz): não mexe na
// carteira nem no estado do app. O log inteiro vai para ao-vivo/log.txt.
import { mkdirSync, appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const RAIZ = resolve(import.meta.dirname, "..");
const DIR = join(RAIZ, "ao-vivo");
process.chdir(RAIZ);
process.loadEnvFile(join(RAIZ, ".env"));
process.env.TRABALHO_DIR = DIR;
process.env.ESTADO_DIR = join(DIR, "estado");
process.env.RECURSOS_DIR = RAIZ;
process.env.SHOPEE_PREFIXO ??= "chompspee";
process.env.SHOPEE_PREFIXO_ALTO ??= "Brushopee";
process.env.SHOPEE_EMAIL_DOMINIO ??= "givmail.com";
mkdirSync(DIR, { recursive: true });

const [planilha, ...pedidas] = process.argv.slice(2);
if (!planilha) { console.error("use: node scripts/ao-vivo.mjs <planilha.xlsx> [conta ...]"); process.exit(1); }

const t0 = Date.now();
const LOG = join(DIR, "log.txt");
const log = (m) => {
  const l = `${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s  ${m}`;
  console.log(l); appendFileSync(LOG, l + "\n");
};
appendFileSync(LOG, `\n===== ${new Date().toISOString()} ${pedidas.join(" ") || "todas"}\n`);

const { iniciarColetor } = await import("../src/coletor.mjs");
const { rodarFila } = await import("../src/fila.mjs");
const { resolverContas } = await import("../src/perfis.mjs");
const { lerPendentes } = await import("../src/planilha.mjs");
const { lerColetas, conciliar } = await import("../src/conciliar.mjs");
const { coletaDaConta, DIR_EVENTOS } = await import("../src/caminhos.mjs");
const { rmSync } = await import("node:fs");

const { contas: daPlanilha } = await lerPendentes(planilha);
const alvos = (pedidas.length ? daPlanilha.filter((c) => pedidas.includes(String(c.conta))) : daPlanilha);
log(`${alvos.length} conta(s), ${alvos.reduce((s, c) => s + c.pedidos.length, 0)} pedido(s) na planilha`);

const SO_PLANILHA = process.env.SO_PLANILHA === "1";   // refaz só a planilha, com as coletas já em disco
const coletor = SO_PLANILHA ? { fechar: async () => {} } : await iniciarColetor({ porta: 3000, aoLog: log });
const { resolvidas } = SO_PLANILHA ? { resolvidas: [] } : await resolverContas(alvos.map((c) => ({ conta: c.conta })), { aoLog: log });
if (!SO_PLANILHA) for (const c of resolvidas) rmSync(coletaDaConta(c.conta), { force: true });

const res = SO_PLANILHA ? alvos.map((c) => ({ conta: c.conta, ok: true })) : await rodarFila(resolvidas, { concorrencia: Number(process.env.CONCORRENCIA ?? 1), aoLog: log });
await coletor.fechar();

const coletas = lerColetas();
const { linhas } = conciliar(alvos, coletas);
const porConta = new Map();
for (const l of linhas) {
  const k = l.conta; if (!porConta.has(k)) porConta.set(k, {});
  const est = l.estado; porConta.get(k)[est] = (porConta.get(k)[est] ?? 0) + 1;
}
log("──── resultado por conta");
for (const c of alvos) {
  const r = res.find((x) => x.conta === c.conta);
  const col = coletas.get(c.conta);
  log(`conta ${c.conta}: ${r?.ok ? "coletada" : "FALHOU " + (r?.erro ?? "sem perfil")}${r?.tentativas > 1 ? ` (${r.tentativas} tentativas)` : ""} · ` +
      `${col?.length ?? 0} pedido(s) lidos · planilha ${c.pedidos.length} · ${JSON.stringify(porConta.get(c.conta) ?? {})}`);
}
log(`eventos: ${readdirSync(DIR_EVENTOS).length} arquivo(s) em ${DIR_EVENTOS}`);

// A planilha do resultado: cada pedido da planilha, com o rastreio achado ou
// o motivo de não ter achado.
const { default: ExcelJS } = await import("../src/excel.mjs");
const { MOTIVOS } = await import("../src/conciliar.mjs");
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Resultado");
ws.columns = [
  { header: "CONTA", key: "conta", width: 8 }, { header: "PEDIDO", key: "pedido", width: 16 },
  { header: "CLIENTE", key: "nome", width: 34 }, { header: "VALOR", key: "valor", width: 10 },
  { header: "CÓDIGO DE RASTREIO", key: "rastreio", width: 22 }, { header: "SITUAÇÃO", key: "situacao", width: 26 },
  { header: "POR QUÊ", key: "porque", width: 80 },
];
ws.getRow(1).font = { bold: true };
const ordem = [...linhas].sort((a, b) => a.conta - b.conta || String(a.p.pedido).localeCompare(String(b.p.pedido)));
for (const l of ordem) {
  const m = l.motivo ?? {};
  const ok = ["ok", "ok-valor", "ok-partes", "ok-total"].includes(l.estado);
  ws.addRow({ conta: l.conta, pedido: l.p.pedido ?? "", nome: l.p.nome ?? "", valor: l.p.valor ?? "",
    rastreio: ok ? l.codigo : "", situacao: ok ? (l.estado === "ok-partes" ? "rastreio encontrado (2 compras)" : l.estado === "ok-total" ? "rastreio encontrado (pelo total do cliente)" : "rastreio encontrado") : (m.rotulo ?? MOTIVOS[m.codigo]?.rotulo ?? l.estado),
    porque: ok ? "" : (m.texto ?? MOTIVOS[m.codigo]?.texto ?? "") });
}
const okN = ordem.filter((l) => ["ok", "ok-valor", "ok-partes", "ok-total"].includes(l.estado)).length;
const saida = join(DIR, `resultado-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.xlsx`);
await wb.xlsx.writeFile(saida);
log(`planilha do resultado: ${saida} · ${okN} de ${ordem.length} pedidos com rastreio`);
process.exit(0);
