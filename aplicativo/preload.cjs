// A superfície que a tela enxerga. Meia dúzia de funções, e nada de Node.
//
// É CommonJS de propósito: preload com sandbox ligado não carrega ESM.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("esteira", {
  /** A tela precisa saber: no macOS a barra de título fica escondida, e os
   *  três botões do sistema caem em cima do cabeçalho se ela não abrir
   *  espaço. Só o nome da plataforma, nada mais do processo. */
  plataforma: process.platform,
  /** Pede uma ação da lista fechada em ponte.mjs. */
  pedir: (acao, carga) => ipcRenderer.invoke("ponte", acao, carga),
  logs: () => ipcRenderer.invoke("logs"),
  avisar: (titulo, corpo) => ipcRenderer.invoke("avisar", { titulo, corpo }),
  escolherPlanilha: () => ipcRenderer.invoke("escolher-planilha"),
  /** O que está acontecendo agora, com nome fixo. Devolve como cancelar. */
  aoEvento: (fn) => {
    const ouvir = (_e, evento) => fn(evento);
    ipcRenderer.on("evento", ouvir);
    return () => ipcRenderer.removeListener("evento", ouvir);
  },
  /** Log ao vivo da rodada. Devolve a função que cancela a escuta. */
  aoLog: (fn) => {
    const ouvir = (_e, linha) => fn(linha);
    ipcRenderer.on("log", ouvir);
    return () => ipcRenderer.removeListener("log", ouvir);
  },
});
