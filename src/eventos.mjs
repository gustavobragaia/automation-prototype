// O que está acontecendo agora, para a tela desenhar.
//
// Não é o log. O log é texto para uma pessoa ler depois; isto é um punhado
// de fatos com nome fixo para a tela pintar enquanto a rodada corre. Tentar
// extrair um do outro foi a alternativa considerada e descartada: a tela
// quebraria na primeira vez que alguém reescrevesse uma frase do log.
//
// O vocabulário é fechado de propósito. Emitir um tipo que não está aqui
// estoura em desenvolvimento, em vez de virar um evento que a tela ignora
// em silêncio — que é exatamente o bug difícil de achar.
//
// Um barramento de módulo, e não um callback passado de mão em mão, porque
// quem mais sabe da conta é o coletor, que sobe uma vez quando o app abre e
// não conhece a rodada que começou depois.

export const TIPOS = new Set([
  "rodada:inicio",    // { contas: [{conta, perfil}] }
  "rodada:fim",       // { resumo }
  "conta:abrindo",    // { conta }  — mandando o AdsPower abrir o perfil
  "conta:aberta",     // { conta, perfil, porta }
  "conta:logando",    // { conta }  — a sessão morreu, o robô vai entrar
  "conta:humano",     // { conta, motivo } — parou, precisa de uma pessoa
  "conta:lendo",      // { conta }  — já dentro, lendo os pedidos
  "conta:feita",      // { conta, pedidos, segundos, precisouLogin }
  "conta:falhou",     // { conta, erro, tentativas, natureza }
  "conta:repetindo",  // { conta, tentativa, de, motivo } — voltou para o fim da fila
  "conta:adiada",     // { conta, ate, motivo } — o freio dos logins não deixou logar agora
  "links:progresso",  // { feitos, total, corrigidos, falhas } — corrigindo o link dos pedidos já escritos
  "freio:ligado",     // { ate } — os e-mails da Shopee pararam de chegar; logins pausados
  "escrita:progresso", // { fase: "conferindo"|"escrevendo", feitos, total, escritos, falhas }
  "alerta:novo",      // { alerta, novo } — src/alertas.mjs
  "alerta:resolvido", // { id }
]);

const ouvintes = new Set();

export function aoEvento(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);   // devolve como desinscrever
}

export function emitir(tipo, dados = {}) {
  if (!TIPOS.has(tipo)) throw new Error(`evento desconhecido: ${tipo}`);
  const e = { tipo, em: Date.now(), ...dados };
  // Um ouvinte que estoura não pode derrubar a rodada: a tela é enfeite,
  // a coleta é o trabalho.
  for (const fn of ouvintes) { try { fn(e); } catch {} }
  return e;
}

export function limparOuvintes() { ouvintes.clear(); }   // só para os testes
