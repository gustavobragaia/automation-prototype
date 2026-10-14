// Painel local. Existe porque a fila de revisão só vale se alguém a vir:
// o desenho "nunca escrever sob dúvida" só funciona se o duvidoso
// aparecer na frente de uma pessoa.

import { createServer } from "node:http";
import { carregar } from "./estado.mjs";
import { historico } from "./ciclo.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const dh = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
const dur = (ms) => (ms == null ? "—" : ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}min ${Math.round((ms % 60000) / 1000)}s`);

function pagina({ estado, rodadas, rodando }) {
  const pedidos = Object.values(estado);
  const emRevisao = pedidos.filter((p) => p.revisao);
  const aguardando = pedidos.filter((p) => !p.despachado && !p.enviadoShopify && !p.revisao);
  const prontos = pedidos.filter((p) => p.enviadoShopify);
  const ultima = rodadas[0];

  const problema = ultima && (ultima.coletadas === 0 || ultima.falhas?.length);

  const cartao = (n, r, cls = "") => `<div class="cartao ${cls}"><span class="n">${n}</span><span class="r">${r}</span></div>`;

  const linhaRevisao = (p) => `<tr>
    <td class="mono">${esc(p.orderId)}</td>
    <td>${esc(p.nome)}</td>
    <td class="mono">${esc(p.cep ?? "")}</td>
    <td class="mono">${esc((p.codigos ?? []).join(", ") || "—")}</td>
    <td class="motivo">${esc(p.revisao?.motivo)}</td>
    <td><form method="POST" action="/resolver"><input type="hidden" name="orderId" value="${esc(p.orderId)}"><button>Dispensar</button></form></td>
  </tr>`;

  const linhaRodada = (r) => `<tr>
    <td class="mono">${dh(r.inicio)}</td>
    <td class="mono">${dur(r.duracaoMs)}</td>
    <td class="mono">${r.coletadas}/${r.contas}</td>
    <td class="mono">${r.pedidosVistos}</td>
    <td class="mono">${r.escritos}</td>
    <td class="mono ${r.revisao ? "aten" : ""}">${r.revisao}</td>
    <td class="motivo">${r.falhas?.length ? esc(r.falhas.map((f) => `conta ${f.conta}: ${f.erro}`).join(" · ")) : ""}</td>
  </tr>`;

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rastreios — painel</title>
<style>
:root{--g:#f2f3f1;--s:#fbfbfa;--i:#14181a;--m:#5c6563;--a:#0d4f4b;--f:#a8442c;--l:#d6dad3}
@media(prefers-color-scheme:dark){:root{--g:#101413;--s:#171c1b;--i:#e7ebe7;--m:#98a39f;--a:#57b8aa;--f:#e18565;--l:#2a312f}}
*{box-sizing:border-box}
body{margin:0;padding:28px;background:var(--g);color:var(--i);font:15px/1.5 system-ui,-apple-system,sans-serif}
.wrap{max-width:1100px;margin:0 auto}
h1{font-size:1.5rem;margin:0 0 4px;letter-spacing:-.02em}
h2{font-size:1.05rem;margin:32px 0 10px;letter-spacing:-.01em}
.sub{color:var(--m);font-size:.9rem;margin:0 0 20px}
.cartoes{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:1px;background:var(--l);border:1px solid var(--l);border-radius:4px;overflow:hidden}
.cartao{background:var(--s);padding:14px 16px;display:flex;flex-direction:column;gap:3px}
.cartao .n{font-size:1.7rem;font-weight:600;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.cartao .r{font-size:.78rem;color:var(--m)}
.cartao.aten .n{color:var(--f)}
.cartao.bom .n{color:var(--a)}
table{width:100%;border-collapse:collapse;background:var(--s);border:1px solid var(--l);border-radius:4px;overflow:hidden;font-size:.88rem}
th{text-align:left;font-size:.68rem;text-transform:uppercase;letter-spacing:.09em;color:var(--m);padding:9px 12px;border-bottom:1px solid var(--l);white-space:nowrap}
td{padding:10px 12px;border-bottom:1px solid var(--l);vertical-align:top}
tr:last-child td{border-bottom:none}
.mono{font-family:ui-monospace,Menlo,monospace;font-size:.84rem;font-variant-numeric:tabular-nums;white-space:nowrap}
.motivo{color:var(--m);font-size:.84rem}
.aten{color:var(--f)}
.vazio{color:var(--m);font-size:.9rem;padding:14px 0}
button{font:inherit;font-size:.82rem;padding:5px 11px;border:1px solid var(--l);background:var(--g);color:var(--i);border-radius:3px;cursor:pointer}
button:hover{border-color:var(--m)}
button.primario{background:var(--a);color:#fff;border-color:var(--a);font-size:.9rem;padding:8px 16px}
.barra{display:flex;gap:10px;align-items:center;margin:18px 0 0;flex-wrap:wrap}
.alerta{background:var(--f);color:#fff;padding:11px 15px;border-radius:4px;margin:16px 0;font-size:.9rem}
.rodando{background:var(--a);color:#fff;padding:11px 15px;border-radius:4px;margin:16px 0;font-size:.9rem}
.scroll{overflow-x:auto}
</style></head><body><div class="wrap">
<h1>Rastreios Shopee → Shopify</h1>
<p class="sub">Última rodada: ${ultima ? dh(ultima.inicio) + " · " + dur(ultima.duracaoMs) : "nenhuma ainda"}</p>

${rodando ? `<div class="rodando">Rodada em andamento…</div>` : ""}
${problema && !rodando ? `<div class="alerta">A última rodada teve problema: ${ultima.coletadas === 0 ? "nenhuma conta respondeu" : `${ultima.falhas.length} conta(s) falharam`}.</div>` : ""}

<div class="cartoes">
  ${cartao(emRevisao.length, "precisam de revisão", emRevisao.length ? "aten" : "")}
  ${cartao(aguardando.length, "aguardando despacho")}
  ${cartao(prontos.length, "escritos na Shopify", prontos.length ? "bom" : "")}
  ${cartao(pedidos.length, "pedidos conhecidos")}
</div>

<div class="barra">
  <form method="POST" action="/rodar"><button class="primario" ${rodando ? "disabled" : ""}>Rodar agora</button></form>
  <span class="motivo">a página atualiza sozinha a cada 10s</span>
</div>

<h2>Precisam de revisão</h2>
${emRevisao.length ? `<div class="scroll"><table>
<tr><th>Pedido Shopee</th><th>Nome</th><th>CEP</th><th>Rastreio</th><th>Motivo</th><th></th></tr>
${emRevisao.map(linhaRevisao).join("")}</table></div>`
: `<p class="vazio">Nada pendente — nenhum pedido ficou em dúvida.</p>`}

<h2>Rodadas</h2>
${rodadas.length ? `<div class="scroll"><table>
<tr><th>Quando</th><th>Duração</th><th>Contas</th><th>Pedidos</th><th>Escritos</th><th>Revisão</th><th>Falhas</th></tr>
${rodadas.slice(0, 15).map(linhaRodada).join("")}</table></div>`
: `<p class="vazio">Nenhuma rodada registrada.</p>`}

<script>setTimeout(()=>location.reload(),10000)</script>
</div></body></html>`;
}

export function iniciarPainel({ porta = 4000, aoRodar } = {}) {
  let rodando = false;

  const servidor = createServer(async (req, res) => {
    const html = (c) => { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(c); };
    const voltar = () => { res.statusCode = 303; res.setHeader("Location", "/"); res.end(); };

    if (req.method === "POST" && req.url === "/rodar") {
      if (!rodando && aoRodar) {
        rodando = true;
        aoRodar().catch(() => {}).finally(() => { rodando = false; });
      }
      return voltar();
    }

    if (req.method === "POST" && req.url === "/resolver") {
      let b = ""; req.on("data", (c) => (b += c));
      return req.on("end", async () => {
        const id = new URLSearchParams(b).get("orderId");
        const { carregar: ler, salvar: grav } = await import("./estado.mjs");
        const e = ler();
        if (e[id]) { e[id].revisao = null; e[id].dispensadoEm = new Date().toISOString(); grav(e); }
        voltar();
      });
    }

    html(pagina({ estado: carregar(), rodadas: historico(), rodando }));
  });

  return new Promise((r) => servidor.listen(porta, "127.0.0.1", () => r({ porta })));
}
