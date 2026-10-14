// Rodada automática, sem CDP e sem interação humana.
//
//   1. abre o perfil pela Local API, injetando a extensão via --load-extension
//   2. abre a aba de compras pelo endpoint HTTP do DevTools (não anexa sessão)
//   3. a extensão coleta sozinha e manda para o coletor
//   4. fecha o perfil, sem deslogar
//
//   node --env-file=.env rodada.mjs [serial]

import { resolve } from "node:path";
import { fecharPerfil, statusPerfil } from "./src/adspower.mjs";

const BASE = process.env.ADSPOWER_BASE ?? "http://local.adspower.net:50325";
const KEY = process.env.ADSPOWER_API_KEY ?? "";
const EXT = resolve("extensao");
const serial = Number(process.argv[2] ?? 2);

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const info = (m) => console.log(`    ${m}`);
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (caminho, params = {}) => {
  const u = new URL(caminho, BASE);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(90_000) });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`${j.msg} (code ${j.code})`);
  return j.data;
};

try {
  sec("1. Abrir perfil com a extensão injetada");
  if ((await statusPerfil({ serial })) === "Active") {
    await fecharPerfil({ serial });
    await dormir(3000);
    info("perfil estava aberto; reiniciado para injetar a extensão");
  }
  const d = await api("/api/v1/browser/start", {
    serial_number: serial, open_tabs: 0, ip_tab: 0, cdp_mask: 1,
    launch_args: JSON.stringify([`--load-extension=${EXT}`]),
  });
  const porta = d.debug_port;
  ok(`perfil aberto · porta ${porta}`);
  await dormir(5000);

  // O service worker MV3 fica dormente até o primeiro evento, então a
  // ausência dele não prova nada. Tenta por alguns segundos só para
  // informar; a verificação que vale é o dado chegar no coletor.
  let idExt = null;
  for (let i = 0; i < 8 && !idExt; i++) {
    const alvos = await (await fetch(`http://127.0.0.1:${porta}/json/list`)).json();
    idExt = alvos.find((t) => t.type === "service_worker" && /\/background\.js$/.test(t.url ?? ""))?.url?.split("/")[2];
    if (!idExt) await dormir(2000);
  }
  idExt ? ok(`extensão ativa: ${idExt}`) : info("service worker dormente (normal no MV3) — seguindo");

  sec("2. Abrir a tela de compras (sem anexar CDP)");
  for (const tipo of [7]) {
    const url = encodeURIComponent(`https://shopee.com.br/user/purchase?type=${tipo}`);
    await fetch(`http://127.0.0.1:${porta}/json/new?${url}`, { method: "PUT" });
    ok(`aba aberta em type=${tipo}`);
  }

  sec("3. Aguardando a extensão coletar");
  const { statSync, existsSync } = await import("node:fs");
  const arq = "captura/coleta.json";
  const antes = existsSync(arq) ? statSync(arq).mtimeMs : 0;

  let chegou = false;
  for (let i = 0; i < 30; i++) {
    await dormir(2000);
    if (existsSync(arq) && statSync(arq).mtimeMs > antes) { chegou = true; break; }
    if (i % 5 === 4) info(`aguardando... ${(i + 1) * 2}s`);
  }

  const abas = await (await fetch(`http://127.0.0.1:${porta}/json/list`)).json();
  for (const t of abas.filter((x) => x.type === "page"))
    info(`${JSON.stringify(t.title)}  ${t.url.slice(0, 70)}`);

  if (chegou) ok("coleta recebida pelo coletor local");
  else {
    console.log("  \x1b[31m✗ nada chegou ao coletor\x1b[0m");
    info("causas possíveis: coletor desligado, extensão não injetada, ou a página não carregou");
  }
} finally {
  sec("4. Encerrar");
  try { await fecharPerfil({ serial }); ok("perfil fechado, sem deslogar"); } catch {}
  console.log("\n  Veja o resultado no terminal do coletor.");
}
