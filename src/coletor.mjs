// Coletor: recebe o que a extensão lê dentro do perfil. Pode rodar
// sozinho (coletor.mjs) ou embutido na rodada (start.mjs).

import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { tokenValido, credencialDaConta } from "./credenciais.mjs";
import { obterCodigo } from "./otp.mjs";

export function iniciarColetor({ porta = 3000, aoLog = () => {} } = {}) {
  mkdirSync("captura/coletas", { recursive: true });

  const servidor = createServer(async (req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");

    // ── rotas sensíveis: nunca respondem a uma página web ─────────────
    // O service worker da extensão não manda Origin de site; uma página
    // manda. É o que separa "nossa extensão" de "qualquer aba aberta".
    if (u.pathname === "/credencial" || u.pathname === "/otp") {
      const origem = req.headers.origin ?? "";
      const negar = (motivo) => { res.statusCode = 403; res.end(JSON.stringify({ erro: motivo })); };
      if (/^https?:\/\//i.test(origem)) return negar("origem de site não é aceita aqui");
      if (!tokenValido(u.searchParams.get("token"))) return negar("token inválido");

      res.setHeader("Content-Type", "application/json");
      const conta = u.searchParams.get("conta");
      try {
        if (u.pathname === "/credencial") {
          const c = credencialDaConta(conta);
          aoLog(`conta ${conta}: credencial entregue à extensão`);
          return res.end(JSON.stringify(c));
        }
        // OTP: a chave da API de e-mail fica aqui, nunca no navegador.
        const desde = Number(u.searchParams.get("desde") || 0);
        aoLog(`conta ${conta}: buscando código de verificação no e-mail`);
        const r = await obterCodigo(credencialDaConta(conta).email, desde);
        aoLog(`conta ${conta}: código obtido em ${r.tentativas} tentativa(s)`);
        return res.end(JSON.stringify({ codigo: r.codigo }));
      } catch (e) {
        res.statusCode = 500;
        return res.end(JSON.stringify({ erro: e.message }));
      }
    }

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
