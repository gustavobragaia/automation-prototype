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
//   historico(limite) registrarRodada(r)
//   fechar() nome

const escolhido = (process.env.ARMAZENAMENTO ?? "json").toLowerCase();

const impl = escolhido === "sqlite"
  ? await import("./sqlite.mjs")
  : await import("./json.mjs");

export const {
  carregar, salvar, registrar, pendentesDeEnvio,
  gravarPedido, pedido, emRevisao, aEscrever,
  anotarMapeamento, contaDoPedido, coberturaMapeamento,
  historico, registrarRodada, fechar, nome,
} = impl;
