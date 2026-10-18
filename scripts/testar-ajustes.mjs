// Os ajustes guardam a chave do AdsPower, que é credencial: quem a tem abre
// os navegadores já logados nas contas da Shopee. Então o que se testa aqui
// não é "salvou e leu", é: não aceita campo que a tela não deveria mandar,
// o arquivo não fica legível pra outro usuário da máquina, e salvar um
// ajuste não apaga os outros.
import { mkdtempSync, statSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pasta = mkdtempSync(join(tmpdir(), "esteira-ajustes-"));
process.env.AJUSTES_ARQUIVO = join(pasta, "ajustes.json");

const { lerAjustes, salvarAjustes, aplicarNoAmbiente } = await import("../src/ajustes.mjs");

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

sec("sem arquivo nenhum, ainda funciona");
const vazio = lerAjustes();
tudo &= ok(vazio.adspowerChave === "", "nasce sem chave, não undefined");
tudo &= ok(vazio.adspowerBase.includes("50325"), "e com o endereço padrão do AdsPower");
tudo &= ok(vazio.navegadores === null, "navegadores em null = usar a recomendação da máquina");

sec("salvar um ajuste não apaga os outros");
salvarAjustes({ adspowerChave: "chave-de-teste" });
salvarAjustes({ som: false });
const depois = lerAjustes();
tudo &= ok(depois.adspowerChave === "chave-de-teste", "a chave sobreviveu ao segundo salvamento");
tudo &= ok(depois.som === false, "e o segundo ajuste entrou");

sec("campo que a tela não deveria mandar é descartado");
salvarAjustes({ adspowerBase: "http://outro:1", tokenShopify: "roubado", __proto__: { x: 1 } });
const limpo = lerAjustes();
tudo &= ok(limpo.tokenShopify === undefined, "campo fora da lista não é guardado");
tudo &= ok(limpo.adspowerBase === "http://outro:1", "e o campo legítimo da mesma chamada entrou");
tudo &= ok({}.x === undefined, "e não dá pra sujar o Object.prototype por aqui");
// Conferir pelo lerAjustes não basta: ele filtra de novo, então esconderia
// um campo estranho que foi gravado no disco mesmo assim.
const noDisco = JSON.parse(readFileSync(process.env.AJUSTES_ARQUIVO, "utf8"));
tudo &= ok(noDisco.tokenShopify === undefined, "e nem chega a ser escrito no arquivo");

sec("campo fora da lista no arquivo também não passa na leitura");
// alguém editando o JSON na mão, ou um arquivo de versão futura
writeFileSync(process.env.AJUSTES_ARQUIVO,
  JSON.stringify({ adspowerChave: "k", escreverDireto: true, comandoPraRodar: "rm -rf /" }));
const doArquivo = lerAjustes();
tudo &= ok(doArquivo.comandoPraRodar === undefined, "o campo estranho não chega a quem lê");
tudo &= ok(doArquivo.escreverDireto === true, "e o campo conhecido chega");

sec("arquivo fechado: só o dono lê");
const modo = statSync(process.env.AJUSTES_ARQUIVO).mode & 0o777;
tudo &= ok(modo === 0o600, `o arquivo ficou ${modo.toString(8)}, esperado 600`);

sec("arquivo corrompido não derruba o app");
writeFileSync(process.env.AJUSTES_ARQUIVO, "{ isto não é json");
tudo &= ok(lerAjustes().adspowerBase.includes("50325"), "volta pro padrão em vez de estourar");

sec("quem definiu a variável de propósito manda");
salvarAjustes({ adspowerChave: "a-do-arquivo" });
process.env.ADSPOWER_API_KEY = "a-de-fora";
aplicarNoAmbiente();
tudo &= ok(process.env.ADSPOWER_API_KEY === "a-de-fora",
  "o .env e os testes continuam vencendo o arquivo de ajustes");
delete process.env.ADSPOWER_API_KEY;
aplicarNoAmbiente();
tudo &= ok(process.env.ADSPOWER_API_KEY === "a-do-arquivo", "e sem ela, vale a do arquivo");

rmSync(pasta, { recursive: true, force: true });
console.log(tudo ? "\n\x1b[32m\x1b[1m  ajustes de pé\x1b[0m\n"
                 : "\n\x1b[31m\x1b[1m  ajustes com furo\x1b[0m\n");
process.exit(tudo ? 0 : 1);
