// Coletor local: recebe o que a extensão lê dentro do perfil do AdsPower.
// Nenhum CDP envolvido — o navegador roda como um navegador comum.
//
//   node coletor.mjs        (fica escutando em 127.0.0.1:3000)

import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";

const PORTA = 3000;
mkdirSync("captura", { recursive: true });
let n = 0;

createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.end();
  if (req.method !== "POST") { res.statusCode = 405; return res.end(); }

  let bruto = "";
  req.on("data", (c) => (bruto += c));
  req.on("end", () => {
    res.end('{"ok":true}');
    let m; try { m = JSON.parse(bruto); } catch { return; }

    // O coletor nunca pode cair: ele é o único ponto por onde a coleta
    // passa, e um processo morto vira "nenhum pedido novo" silencioso.
    try { tratar(m); } catch (e) { console.error(`\x1b[31m[erro ao tratar payload]\x1b[0m ${e.message}`); }
  });
}).listen(PORTA, "127.0.0.1", () =>
  console.log(`coletor ouvindo em http://127.0.0.1:${PORTA}  —  aguardando coletas\n`));

function tratar(m) {

    const hora = new Date().toLocaleTimeString("pt-BR");
    if (m.tipo === "ping") return; // checagem de sanidade da rodada
    if (m.tipo === "coleta") {
      const conta = m.conta ?? "sem-conta";
      console.log(`\x1b[35m[${hora}] COLETA\x1b[0m conta ${conta} · ${(m.pedidos ?? []).length} pedido(s) · ${m.duracaoMs} ms`);
      mkdirSync("captura/coletas", { recursive: true });
      // arquivo por conta: é o sinal que a fila espera para saber que
      // aquela conta terminou
      writeFileSync(`captura/coletas/conta-${conta}.json`, JSON.stringify(m, null, 2));
      writeFileSync("captura/coleta.json", JSON.stringify(m, null, 2));

      console.log("\n  \x1b[1mLISTAS\x1b[0m");
      for (const l of m.listas ?? []) {
        const marca = l.ok ? "\x1b[32m OK \x1b[0m" : l.erro ? "\x1b[31mERR \x1b[0m" : `\x1b[33m${String(l.status).padStart(4)}\x1b[0m`;
        console.log(`  ${marca} tipo=${l.tipo} ${l.caminho.split("?")[0]}`);
        if (l.ok) console.log(`         ${JSON.stringify(l.corpo).length} bytes · chaves: ${Object.keys(l.corpo).slice(0, 8).join(", ")}`);
      }

      console.log(`\n  \x1b[1mPEDIDOS\x1b[0m (${(m.pedidos ?? []).length})`);
      for (const p of m.pedidos ?? []) {
        const tag = p.simulado ? "\x1b[33m[SIMULADO]\x1b[0m" : "\x1b[32m[REAL]\x1b[0m";
        console.log(`   ${tag} order_id=${p.orderId}  ->  ${p.codigos.join(", ") || "(sem código)"}`);
        if (p.camposComRastreio?.length) console.log(`             campo: ${p.camposComRastreio.join(" | ")}`);
        if (p.endpointsOk?.length) console.log(`             endpoints OK: ${p.endpointsOk.join(" ")}`);
      }
      writeFileSync("captura/coleta-tela.txt", m.texto ?? "");
      console.log();
      return;
    }

    if (m.tipo === "sonda") {
      console.log(`\x1b[35m[${hora}] SONDA\x1b[0m ${m.pagina}`);
      writeFileSync("captura/sonda.json", JSON.stringify(m, null, 2));

      const rastreios = (txt) => [...new Set((txt.match(/BR\d{12}[A-Z0-9]|SPX[A-Z]*\d{6,}|[A-Z]{2}\d{9}BR/g) || []))];

      const mostrar = (titulo, itens) => {
        console.log(`\n  \x1b[1m${titulo}\x1b[0m`);
        for (const a of itens) {
          const marca = a.ok ? "\x1b[32m OK \x1b[0m" : a.erro ? "\x1b[31mERR \x1b[0m" : `\x1b[33m${String(a.status).padStart(4)}\x1b[0m`;
          console.log(`  ${marca} ${a.caminho}`);
          if (!a.ok || !a.corpo) continue;
          const txt = JSON.stringify(a.corpo);
          console.log(`         ${txt.length} bytes · chaves: ${Object.keys(a.corpo).slice(0, 10).join(", ")}`);
          const tr = rastreios(txt);
          if (tr.length) console.log(`         \x1b[32mRASTREIO: ${tr.join(", ")}\x1b[0m`);
        }
      };

      mostrar("LISTAS", m.listas ?? []);
      console.log(`\n  \x1b[1mIDS ENCONTRADOS\x1b[0m (${(m.ids ?? []).length})`);
      console.log("   " + (m.ids ?? []).slice(0, 20).join("  ") || "   (nenhum)");
      console.log(`   order_id usado no detalhe: ${m.orderIdUsado ?? "(nenhum)"}`);
      mostrar("DETALHE", m.detalhes ?? []);

      writeFileSync("captura/sonda-tela.txt", m.texto ?? "");
      console.log(`\n  tela: ${(m.texto ?? "").length} chars -> captura/sonda-tela.txt\n`);
      return;
    }

    if (m.tipo === "tela") {
      console.log(`\x1b[36m[${hora}] tela\x1b[0m ${m.texto.length} chars`);
      writeFileSync("captura/extensao-tela.txt", m.texto);
      console.log(m.texto.slice(0, 500).split("\n").map((l) => "   " + l).join("\n"));
      return;
    }

    const rota = String(m.url ?? "(sem url)").split("?")[0];
    const arq = `captura/ext-${String(++n).padStart(2, "0")}.json`;
    writeFileSync(arq, JSON.stringify(m.corpo ?? m, null, 2));
    console.log(`\x1b[32m[${hora}] API\x1b[0m ${rota}`);
    console.log(`   -> ${arq}`);

    // mostra o esqueleto do JSON, que é o que interessa agora
    const forma = (o, p = "", d = 0) => {
      if (d > 2 || o == null) return [];
      if (Array.isArray(o)) return o.length ? forma(o[0], `${p}[0]`, d + 1) : [`${p}: []`];
      if (typeof o === "object")
        return Object.entries(o).flatMap(([k, v]) =>
          typeof v === "object" && v !== null ? forma(v, `${p}.${k}`, d + 1) : [`${p}.${k} = ${JSON.stringify(v).slice(0, 60)}`]);
      return [`${p} = ${JSON.stringify(o).slice(0, 60)}`];
    };
    console.log(forma(m.corpo).slice(0, 25).map((l) => "   " + l).join("\n"));
}
