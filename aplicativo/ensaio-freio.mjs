// O freio dos logins na janela de verdade: a fila de verdade rodando, o
// coletor (por HTTP) recebendo dois "e-mail não chegou", e a tela mostrando
// o alerta e as contas com "login pausado".
//
//   npm run ensaio:freio          (ESTEIRA_FOTO=<pasta> grava os prints)
import { app, BrowserWindow } from "electron";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "esteira-freio-"));
mkdirSync(join(dir, "estado"), { recursive: true });
process.env.ESTADO_DIR = join(dir, "estado"); process.env.TRABALHO_DIR = dir;
process.env.RECURSOS_DIR = join(import.meta.dirname, "..");
process.env.SHOPEE_SENHA = "s"; process.env.SHOPEE_PREFIXO = "chompspee"; process.env.SHOPEE_EMAIL_DOMINIO = "givmail.com";
writeFileSync(join(dir, "estado", "ajustes.json"), JSON.stringify({ guiaConcluido: true }));
app.setPath("userData", join(dir, "dados-electron"));

await import("./principal.mjs");
const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const FOTO = process.env.ESTEIRA_FOTO;
let tudo = true;

app.whenReady().then(async () => {
  await espera(3500);
  const w = BrowserWindow.getAllWindows()[0];
  w.setSize(1280, 860);
  const js = (c) => w.webContents.executeJavaScript(c);
  const foto = async (nome) => { if (FOTO) { w.show(); w.focus(); w.webContents.invalidate(); await espera(800); await writeFile(join(FOTO, nome), (await w.webContents.capturePage()).toPNG()); } };

  const { iniciarColetor } = await import("../src/coletor.mjs");
  const { rodarFila } = await import("../src/fila.mjs");
  const { emitir } = await import("../src/eventos.mjs");
  const coletor = await iniciarColetor({ porta: 3951 });
  const evento = (m) => fetch("http://127.0.0.1:3951/", { method: "POST", body: JSON.stringify(m) });
  const NAO = (c) => `o e-mail de verificação da Shopee não chegou (pedido às 19:5${c % 10}, reenviado às 19:5${c % 10}, desistiu às 20:0${c % 10}) — o e-mail com o link de verificação não chegou em 180 s`;

  // a rodada: 5 contas; 222 e 223 precisam de login e o e-mail não chega;
  // 224 e 225 também precisariam — pegam o freio; 120 tem sessão viva
  const contas = [120, 222, 223, 224, 225];
  await js(`document.querySelector('[data-etapa="2"]').click(); 1`);
  emitir("rodada:inicio", { contas: contas.map((conta) => ({ conta, perfil: 300 + conta })) });
  let freado = false;
  const processar = async (c) => {
    emitir("conta:abrindo", { conta: c.conta });
    await espera(150);
    if (c.conta === 120) { emitir("conta:feita", { conta: 120, pedidos: 7, segundos: 22, precisouLogin: false }); return join(dir, "x.json"); }
    if (!freado && (c.conta === 222 || c.conta === 223)) {
      emitir("conta:logando", { conta: c.conta });
      await evento({ tipo: "login-falhou", conta: String(c.conta), motivo: NAO(c.conta) });
      await espera(100);
      freado = c.conta === 223;
      throw new Error(`conta ${c.conta}: o login automático falhou — ${NAO(c.conta)}`);
    }
    // com o freio puxado, o coletor recusa a vez: é o que o login.js recebe
    const { podeLogar } = await import("../src/freio-email.mjs");
    const f = podeLogar(c.conta);
    if (!f.ok) throw Object.assign(new Error(`conta ${c.conta}: login adiado — ${f.motivo}`), { adiarAte: f.ate });
    return join(dir, "x.json");
  };
  const rodada = rodarFila(contas.map((conta) => ({ conta, serial: conta })), { concorrencia: 1, pausaMin: 0, pausaMax: 0, processar });
  await espera(2500);

  console.log("\n\x1b[1mFreio dos logins na janela\x1b[0m");
  const linhas = await js(`[...document.querySelectorAll("table tr")].map(t => t.innerText.replace(/\\s+/g, " ")).filter(t => /Shopee \\d/.test(t)).join(" || ")`);
  tudo &= ok(/Shopee 224.*login pausado · volta às \d\d:\d\d/.test(linhas) && /Shopee 225.*login pausado/.test(linhas),
    "224 e 225 aparecem como \"login pausado · volta às HH:MM\"");
  tudo &= ok(/Shopee 120.*coletada/.test(linhas), "a 120, com sessão viva, foi lida normalmente");
  const chips = await js(`document.getElementById("pcTxt").innerText`);
  tudo &= ok(/com login pausado/.test(chips), `o resumo da coleta conta as pausadas ("${chips.replace(/\s+/g, " ")}")`);
  await foto("3-coleta-login-pausado.png");

  await js(`document.getElementById("bAlertas").click(); 1`);
  await espera(400);
  const alerta = await js(`[...document.querySelectorAll("#listaAlertas .alerta")].map(a => a.innerText).join(" || ")`);
  tudo &= ok(/Os e-mails da Shopee pararam de chegar/.test(alerta) && /pausados até \d\d:\d\d/.test(alerta), "alerta: \"Os e-mails da Shopee pararam de chegar\", com a hora");
  await foto("4-alerta-freio.png");

  // parar: as pausadas viram "não lidas" com "Tentar de novo só essas"
  const { pedirParada } = await import("../src/fila.mjs");
  pedirParada();
  const res = await rodada;
  tudo &= ok(res.filter((x) => !x.ok).map((x) => x.conta).sort().join() === "222,223,224,225",
    "parada pedida: 222 e 223 (e-mail) e 224 e 225 (pausadas) ficam como não lidas, nenhuma some");
  await coletor.fechar();

  console.log(tudo ? "\n\x1b[32m\x1b[1m  freio na janela: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  freio na janela: FALHOU\x1b[0m\n");
  app.exit(tudo ? 0 : 1);
});
