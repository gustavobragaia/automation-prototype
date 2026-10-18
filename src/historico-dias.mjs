// O histórico dia a dia, montado só com o que de fato aconteceu.
//
// A aba Histórico era inteira inventada: 40 dias de pedidos gerados por
// sorteio, com nomes de mentira. Dava a impressão de um histórico rico num
// app que ainda não tinha rodado nenhuma vez — e a pessoa não tinha como
// saber que nada daquilo existia.
//
// Três fontes, todas gravadas pelo robô:
//   · as rodadas      -> quantas contas, quanto tempo, quantos pedidos vistos
//   · o registro de escritas -> cada rastreio que a Shopify aceitou, e quando
//   · os motivos      -> cada pedido que ficou para a conferência, e por quê
//
// O que não está gravado em lugar nenhum aparece como null, e a tela mostra
// "—". Inventar um número para preencher a coluna é o defeito que este
// arquivo existe para consertar.

const SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

// O dia local vem de src/datas.mjs — uma rodada das 22h não pode cair no
// dia seguinte. Reexportado para quem já importava daqui.
import { diaLocal } from "./datas.mjs";
export { diaLocal };
const horaLocal = (quando) => {
  const d = new Date(quando);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
};

/**
 * @param {object} fontes
 * @param {Array} fontes.rodadas   historico(): {id, inicio, duracaoMs, contas, ...}
 * @param {Object} fontes.escritas registro: { "1002": {pedido, conta, codigos, em} }
 * @param {Function} fontes.motivosDaRodada  (id) => [{pedidoShopify, conta, motivo}]
 * @param {Date} [fontes.agora]
 */
export function montarDias({ rodadas = [], escritas = {}, motivosDaRodada = () => [], agora = new Date() } = {}) {
  const dias = new Map();
  const dia = (iso) => {
    if (!dias.has(iso)) dias.set(iso, { iso, rodadas: [], pedidos: new Map() });
    return dias.get(iso);
  };

  for (const r of rodadas) {
    const iso = diaLocal(r.inicio);
    if (!iso) continue;
    dia(iso).rodadas.push(r);
    // o que ficou para a conferência naquela rodada
    for (const m of motivosDaRodada(r.id) ?? []) {
      if (!m.pedidoShopify) continue;
      const d = dia(iso);
      // um pedido escrito depois, no mesmo dia, não volta a ser "revisão"
      if (d.pedidos.get(m.pedidoShopify)?.s === "escrito") continue;
      d.pedidos.set(m.pedidoShopify, {
        p: m.pedidoShopify, c: null, ct: m.conta ?? null, r: "",
        s: m.grupo === "sozinho" ? "semcod" : "revisao",
        motivo: m.motivo ?? null, h: horaLocal(m.em ?? r.inicio),
      });
    }
  }

  for (const e of Object.values(escritas)) {
    const iso = diaLocal(e.em);
    if (!iso) continue;
    dia(iso).pedidos.set(e.pedido, {
      p: e.pedido, c: null, ct: e.conta ?? null,
      r: (e.codigos ?? []).join(" - "), s: "escrito",
      origem: e.origem ?? "robô", h: horaLocal(e.em),
    });
  }

  const hoje = diaLocal(agora);
  return [...dias.values()]
    .sort((a, b) => b.iso.localeCompare(a.iso))
    .map((d) => {
      const pedidos = [...d.pedidos.values()].sort((a, b) => a.h.localeCompare(b.h));
      const [a, m, dd] = d.iso.split("-");
      const ms = d.rodadas.reduce((t, r) => t + (r.duracaoMs ?? 0), 0);
      return {
        iso: d.iso, br: `${dd}/${m}/${a}`,
        sem: SEMANA[new Date(+a, +m - 1, +dd).getDay()],
        hoje: d.iso === hoje,
        rodadas: d.rodadas.length,
        pedidos,
        total: pedidos.length,
        escritos: pedidos.filter((x) => x.s === "escrito").length,
        revisao: pedidos.filter((x) => x.s === "revisao").length,
        // a maior rodada do dia, não a soma: rodar duas vezes as mesmas 80
        // contas não são 160 contas
        contas: d.rodadas.length ? Math.max(...d.rodadas.map((r) => r.contas ?? 0)) : null,
        // não é gravado por rodada; inventar seria repetir o erro antigo
        semLogin: null,
        dur: d.rodadas.length ? `${Math.max(1, Math.round(ms / 60000))} min` : null,
      };
    });
}
