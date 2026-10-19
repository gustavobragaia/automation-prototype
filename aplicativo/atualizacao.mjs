// Atualização automática — só no Windows.
//
// Por que só lá: no macOS o Electron só se atualiza sozinho com o app
// assinado por um Apple Developer ID, que o Esteira ainda não tem. No
// Windows, o instalador NSIS sem assinatura se atualiza normalmente.
//
// O que faz: ao abrir (e de 4 em 4 horas) pergunta à página de versões do
// GitHub (gustavobragaia/esteira-releases, o `publish` do package.json) se
// há versão nova; havendo, baixa em segundo plano. A tela mostra "versão X
// pronta — Reiniciar e atualizar". Nunca reinicia sozinho no meio do
// trabalho: ou a pessoa clica (e é recusado se houver rodada em curso), ou a
// versão nova entra quando o Esteira for fechado.
//
// ESTEIRA_ATUALIZACAO_URL troca a origem por uma pasta servida por HTTP
// (formato "generic" do electron-updater). Existe para o teste do CI provar
// o ciclo inteiro sem publicar nada no GitHub.
import { app } from "electron";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DE_4_EM_4_HORAS = 4 * 60 * 60 * 1000;

export function ligarAtualizacao({ enviar = () => {}, registrar = () => {}, rodadaEmCurso = async () => false } = {}) {
  let estado = { estado: "inativa" };
  const mudar = (novo) => { estado = { ...novo, atual: app.getVersion() }; enviar(estado); };

  if (process.platform !== "win32" || !app.isPackaged) {
    mudar({ estado: "inativa", motivo: process.platform !== "win32" ? "só no Windows" : "em desenvolvimento" });
    return { estado: () => estado, reiniciar: async () => ({ ok: false, erro: "atualização automática desligada aqui" }) };
  }

  // O electron-updater vai montado num arquivo só (empacotar/montar-vendor):
  // o pacote do app não leva node_modules.
  const arquivo = fileURLToPath(new URL("./vendor/atualizador.cjs", import.meta.url));
  if (!existsSync(arquivo)) {
    registrar("atualização: o atualizador não foi empacotado");
    mudar({ estado: "inativa", motivo: "atualizador ausente" });
    return { estado: () => estado, reiniciar: async () => ({ ok: false, erro: "atualizador ausente" }) };
  }
  const { autoUpdater } = createRequire(import.meta.url)(arquivo);

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;   // fechou o app, a versão baixada entra
  autoUpdater.logger = { info: () => {}, warn: (m) => registrar(`atualização: ${m}`),
                         error: (m) => registrar(`atualização: ${m}`), debug: () => {} };
  if (process.env.ESTEIRA_ATUALIZACAO_URL)
    autoUpdater.setFeedURL({ provider: "generic", url: process.env.ESTEIRA_ATUALIZACAO_URL });

  autoUpdater.on("update-available", (i) => mudar({ estado: "baixando", versao: i.version, porcento: 0 }));
  autoUpdater.on("download-progress", (p) =>
    mudar({ estado: "baixando", versao: estado.versao, porcento: Math.round(p.percent ?? 0) }));
  autoUpdater.on("update-downloaded", (i) => {
    registrar(`atualização: versão ${i.version} baixada — entra ao reiniciar`);
    mudar({ estado: "pronta", versao: i.version });
  });
  // Sem internet ou GitHub fora do ar não é assunto para a tela: tenta de novo depois.
  autoUpdater.on("error", (e) => {
    registrar(`atualização: ${e?.message ?? e}`);
    if (estado.estado !== "pronta") mudar({ estado: "inativa", motivo: "falhou a última verificação" });
  });

  const verificar = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(verificar, 5_000).unref?.();
  setInterval(verificar, DE_4_EM_4_HORAS).unref?.();

  return {
    estado: () => estado,
    async reiniciar() {
      if (estado.estado !== "pronta") return { ok: false, erro: "nenhuma versão nova baixada ainda" };
      if (await rodadaEmCurso())
        return { ok: false, erro: "há uma rodada em andamento — espere terminar para atualizar" };
      registrar(`atualização: reiniciando para a versão ${estado.versao}`);
      // silencioso (o NSIS não pergunta nada) e reabre o Esteira no fim
      setImmediate(() => autoUpdater.quitAndInstall(true, true));
      return { ok: true };
    },
  };
}
