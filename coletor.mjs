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

    const hora = new Date().toLocaleTimeString("pt-BR");
    if (m.tipo === "tela") {
      console.log(`\x1b[36m[${hora}] tela\x1b[0m ${m.texto.length} chars`);
      writeFileSync("captura/extensao-tela.txt", m.texto);
      console.log(m.texto.slice(0, 500).split("\n").map((l) => "   " + l).join("\n"));
      return;
    }

    const rota = String(m.url ?? "").split("?")[0];
    const arq = `captura/ext-${String(++n).padStart(2, "0")}.json`;
    writeFileSync(arq, JSON.stringify(m.corpo, null, 2));
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
  });
}).listen(PORTA, "127.0.0.1", () =>
  console.log(`coletor ouvindo em http://127.0.0.1:${PORTA}  —  abra a tela de compras no perfil\n`));
