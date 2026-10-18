// O histórico dia a dia. A aba era inteira inventada — 40 dias gerados por
// sorteio. O que importa aqui: só aparece o que aconteceu, no dia LOCAL em
// que aconteceu, e o que não foi gravado sai como "não sei", não como um
// número plausível.
import { montarDias, diaLocal } from "../src/historico-dias.mjs";

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

sec("sem rodada nenhuma, sem histórico nenhum");
tudo &= ok(montarDias({}).length === 0, "app novo mostra zero dias, não quarenta inventados");

sec("o dia é o do Brasil, não o de Greenwich");
// 22h de 18/10 em São Paulo é 01h de 19/10 em UTC
const noite = new Date(2026, 9, 18, 22, 30);
tudo &= ok(diaLocal(noite) === "2026-10-18", `uma rodada às 22h cai no próprio dia (${diaLocal(noite)})`);

sec("rodadas, escritas e conferência do mesmo dia");
const dias = montarDias({
  agora: new Date(2026, 9, 18, 23, 0),
  rodadas: [
    { id: 1, inicio: new Date(2026, 9, 18, 9, 0).toISOString(), duracaoMs: 240000, contas: 80 },
    { id: 2, inicio: new Date(2026, 9, 18, 14, 0).toISOString(), duracaoMs: 120000, contas: 80 },
    { id: 3, inicio: new Date(2026, 9, 17, 9, 0).toISOString(), duracaoMs: 60000, contas: 3 },
  ],
  escritas: {
    "1001": { pedido: "#1001", conta: 124, codigos: ["BR1"], em: new Date(2026, 9, 18, 9, 5).toISOString() },
    // escrito à mão depois de ter ido para a conferência
    "1002": { pedido: "#1002", conta: 128, codigos: ["BR2"], origem: "manual",
              em: new Date(2026, 9, 18, 15, 0).toISOString() },
  },
  motivosDaRodada: (id) => id === 1
    ? [{ pedidoShopify: "#1002", conta: 128, motivo: "ambiguo", grupo: "precisa",
         em: new Date(2026, 9, 18, 9, 4).toISOString() },
       { pedidoShopify: "#1003", conta: 130, motivo: "nome-nao-confere", grupo: "precisa",
         em: new Date(2026, 9, 18, 9, 4).toISOString() }]
    : [],
});
tudo &= ok(dias.length === 2, `dois dias com movimento (vieram ${dias.length})`);
tudo &= ok(dias[0].iso === "2026-10-18" && dias[0].hoje, "o mais recente primeiro, marcado como hoje");
tudo &= ok(dias[0].rodadas === 2, "as duas rodadas do dia contam");
tudo &= ok(dias[0].contas === 80,
  `rodar duas vezes as mesmas 80 contas são 80 contas, não 160 (deu ${dias[0].contas})`);
tudo &= ok(dias[0].dur === "6 min", `tempo somado das rodadas (${dias[0].dur})`);
tudo &= ok(dias[0].escritos === 2, `dois escritos (${dias[0].escritos})`);

const p1002 = dias[0].pedidos.find((p) => p.p === "#1002");
tudo &= ok(p1002?.s === "escrito",
  "o que foi para a conferência e depois foi escrito aparece como escrito, não como pendente");
tudo &= ok(p1002?.origem === "manual", "e marcado como escrito à mão");
tudo &= ok(dias[0].revisao === 1, `só o #1003 continua na conferência (${dias[0].revisao})`);

sec("o que não é gravado não é inventado");
tudo &= ok(dias[0].semLogin === null, "quantas entraram sem senha: não gravado, então null");
tudo &= ok(dias[0].pedidos.every((p) => p.c === null),
  "nome do cliente: não gravado nas escritas, então null — nada de nome de mentira");

sec("adiar para amanhã não volta às 21h de hoje");
// O bug: hojeISO() usava UTC, então às 21h no Brasil já dizia "amanhã" e o
// pedido adiado reaparecia na mesma noite.
const { diaLocal: dia } = await import("../src/datas.mjs");
const as21 = new Date(2026, 9, 18, 21, 30);
const as23 = new Date(2026, 9, 18, 23, 59);
tudo &= ok(dia(as21) === "2026-10-18", `às 21h30 ainda é dia 18 (${dia(as21)})`);
tudo &= ok(dia(as23) === "2026-10-18", `às 23h59 também (${dia(as23)})`);
tudo &= ok(dia(new Date(2026, 9, 19, 0, 1)) === "2026-10-19", "e à meia-noite e um vira o 19");

console.log(tudo ? "\n\x1b[32m\x1b[1m  histórico só com o que aconteceu\x1b[0m\n"
                 : "\n\x1b[31m\x1b[1m  histórico inventando\x1b[0m\n");
process.exit(tudo ? 0 : 1);
