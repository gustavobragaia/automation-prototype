// Onde ficam os arquivos. Três raízes, e cada uma existe por um motivo.
//
// Rodando `node` da raiz do projeto, as três apontam para a mesma pasta e
// tudo funciona como sempre funcionou. Empacotado no Electron elas se
// separam, porque aí cada uma tem uma vida diferente:
//
//   RECURSOS  o que vem junto com o app e nunca muda (a extensão, as
//             migrações). É só leitura, e a pasta do app costuma ser
//             somente-leitura mesmo — no macOS, assinada.
//
//   TRABALHO  o que o robô escreve e reescreve a cada rodada (as coletas,
//             a cópia da extensão por conta, a planilha gerada). Pode ser
//             apagado sem dó: a próxima rodada refaz.
//
//   ESTADO    o que precisa sobreviver a tudo — carteira, mapeamento,
//             token da loja, ajustes. Apagar isto é perder trabalho.
//
// Tudo era relativo ao `cwd`, que empacotado é "/". O app tentaria ler a
// extensão de "/extensao" e escrever em "/captura": a rodada não abriria
// conta nenhuma e terminaria em silêncio, que é o pior resultado possível.
import { join, resolve } from "node:path";

export const RAIZ_RECURSOS = resolve(process.env.RECURSOS_DIR ?? ".");
export const RAIZ_TRABALHO = resolve(process.env.TRABALHO_DIR ?? ".");
export const RAIZ_ESTADO = resolve(process.env.ESTADO_DIR ?? "estado");

export const emRecursos = (nome) => join(RAIZ_RECURSOS, nome);
export const emTrabalho = (nome) => join(RAIZ_TRABALHO, nome);
export const emEstado = (nome) => join(RAIZ_ESTADO, nome);

// As três pastas da captura, nomeadas aqui e em nenhum outro lugar. Elas
// eram string solta em três arquivos: bastava um escrever na raiz nova e
// outro ler na velha para a rodada terminar sem nada, sem erro nenhum.
export const DIR_COLETAS = emTrabalho("captura/coletas");
export const DIR_EVENTOS = emTrabalho("captura/eventos");
export const DIR_LOGIN = emTrabalho("captura/login");

export const coletaDaConta = (conta) => join(DIR_COLETAS, `conta-${conta}.json`);
export const loginDaConta = (conta) => join(DIR_LOGIN, `conta-${conta}.json`);
