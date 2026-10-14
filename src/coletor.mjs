// Coletor: recebe o que a extensão lê dentro do perfil. Pode rodar
// sozinho (coletor.mjs) ou embutido na rodada (start.mjs).

import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";

export function iniciarColetor({ porta = 3000, aoLog = () => {} } = {}) {
  mkdirSync("captura/coletas", { recursive: true });

  const servidor = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.end();
    if (req.method !== "POST") { res.statusCode = 405; return res.end(); }

    let bruto = "";
    req.on("data", (c) => (bruto += c));
    req.on("end", () => {
      res.end('{"ok":true}');
      let m; try { m = JSON.parse(bruto); } catch { return; }
      // O coletor nunca pode cair: processo morto vira "nenhum pedido
      // novo" silencioso, que é o pior resultado possível.
      try {
        if (m.tipo === "ping") return;
        if (m.tipo === "coleta") {
          const conta = m.conta ?? "sem-conta";
          writeFileSync(`captura/coletas/conta-${conta}.json`, JSON.stringify(m, null, 2));
          aoLog(`conta ${conta}: ${(m.pedidos ?? []).length} pedido(s) em ${m.duracaoMs} ms`);
        }
      } catch (e) {
        aoLog(`erro ao tratar payload: ${e.message}`);
      }
    });
  });

  return new Promise((resolve) => {
    servidor.listen(porta, "127.0.0.1", () => resolve({
      porta,
      fechar: () => new Promise((r) => servidor.close(r)),
    }));
  });
}
