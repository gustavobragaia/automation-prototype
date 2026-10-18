// Documento do que o robô encontrou: por conta, cada pedido da planilha e o
// rastreio achado na Shopee.
//
//   node --env-file=.env scripts/relatorio.mjs
//
// Serve para conferir ANTES de escrever na Shopify. Um número no terminal
// não deixa ninguém auditar; uma tabela lado a lado deixa.

import { writeFileSync, mkdirSync } from "node:fs";
import { lerPendentes } from "../src/planilha.mjs";
import { lerColetas, conciliar } from "../src/conciliar.mjs";
import { emailDaConta } from "../src/tracking.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const r = await lerPendentes(process.env.PLANILHA, { aba: process.env.PLANILHA_ABA });
const coletas = lerColetas();

if (coletas.size === 0) {
  console.error("nenhuma coleta em captura/coletas/ — rode a coleta antes");
  process.exit(1);
}

const { linhas, resumo } = conciliar(r.contas, coletas);
const { casados, ambiguos, semCodigo, naoAchados } = resumo;

const total = linhas.length;
const pct = (n) => (total ? ((n / total) * 100).toFixed(1) : "0") + "%";
const ROTULO = {
  ok: ["resolvido", "ok"], "ok-valor": ["resolvido pelo valor", "ok"],
  "ok-partes": ["pedido dividido em 2 encomendas", "ok"],
  ambiguo: ["ambíguo — revisão", "aten"], "sem-codigo": ["ainda sem rastreio", "aten"],
  "nao-achado": ["não encontrado na conta", "ruim"],
};

const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rastreios encontrados</title><style>
:root{--g:#f2f3f1;--s:#fff;--i:#14181a;--m:#5c6563;--a:#0d4f4b;--f:#a8442c;--w:#8a6d1f;--l:#d6dad3}
*{box-sizing:border-box}body{margin:0;padding:28px;background:var(--g);color:var(--i);
font:15px/1.55 -apple-system,"Helvetica Neue",Arial,sans-serif}
.wrap{max-width:1180px;margin:0 auto}h1{font-size:1.6rem;margin:0 0 4px;letter-spacing:-.02em}
.sub{color:var(--m);font-size:.9rem;margin:0 0 22px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1px;background:var(--l);
border:1px solid var(--l);border-radius:4px;overflow:hidden;margin-bottom:26px}
.card{background:var(--s);padding:15px 17px}
.card .n{font:600 1.7rem/1 ui-monospace,Menlo,monospace;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.card .l{font-size:.78rem;color:var(--m);margin-top:5px}
.n.ok{color:var(--a)}.n.aten{color:var(--w)}.n.ruim{color:var(--f)}
h2{font-size:1rem;margin:26px 0 8px;letter-spacing:-.01em}
.scroll{overflow-x:auto;border:1px solid var(--l);border-radius:4px;background:var(--s)}
table{border-collapse:collapse;width:100%;font-size:.88rem}
th{text-align:left;font-size:.68rem;text-transform:uppercase;letter-spacing:.09em;color:var(--m);
padding:10px 13px;border-bottom:1px solid #b9bfb7;white-space:nowrap}
td{padding:10px 13px;border-bottom:1px solid var(--l);vertical-align:top}
tr:last-child td{border-bottom:none}
.mono{font-family:ui-monospace,Menlo,monospace;font-size:.85rem;white-space:nowrap}
.cod{font-weight:600;color:var(--a)}
.tag{display:inline-block;font-size:.7rem;padding:2px 8px;border-radius:9px;white-space:nowrap}
.tag.ok{background:#dde8e5;color:var(--a)}.tag.aten{background:#f6edd7;color:var(--w)}
.tag.ruim{background:#f2e2dc;color:var(--f)}
.conta{background:#eef0ec;font-weight:600}
</style></head><body><div class="wrap">
<h1>Rastreios encontrados</h1>
<p class="sub">${esc(process.env.PLANILHA?.split("/").pop() ?? "planilha")} · ${coletas.size} conta(s) coletada(s) · ${new Date().toLocaleString("pt-BR")}</p>
<div class="cards">
<div class="card"><div class="n ok">${casados}</div><div class="l">rastreios encontrados · ${pct(casados)}</div></div>
<div class="card"><div class="n aten">${ambiguos}</div><div class="l">ambíguos, vão para revisão</div></div>
<div class="card"><div class="n aten">${semCodigo}</div><div class="l">achados, ainda sem rastreio</div></div>
<div class="card"><div class="n ruim">${naoAchados}</div><div class="l">não encontrados na conta</div></div>
<div class="card"><div class="n">${total}</div><div class="l">pedidos da planilha</div></div>
</div>
<div class="scroll"><table>
<tr><th>Pedido</th><th>Cliente</th><th>Valor</th><th>Rastreio encontrado</th><th>CEP na Shopee</th><th>Situação</th></tr>
${[...coletas.keys()].sort((a, b) => a - b).map((conta) => {
  const doGrupo = linhas.filter((l) => l.conta === conta);
  const achados = (coletas.get(conta) ?? []).length;
  return `<tr class="conta"><td colspan="6">Shopee ${String(conta).padStart(3, "0")} · ${esc(emailDaConta(conta))} · ${doGrupo.length} pedido(s) na planilha, ${achados} na conta</td></tr>` +
    doGrupo.map((l) => {
      const [rot, cls] = ROTULO[l.estado];
      return `<tr>
        <td class="mono">${esc(l.p.pedido)}</td>
        <td>${esc(l.p.nome)}</td>
        <td class="mono">${l.p.valor != null ? "R$ " + l.p.valor.toFixed(2) : "—"}</td>
        <td class="mono cod">${esc(l.codigo || "—")}</td>
        <td class="mono">${esc(l.achado?.cep ?? "—")}</td>
        <td><span class="tag ${cls}">${rot}${l.estado === "ambiguo" ? ` (${l.candidatos})` : ""}</span></td>
      </tr>`;
    }).join("");
}).join("")}
</table></div></div></body></html>`;

mkdirSync("saida", { recursive: true });
const arq = `saida/relatorio-${new Date().toISOString().slice(0, 10)}.html`;
writeFileSync(arq, html);
console.log(`${arq}`);
console.log(`${casados} encontrados · ${ambiguos} ambíguos · ${semCodigo} sem rastreio · ${naoAchados} não achados  (de ${total})`);
