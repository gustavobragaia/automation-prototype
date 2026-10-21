// "Exportar diagnóstico": um arquivo de texto com o que é preciso para
// entender uma rodada ruim, para o cliente mandar.
//
// Feito para sair da máquina dele: NÃO leva senha nem chave (e confere isso
// no fim, procurando os valores de verdade no texto), nem dado de cliente
// final. Das coletas vai só o resumo — status de cada consulta à Shopee,
// página e duração —, nunca os pedidos (nome, endereço, telefone).
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DIR_COLETAS, DIR_EVENTOS } from "./caminhos.mjs";
import { lerAjustes, SEGREDOS } from "./ajustes.mjs";
import { lerAlertas, alertasResolvidos } from "./alertas.mjs";
import { lerLogs } from "./log-diario.mjs";

const semConsulta = (url) => String(url ?? "").replace(/\?.*$/, "");

function resumoDasColetas() {
  if (!existsSync(DIR_COLETAS)) return [];
  return readdirSync(DIR_COLETAS).filter((f) => f.endsWith(".json")).map((f) => {
    try {
      const d = JSON.parse(readFileSync(join(DIR_COLETAS, f), "utf8"));
      const listas = (d.listas ?? []).map((l) => `${l.tipo}/${l.pagina}:${l.status ?? l.erro ?? "?"}${l.ok ? "" : "✗"}${l.corpo?.error ? ` err ${l.corpo.error}` : ""}`);
      return `conta ${d.conta}: ${(d.pedidos ?? []).length} pedido(s) · ${d.duracaoMs ?? "?"} ms · ${semConsulta(d.pagina)} · listas ${listas.join(" ")}`;
    } catch (e) { return `${f}: ilegível (${e.message})`; }
  });
}

// Os avisos da extensão (login, verificação, coleta-falhou…), sem os corpos:
// "ivs-rede" leva respostas da Shopee e fica de fora.
function eventosRecentes(limite = 400) {
  if (!existsSync(DIR_EVENTOS)) return [];
  return readdirSync(DIR_EVENTOS).filter((f) => f.endsWith(".json") && !/ivs-rede|email-sem-link/.test(f))
    .sort().slice(-limite).map((f) => {
      try {
        const m = JSON.parse(readFileSync(join(DIR_EVENTOS, f), "utf8"));
        return `${new Date(m.em ?? Number(f.split("-")[0])).toISOString()}  conta ${m.conta ?? "?"}  ${m.tipo ?? "?"}` +
          `${m.motivo ? " — " + String(m.motivo).slice(0, 200) : ""}${m.pagina ? " · " + semConsulta(m.pagina) : ""}`;
      } catch { return null; }
    }).filter(Boolean);
}

export function montarDiagnostico({ versao = "?", agora = new Date() } = {}) {
  const ajustes = lerAjustes();
  const ajustesVisiveis = Object.fromEntries(Object.entries(ajustes)
    .map(([k, v]) => [k, SEGREDOS.includes(k) ? (v ? "[guardada]" : "[vazia]") : v]));
  const alerta = (a) => `- [${a.nivel}] ${a.titulo}${a.conta ? ` (conta ${a.conta})` : ""} · ${new Date(a.em).toLocaleString("pt-BR")}` +
    `${a.resolvidoEm ? ` · ${a.comoSaiu} ${new Date(a.resolvidoEm).toLocaleString("pt-BR")}` : ""}\n  ${String(a.texto ?? "").replace(/\n/g, "\n  ")}`;

  let texto = [
    `DIAGNÓSTICO DO ESTEIRA — ${agora.toLocaleString("pt-BR")}`,
    `versão ${versao} · ${process.platform} · node ${process.versions.node}`,
    "",
    "== AJUSTES (sem senha e sem chaves)", JSON.stringify(ajustesVisiveis, null, 2),
    "", "== ALERTAS ATIVOS", ...(lerAlertas().map(alerta)), "",
    "== ALERTAS RESOLVIDOS (7 dias)", ...(alertasResolvidos().map(alerta)), "",
    "== COLETAS (resumo, sem os pedidos)", ...resumoDasColetas(), "",
    "== AVISOS DA EXTENSÃO (últimos)", ...eventosRecentes(), "",
    "== LOG (últimos 3 dias)", lerLogs(3),
  ].join("\n");

  // Defesa em profundidade: se algum segredo de verdade apareceu no texto
  // por qualquer caminho, ele é apagado antes de sair.
  const segredos = [
    ...SEGREDOS.map((k) => ajustes[k]),
    process.env.SHOPEE_SENHA, process.env.RAPIDAPI_KEY, process.env.ADSPOWER_API_KEY,
  ].filter((v) => typeof v === "string" && v.length >= 6);
  for (const v of segredos) texto = texto.split(v).join("[oculto]");
  return texto;
}
