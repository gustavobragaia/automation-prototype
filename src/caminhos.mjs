// Onde ficam os arquivos que o robô guarda entre uma rodada e outra.
//
// Era caminho relativo em sete lugares ("estado/x.json"), o que resolve
// contra o `cwd`. Rodando `node` da raiz do projeto funciona; empacotado no
// Electron o `cwd` é "/", e o app procurava "/estado" — ou seja, abriria
// todo dia sem carteira, sem mapeamento e sem a loja conectada, em silêncio.
//
// Agora é uma raiz só. O Electron aponta ESTADO_DIR para a pasta do usuário
// antes de importar qualquer coisa; nos scripts e nos testes, continua
// "estado" ao lado do projeto, como sempre foi.
import { join, resolve } from "node:path";

export const RAIZ_ESTADO = resolve(process.env.ESTADO_DIR ?? "estado");
export const emEstado = (nome) => join(RAIZ_ESTADO, nome);
