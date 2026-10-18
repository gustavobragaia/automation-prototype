// Processo principal do Electron.
//
// Regras que não se negociam aqui:
//   · a tela NUNCA tem Node, nem rede, nem disco — só a ponte
//   · contextIsolation ligado, nodeIntegration desligado, sandbox ligado
//   · nada de carregar URL externa: a tela é arquivo local
//   · a atualização nunca instala no meio de uma rodada

import { app, BrowserWindow, ipcMain, shell, dialog, Notification } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const AQUI = dirname(fileURLToPath(import.meta.url));

// Onde guardar o que precisa sobreviver a fechar o app: carteira, mapeamento,
// token da loja. Tem que ser decidido ANTES de importar o robô — lá os
// caminhos viram constantes na hora da importação, e import estático sobe pro
// topo do arquivo. Por isso estes dois são dinâmicos, e não lá em cima.
//
// Empacotado, o `cwd` é "/", então o padrão "estado" apontaria pra "/estado":
// o cliente abriria todo dia sem carteira e sem a loja conectada, sem erro
// nenhum na tela. Na pasta do usuário também sobrevive à atualização, que
// troca o app inteiro de lugar.
const ESTADO = join(app.getPath("userData"), "estado");
mkdirSync(ESTADO, { recursive: true });
process.env.ESTADO_DIR ??= ESTADO;

const { iniciarColetor } = await import("../src/coletor.mjs");
const { construir } = await import("./ponte.mjs");
const { aplicarNoAmbiente } = await import("../src/ajustes.mjs");
aplicarNoAmbiente();   // a chave do AdsPower vira ADSPOWER_API_KEY antes de alguém pedir
const PORTA = Number(process.env.COLETOR_PORTA ?? 3000);

let janela = null, coletor = null, ponte = null;
const logs = [];

function registrar(msg) {
  const linha = { em: new Date().toISOString(), msg: String(msg) };
  logs.push(linha);
  // Também no terminal: se a janela não abrir, este é o único lugar onde dá
  // pra ver o que aconteceu — e é justamente aí que a gente mais precisa.
  console.log("[esteira] " + linha.msg);
  if (logs.length > 2000) logs.shift();
  janela?.webContents.send("log", linha);
}

function criarJanela() {
  janela = new BrowserWindow({
    width: 1280, height: 860, minWidth: 920, minHeight: 600,
    title: "Esteira",
    backgroundColor: "#010102",          // evita o lampejo branco ao abrir
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    show: false,
    webPreferences: {
      preload: join(AQUI, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Só mostra quando estiver pronta: janela abrindo vazia parece travada.
  janela.once("ready-to-show", () => janela.show());
  janela.loadFile(join(AQUI, "tela", "index.html"));

  // Link externo abre no navegador do sistema, nunca dentro do app.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  janela.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file://")) { e.preventDefault(); shell.openExternal(url); }
  });

  janela.on("closed", () => { janela = null; });
}

app.whenReady().then(async () => {
  try {
    coletor = await iniciarColetor({ porta: PORTA, aoLog: registrar });
    registrar(`coletor ouvindo em 127.0.0.1:${PORTA}`);
    registrar(`estado em ${process.env.ESTADO_DIR}`);
  } catch (e) {
    registrar(`coletor não subiu: ${e.message}`);
  }

  ponte = construir({
    aoLog: registrar,
    // Vai direto pra janela, sem passar pelo log: é o que pinta a tabela
    // enquanto a rodada corre. `?.` porque o coletor pode emitir depois de
    // a janela ter sido fechada.
    aoEvento: (e) => janela?.webContents.send("evento", e),
    porta: PORTA,
  });

  // Uma porta só, com lista fechada. Nome fora da lista não executa nada.
  ipcMain.handle("ponte", async (_evento, acao, carga) => {
    const fn = Object.prototype.hasOwnProperty.call(ponte, acao) ? ponte[acao] : null;
    if (!fn) return { ok: false, erro: `ação desconhecida: ${acao}` };
    try { return { ok: true, dado: await fn(carga ?? {}) }; }
    catch (e) { return { ok: false, erro: e.message }; }
  });

  ipcMain.handle("logs", async () => logs.slice(-300));

  ipcMain.handle("avisar", async (_e, { titulo, corpo }) => {
    if (!Notification.isSupported()) return false;
    new Notification({ title: String(titulo ?? "Esteira"), body: String(corpo ?? "") }).show();
    return true;
  });

  // O diálogo de arquivo mora aqui: a tela não enxerga o disco.
  ipcMain.handle("escolher-planilha", async () => {
    const r = await dialog.showOpenDialog(janela, {
      title: "Escolher a planilha do dia",
      filters: [{ name: "Planilha", extensions: ["xlsx", "xls", "csv"] }],
      properties: ["openFile", "multiSelections"],
    });
    return r.canceled ? [] : r.filePaths;
  });

  criarJanela();
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) criarJanela(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

app.on("before-quit", async () => {
  try { await coletor?.fechar(); } catch {}
});
