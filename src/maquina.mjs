// Quanto a máquina do cliente aguenta de navegadores ao mesmo tempo.
//
// Cada perfil do AdsPower é um Chromium inteiro, então a conta é de
// MEMÓRIA, não de CPU. O número sai daqui e vira a recomendação na tela —
// e a tela dizia "lido do computador" antes disto existir.

import { totalmem, cpus, platform, arch } from "node:os";

const GB = 1024 ** 3;

// Medido com perfis da Shopee abertos: cada um fica perto de meio giga.
// É estimativa honesta, não número de fabricante.
export const POR_PERFIL_GB = Number(process.env.RAM_POR_PERFIL_GB ?? 0.5);

// O que fica para o sistema e para o próprio AdsPower, que não é leve.
const RESERVA_GB = Number(process.env.RAM_RESERVA_GB ?? 4);

export const TETO = 10;   // acima disso ninguém testou contra a Shopee

/**
 * O cálculo, separado da leitura para poder ser testado — é aqui que mora
 * a decisão, e sem separar não havia como provar nada.
 */
export function calcular({ ramGB, nucleos }) {
  // O menor dos dois limites manda: memória disponível e metade dos
  // núcleos. Metade porque o Chromium usa mais de um por perfil e deixar
  // a máquina no talo trava a interface de quem está olhando.
  const porMemoria = Math.floor((ramGB - RESERVA_GB) / POR_PERFIL_GB);
  const porCpu = Math.floor(nucleos / 2);
  const recomendado = Math.max(1, Math.min(TETO, porMemoria, porCpu));

  return {
    ramGB: Math.round(ramGB * 10) / 10,
    nucleos,
    recomendado,
    limitadoPor: porMemoria <= porCpu ? "memória" : "núcleos",
  };
}

export function lerMaquina() {
  return {
    ...calcular({ ramGB: totalmem() / GB, nucleos: cpus().length }),
    plataforma: `${platform()} ${arch()}`,
  };
}

/** O que N navegadores custam de memória. */
export const custoGB = (n) => Math.round(n * POR_PERFIL_GB * 10) / 10;
