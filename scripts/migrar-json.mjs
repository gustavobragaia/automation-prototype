// Leva estado/pedidos.json e estado/rodadas.json para o SQLite.
// Idempotente: rodar duas vezes não duplica (upsert por chave).
//
//   node scripts/migrar-json.mjs [--apagar-json]

import { existsSync, readFileSync, renameSync } from "node:fs";
import { db, gravarPedido } from "../src/estado.mjs";

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const info = (m) => console.log(`    ${m}`);

const banco = db({ aoLog: info });

let pedidos = 0;
if (existsSync("estado/pedidos.json")) {
  const antes = JSON.parse(readFileSync("estado/pedidos.json", "utf8"));
  banco.transaction(() => {
    for (const p of Object.values(antes)) { gravarPedido(p); pedidos++; }
  })();
  ok(`${pedidos} pedido(s) migrados`);
} else info("estado/pedidos.json não existe");

let rodadas = 0;
if (existsSync("estado/rodadas.json")) {
  const antes = JSON.parse(readFileSync("estado/rodadas.json", "utf8"));
  const st = banco.prepare(`
    INSERT INTO rodadas (inicio, duracao_ms, contas, coletadas, pedidos_vistos, novos, escritos, revisao, falhas, planilha)
    VALUES (@inicio, @duracao_ms, @contas, @coletadas, @pedidos_vistos, @novos, @escritos, @revisao, @falhas, @planilha)`);
  banco.transaction(() => {
    for (const r of antes.slice().reverse()) {   // mais antiga primeiro, id cresce com o tempo
      st.run({
        inicio: r.inicio, duracao_ms: r.duracaoMs ?? null, contas: r.contas ?? null,
        coletadas: r.coletadas ?? null, pedidos_vistos: r.pedidosVistos ?? null,
        novos: r.novos ?? null, escritos: r.escritos ?? null, revisao: r.revisao ?? null,
        falhas: JSON.stringify(r.falhas ?? []), planilha: r.planilha ?? null,
      });
      rodadas++;
    }
  })();
  ok(`${rodadas} rodada(s) migradas`);
} else info("estado/rodadas.json não existe");

// Mapeamento que já se conhece: pedido Shopify ↔ conta, vindo das coletas.
const mapeados = banco.prepare(`
  INSERT INTO mapeamento (pedido_shopify, conta, origem, criado_em)
  SELECT pedido_shopify, conta, 'coleta', coalesce(primeiro_visto_em, datetime('now'))
    FROM pedidos
   WHERE pedido_shopify IS NOT NULL AND conta IS NOT NULL
  ON CONFLICT(pedido_shopify) DO NOTHING`).run();
ok(`${mapeados.changes} mapeamento(s) derivados dos pedidos já coletados`);

if (process.argv.includes("--apagar-json")) {
  for (const f of ["estado/pedidos.json", "estado/rodadas.json"])
    if (existsSync(f)) { renameSync(f, `${f}.migrado`); info(`${f} → ${f}.migrado`); }
} else info("JSON preservado; use --apagar-json para renomear depois de conferir");

console.log(`\n  banco: ${banco.prepare("select count(*) c from pedidos").get().c} pedidos · ` +
            `${banco.prepare("select count(*) c from rodadas").get().c} rodadas · ` +
            `${banco.prepare("select count(*) c from mapeamento").get().c} mapeamentos`);
