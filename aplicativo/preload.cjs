// A superfície que a tela enxerga. Três funções, e nada de Node.
//
// É CommonJS de propósito: preload com sandbox ligado não carrega ESM.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("esteira", {
  /** Pede uma ação da lista fechada em ponte.mjs. */
  pedir: (acao, carga) => ipcRenderer.invoke("ponte", acao, carga),
  logs: () => ipcRenderer.invoke("logs"),
  avisar: (titulo, corpo) => ipcRenderer.invoke("avisar", { titulo, corpo }),
  escolherPlanilha: () => ipcRenderer.invoke("escolher-planilha"),
  /** Log ao vivo da rodada. Devolve a função que cancela a escuta. */
  aoLog: (fn) => {
    const ouvir = (_e, linha) => fn(linha);
    ipcRenderer.on("log", ouvir);
    return () => ipcRenderer.removeListener("log", ouvir);
  },
});
