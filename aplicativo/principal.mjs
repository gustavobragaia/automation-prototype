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

// Em desenvolvimento, o .env do projeto vale, e vem primeiro: é como o robô
// já roda pelo terminal. Sem ele a rodada pelo app não consegue logar numa
// conta cuja sessão morreu — a senha da Shopee mora lá.
//
// Nunca no app empacotado: o cliente não tem .env, e ler segredos de uma
// pasta ao lado do app instalado seria convidar problema. Para ele valem os
// Ajustes, e é lá que a senha da Shopee ainda precisa de um campo.
if (!app.isPackaged) {
  try {
    process.loadEnvFile(join(AQUI, "..", ".env"));
    console.log("[esteira] .env do projeto carregado (modo desenvolvimento)");
  } catch { /* não existe, e tudo bem */ }
}

// Onde guardar o que precisa sobreviver a fechar o app: carteira, mapeamento,
// token da loja. Tem que ser decidido ANTES de importar o robô — lá os
// caminhos viram constantes na hora da importação, e import estático sobe pro
// topo do arquivo. Por isso estes dois são dinâmicos, e não lá em cima.
//
// Empacotado, o `cwd` é "/", então o padrão "estado" apontaria pra "/estado":
// o cliente abriria todo dia sem carteira e sem a loja conectada, sem erro
// nenhum na tela. Na pasta do usuário também sobrevive à atualização, que
// troca o app inteiro de lugar.
// RECURSOS: o que veio junto com o app e nunca muda (a extensão, as
// migrações). Empacotado fica em Contents/Resources, fora do asar, porque o
// Chrome não carrega extensão de dentro de um pacote. Em desenvolvimento, a
// raiz do projeto, que é onde essas pastas estão.
const RECURSOS = app.isPackaged ? process.resourcesPath : join(AQUI, "..");

// TRABALHO: o que o robô reescreve a cada rodada (coletas, cópia da
// extensão por conta, planilha gerada). Pode ser apagado sem dó.
// ESTADO: o que não pode ser perdido — carteira, mapeamento, token, ajustes.
const USUARIO = app.getPath("userData");
const TRABALHO = join(USUARIO, "trabalho");
const ESTADO = join(USUARIO, "estado");
for (const d of [TRABALHO, ESTADO]) mkdirSync(d, { recursive: true });

process.env.RECURSOS_DIR ??= RECURSOS;
process.env.TRABALHO_DIR ??= TRABALHO;
process.env.ESTADO_DIR ??= ESTADO;

const { iniciarColetor } = await import("../src/coletor.mjs");
const { construir } = await import("./ponte.mjs");
const { aplicarNoAmbiente } = await import("../src/ajustes.mjs");
aplicarNoAmbiente();   // a chave do AdsPower vira ADSPOWER_API_KEY antes de alguém pedir
const PORTA = Number(process.env.COLETOR_PORTA ?? 3000);
let PORTA_EM_USO = PORTA;

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

// Abrir o app duas vezes era um diálogo de erro do Electron e o segundo
// morria antes da janela: os dois tentam a mesma porta. Agora o segundo
// traz a janela do primeiro para a frente, que é o que a pessoa queria.
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (!janela) return;
  if (janela.isMinimized()) janela.restore();
  janela.focus();
});

// A porta 3000 é a preferida porque é a que o resto do projeto usa, mas ela
// é concorrida — qualquer servidor de desenvolvimento aberto a ocupa. Se
// estiver tomada, vale outra: o endereço de volta da Shopify carrega o
// número da porta, então o caminho inteiro continua fechando.
async function subirColetor() {
  let ultimo;
  for (let p = PORTA; p < PORTA + 10; p++) {
    try {
      const c = await iniciarColetor({ porta: p, aoLog: registrar });
      if (p !== PORTA) registrar(`a porta ${PORTA} estava ocupada — usando a ${p}`);
      PORTA_EM_USO = p;
      return c;
    } catch (e) {
      if (e?.code !== "EADDRINUSE") throw e;
      ultimo = e;
    }
  }
  throw ultimo;
}

app.whenReady().then(async () => {
  try {
    coletor = await subirColetor();
    registrar(`coletor ouvindo em 127.0.0.1:${coletor.porta}`);
    registrar(`recursos em ${process.env.RECURSOS_DIR}`);
    registrar(`trabalho em ${process.env.TRABALHO_DIR}`);
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
    porta: PORTA_EM_USO,
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
