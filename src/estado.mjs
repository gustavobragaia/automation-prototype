// Estado da operação em arquivo JSON. É a fonte da verdade — a planilha
// é saída, nunca entrada. Garante que um pedido já enviado não seja
// reprocessado, mesmo se a rodada cair no meio.

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";

const ARQ = "estado/pedidos.json";

export function carregar() {
  if (!existsSync(ARQ)) return {};
  try { return JSON.parse(readFileSync(ARQ, "utf8")); } catch { return {}; }
}

export function salvar(estado) {
  mkdirSync("estado", { recursive: true });
  const tmp = `${ARQ}.tmp`;
  writeFileSync(tmp, JSON.stringify(estado, null, 2));
  renameSync(tmp, ARQ); // troca atômica: nunca deixa o arquivo pela metade
}

export function registrar(estado, conta, pedido) {
  const chave = pedido.orderId;
  const antes = estado[chave];
  estado[chave] = {
    ...antes,
    conta,
    orderId: pedido.orderId,
    nome: pedido.nome,
    cep: pedido.cep,
    endereco: pedido.endereco,
    valor: pedido.valor,
    produto: pedido.produto,
    loja: pedido.loja,
    transportadora: pedido.transportadora,
    codigos: pedido.codigos,
    despachado: pedido.despachado,
    vistoEm: new Date().toISOString(),
    primeiroVistoEm: antes?.primeiroVistoEm ?? new Date().toISOString(),
    enviadoShopify: antes?.enviadoShopify ?? false,
  };
  return estado[chave];
}

export const pendentesDeEnvio = (estado) =>
  Object.values(estado).filter((p) => p.despachado && !p.enviadoShopify);
