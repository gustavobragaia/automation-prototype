// Escolhe onde o estado mora. A aplicação nunca importa json.mjs ou
// sqlite.mjs direto — importa daqui, e a troca é uma variável de ambiente.
//
//   ARMAZENAMENTO=json     (padrão — fase 1)
//   ARMAZENAMENTO=sqlite   (fase 3)
//
// Os dois módulos implementam o mesmo contrato:
//
//   carregar() salvar(estado) registrar(estado, conta, pedido)
//   pendentesDeEnvio(estado)
//   gravarPedido(p) pedido(id) emRevisao() aEscrever()
//   anotarMapeamento(pedidoShopify, conta, origem)
//   contaDoPedido(pedidoShopify) coberturaMapeamento()
//   historico(limite) registrarRodada(r) -> id
//   gravarMotivos(pendencias, {rodadaId}) motivosDoPedido(p) motivosDaRodada(id)
//   guardarPendentes(p) pendentesAbertos() adiarPendente(ped, ate) baixarPendentes(peds)
//   encerrarPendente(ped, {desfecho, nota, conta}) reabrirPendente(ped)
//   fechar() nome

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const escolhido = (process.env.ARMAZENAMENTO ?? "json").toLowerCase();

// O SQLite depende de um módulo nativo (better-sqlite3) que NÃO vai no app
// instalado. Escolhê-lo lá faria o app travar mudo antes de abrir — é como
// o Electron empacotado reage a módulo faltando. Melhor recusar com uma
// frase do que travar sem nenhuma.
if (escolhido === "sqlite" && !existsSync(fileURLToPath(new URL("./sqlite.mjs", import.meta.url))))
  throw new Error("o armazenamento SQLite não está disponível nesta instalação — use o padrão (json)");

const impl = escolhido === "sqlite"
  ? await import("./sqlite.mjs")
  : await import("./json.mjs");

export const {
  carregar, salvar, registrar, pendentesDeEnvio,
  gravarPedido, pedido, emRevisao, aEscrever,
  anotarMapeamento, contaDoPedido, coberturaMapeamento,
  historico, registrarRodada, fechar, nome,
  gravarMotivos, motivosDoPedido, motivosDaRodada,
  guardarPendentes, pendentesAbertos, adiarPendente, baixarPendentes, encerrarPendente,
  reabrirPendente,
} = impl;
