// Prova que json e sqlite cumprem o MESMO contrato. É o que garante que
// trocar de fase seja uma variável de ambiente, e não uma reescrita.
//
//   node scripts/testar-armazenamento.mjs

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ok = (m) => console.log(`    \x1b[32m✓\x1b[0m ${m}`);
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const checar = (c, m) => { if (!c) { console.error(`    \x1b[31m✗ ${m}\x1b[0m`); process.exit(1); } ok(m); };

async function exercitar(nomeImpl, mod) {
  sec(`armazenamento: ${nomeImpl}`);
  checar(mod.nome === nomeImpl, `se identifica como "${nomeImpl}"`);

  // pedidos
  let e = mod.carregar();
  checar(Object.keys(e).length === 0, "começa vazio");

  mod.registrar(e, 231, {
    orderId: "A1", nome: "Maria Souza", cep: "13424165", valor: 4.31,
    produto: "cílios", codigos: [], despachado: false,
  });
  mod.salvar(e);
  e = mod.carregar();
  checar(e.A1?.nome === "Maria Souza", "grava e lê um pedido");
  checar(e.A1.conta === 231, "guarda a conta");
  checar(e.A1.enviadoShopify === false, "nasce como não enviado");
  const nascimento = e.A1.primeiroVistoEm;

  // registrar de novo não pode reescrever o primeiro avistamento
  await new Promise((r) => setTimeout(r, 15));
  mod.registrar(e, 231, { orderId: "A1", nome: "Maria Souza", codigos: ["BR269999999999S"], despachado: true });
  mod.salvar(e);
  e = mod.carregar();
  checar(e.A1.primeiroVistoEm === nascimento, "preserva o primeiro avistamento");
  checar(e.A1.despachado === true, "atualiza o despacho");
  checar(e.A1.codigos[0] === "BR269999999999S", "guarda o código");

  checar(mod.pendentesDeEnvio(e).length === 1, "lista pendente de envio");
  checar(mod.aEscrever().length === 1, "aEscrever() concorda com pendentesDeEnvio()");
  checar(mod.pedido("A1")?.nome === "Maria Souza", "lê um pedido por id");
  checar(mod.pedido("NAO-EXISTE") === null, "pedido inexistente devolve null");

  // revisão
  e.A1.revisao = { motivo: "homônimo", em: new Date().toISOString() };
  mod.salvar(e);
  checar(mod.emRevisao().length === 1, "lista o que está em revisão");
  e.A1.revisao = null;
  mod.salvar(e);
  checar(mod.emRevisao().length === 0, "sai da revisão quando dispensado");

  // mapeamento
  checar(mod.contaDoPedido("#1001") === null, "sem mapeamento ainda");
  mod.anotarMapeamento("#1001", 231, "planilha");
  checar(mod.contaDoPedido("#1001")?.conta === 231, "anota e lê o mapeamento");
  mod.anotarMapeamento("#1001", 232, "coleta");
  checar(mod.contaDoPedido("#1001")?.conta === 232, "o mapeamento mais novo vence");
  mod.anotarMapeamento("#1002", 68, "planilha");
  const cob = mod.coberturaMapeamento();
  checar(cob.total === 2, "cobertura conta o total");
  checar(cob.porOrigem.coleta === 1 && cob.porOrigem.planilha === 1, "cobertura separa por origem");

  // rodadas
  checar(mod.historico().length === 0, "histórico começa vazio");
  mod.registrarRodada({ inicio: "2026-10-15T09:00:00Z", duracaoMs: 1000, contas: 3, coletadas: 3,
    pedidosVistos: 5, novos: 2, escritos: 1, revisao: 0, falhas: [] });
  mod.registrarRodada({ inicio: "2026-10-15T14:00:00Z", duracaoMs: 2000, contas: 3, coletadas: 2,
    pedidosVistos: 4, novos: 0, escritos: 0, revisao: 1,
    falhas: [{ conta: 68, erro: "nada chegou" }] });
  const h = mod.historico();
  checar(h.length === 2, "guarda as rodadas");
  checar(h[0].inicio === "2026-10-15T14:00:00Z", "mais recente primeiro");
  checar(h[0].falhas[0]?.conta === 68, "preserva as falhas da rodada");

  // motivos — a história de por que um pedido ficou sem rastreio
  const id1 = mod.registrarRodada({ inicio: "2026-10-16T09:00:00Z", contas: 1, falhas: [] });
  checar(Number.isFinite(id1), "registrarRodada devolve o id da rodada");

  checar(mod.motivosDoPedido("#164891").length === 0, "pedido sem histórico começa vazio");
  checar(mod.gravarMotivos([], { rodadaId: id1 }) === 0, "lista vazia não grava nada");

  mod.gravarMotivos([
    { pedido: "#164891", conta: 124, motivo: { codigo: "sem-rastreio-ainda", grupo: "sozinho" } },
    { pedido: "#165091", conta: 152, motivo: { codigo: "nao-achado-na-conta", grupo: "precisa",
                                               sugestoes: [{ conta: 161 }] } },
  ], { rodadaId: id1, em: "2026-10-16T09:05:00Z" });

  const id2 = mod.registrarRodada({ inicio: "2026-10-17T09:00:00Z", contas: 1, falhas: [] });
  checar(id2 !== id1, "cada rodada tem id próprio");
  mod.gravarMotivos([
    { pedido: "#164891", conta: 124, motivo: { codigo: "nao-achado-na-conta", grupo: "precisa" } },
  ], { rodadaId: id2, em: "2026-10-17T09:05:00Z" });

  const hist = mod.motivosDoPedido("#164891");
  checar(hist.length === 2, "o mesmo pedido acumula um motivo por rodada");
  checar(hist[0].motivo === "sem-rastreio-ainda" && hist[1].motivo === "nao-achado-na-conta",
         "e a sequência fica em ordem — é ela que conta a história");
  checar(hist[0].grupo === "sozinho" && hist[1].grupo === "precisa", "o grupo vem junto");

  const daRodada = mod.motivosDaRodada(id1);
  checar(daRodada.length === 2, "dá para listar tudo o que pendurou numa rodada");
  const achado = daRodada.find((m) => m.pedidoShopify === "#165091");
  checar(achado.conta === 152, "a conta é preservada");
  // defensivo de propósito: detalhe perdido tem que virar ✗ legível, não
  // um stack trace no meio da suíte
  const det = (() => { try { return JSON.parse(achado.detalhe ?? "null"); } catch { return null; } })();
  checar(det?.sugestoes?.[0] === 161, "o detalhe guarda a sugestão de conta");
  checar(mod.motivosDoPedido("#999999").length === 0, "pedido que nunca penou não inventa histórico");

  mod.fechar();
}

const base = mkdtempSync(join(tmpdir(), "arm-"));
try {
  process.env.ESTADO_PEDIDOS = join(base, "pedidos.json");
  process.env.ESTADO_RODADAS = join(base, "rodadas.json");
  process.env.ESTADO_MAPA = join(base, "mapa.json");
  process.env.ESTADO_MOTIVOS = join(base, "motivos.json");
  await exercitar("json", await import("../src/armazenamento/json.mjs"));

  let temSqlite = true;
  try { await import("better-sqlite3"); } catch { temSqlite = false; }
  if (!temSqlite) {
    console.log("\n  \x1b[33m!\x1b[0m better-sqlite3 não instalado — pulando (é opcional na fase 1)");
  } else {
    process.env.DB_CAMINHO = join(base, "dados.sqlite");
    await exercitar("sqlite", await import("../src/armazenamento/sqlite.mjs"));
  }
  console.log("\n\x1b[32m\x1b[1m  mesmo contrato nos dois\x1b[0m\n");
} finally {
  rmSync(base, { recursive: true, force: true });
}
