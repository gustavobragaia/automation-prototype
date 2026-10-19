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

const { lerAjustes, salvarAjustes, aplicarNoAmbiente, faltaConfigurar } = await import("../src/ajustes.mjs");

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
if (process.platform === "win32") {
  // No Windows não existe "600": a proteção é por ACL, e a pasta do usuário
  // (AppData), onde o Esteira guarda os ajustes, já é restrita àquele
  // usuário pelo próprio sistema. O chmod do Node lá só liga/desliga
  // "somente leitura" — conferir 600 seria testar algo que não existe.
  console.log("  · no Windows a proteção é a da pasta do usuário (AppData), não o 600");
} else {
  const modo = statSync(process.env.AJUSTES_ARQUIVO).mode & 0o777;
  tudo &= ok(modo === 0o600, `o arquivo ficou ${modo.toString(8)}, esperado 600`);
}

sec("arquivo corrompido não derruba o app");
writeFileSync(process.env.AJUSTES_ARQUIVO, "{ isto não é json");
tudo &= ok(lerAjustes().adspowerBase.includes("50325"), "volta pro padrão em vez de estourar");

sec("os Ajustes vencem o ambiente");
// Mudou de ideia em relação à versão anterior deste teste, e por um motivo:
// a tela é o ÚNICO lugar onde o cliente consegue mexer. Se ele digita a
// senha nos Ajustes e um .env esquecido na pasta continuasse ganhando, ele
// mudaria o campo, nada aconteceria, e não teria como descobrir por quê.
salvarAjustes({ adspowerChave: "a-do-arquivo" });
process.env.ADSPOWER_API_KEY = "a-de-fora";
aplicarNoAmbiente();
tudo &= ok(process.env.ADSPOWER_API_KEY === "a-do-arquivo",
  "o que está nos Ajustes vence o .env");

sec("campo em branco não sobrepõe nada");
// Quem não configurou não pode apagar o que o .env ou o padrão do código
// já davam — senão abrir a tela uma vez zeraria a configuração.
salvarAjustes({ adspowerChave: "" });
process.env.ADSPOWER_API_KEY = "so-o-env";
aplicarNoAmbiente();
tudo &= ok(process.env.ADSPOWER_API_KEY === "so-o-env",
  "campo vazio deixa o ambiente em paz");
delete process.env.ADSPOWER_API_KEY;

sec("a senha da Shopee e o padrão de e-mail saem dos Ajustes");
salvarAjustes({
  shopeeSenha: "senha-de-teste", codigoChave: "chave-de-teste",
  emailPrefixo: "loja", emailPrefixoAlto: "", emailDominio: "exemplo.com",
});
aplicarNoAmbiente();
tudo &= ok(process.env.SHOPEE_SENHA === "senha-de-teste", "a senha chega ao robô");
tudo &= ok(process.env.RAPIDAPI_KEY === "chave-de-teste", "a chave do código também");

// A prova que importa: o robô MONTA o e-mail a partir disso, e não do
// padrão fixo no código. É este e-mail que ele digita na tela da Shopee.
const { emailDaConta } = await import("../src/tracking.mjs");
tudo &= ok(emailDaConta(124) === "loja124@exemplo.com",
  `a conta 124 entra como ${emailDaConta(124)}`);
tudo &= ok(emailDaConta(207) === "loja207@exemplo.com",
  "e sem segundo prefixo, a faixa não se aplica");

salvarAjustes({ emailPrefixoAlto: "Outro", emailFaixa: 200 });
aplicarNoAmbiente();
tudo &= ok(emailDaConta(207) === "Outro207@exemplo.com",
  `com a faixa, a 207 entra como ${emailDaConta(207)}`);
tudo &= ok(emailDaConta(124) === "loja124@exemplo.com", "e a 124 continua no primeiro");

sec("segundo prefixo sem faixa não vale para ninguém");
// O cliente digita o segundo começo e esquece de dizer a partir de qual
// conta. Faixa em zero faria `n >= 0` ser sempre verdade, e TODAS as contas
// entrariam com o prefixo errado — todas as senhas recusadas, e nenhuma
// pista do porquê.
salvarAjustes({ emailPrefixoAlto: "Outro", emailFaixa: 0 });
aplicarNoAmbiente();
tudo &= ok(emailDaConta(207) === "loja207@exemplo.com",
  `sem faixa, a 207 fica no primeiro começo (ficou ${emailDaConta(207)})`);
tudo &= ok(emailDaConta(9) === "loja9@exemplo.com", "e a 9 também");

sec("o login automático dá para desligar");
salvarAjustes({ loginAutomatico: false });
aplicarNoAmbiente();
tudo &= ok(process.env.LOGIN_AUTOMATICO === "0", "desligado chega ao robô");

sec("os segredos sobrevivem a fechar o app");
const vistos = JSON.parse((await import("node:child_process")).execFileSync(process.execPath,
  ["--input-type=module", "-e", `
    const { lerAjustes } = await import("${process.cwd()}/src/ajustes.mjs");
    const a = lerAjustes();
    console.log(JSON.stringify({ senha: a.shopeeSenha, prefixo: a.emailPrefixo,
                                 dominio: a.emailDominio, login: a.loginAutomatico }));
  `], { encoding: "utf8", env: { ...process.env } }).trim());
tudo &= ok(vistos.senha === "senha-de-teste", "a senha está lá depois de reabrir");
tudo &= ok(vistos.dominio === "exemplo.com", "e o domínio também");
tudo &= ok(vistos.login === false, "e o login desligado");

sec("instalação nova: nada vem preenchido");
// O padrão NÃO pode ser a configuração da Chomps. Para o segundo comprador
// do Esteira, o robô tentaria entrar como "chompspee124@givmail.com" com a
// senha dele, as 80 contas recusariam, e não haveria pista do porquê.
rmSync(process.env.AJUSTES_ARQUIVO, { force: true });
const novo = lerAjustes();
tudo &= ok(novo.emailPrefixo === "", "o começo do e-mail nasce vazio");
tudo &= ok(novo.emailDominio === "", "o domínio também");
tudo &= ok(novo.shopeeSenha === "", "e a senha");

sec("e o app diz o que falta, em português");
const falta = faltaConfigurar(novo);
tudo &= ok(falta.length === 4, `quatro coisas faltando (listou ${falta.length})`);
tudo &= ok(falta.some((f) => /senha/.test(f)), "a senha está na lista");
tudo &= ok(falta.some((f) => /domínio/.test(f)), "o domínio está na lista");
tudo &= ok(!falta.some((f) => /_/.test(f)),
  "e nenhum item é nome de variável — é frase para ler");

sec("segundo começo sem faixa também é coisa faltando");
salvarAjustes({ shopeeSenha: "x", codigoChave: "y",
                emailPrefixo: "loja", emailDominio: "ex.com" });
tudo &= ok(faltaConfigurar().length === 0, "com o básico preenchido, não falta nada");
salvarAjustes({ emailPrefixoAlto: "Outro" });
tudo &= ok(faltaConfigurar().some((f) => /a partir de qual conta/.test(f)),
  "mas um segundo começo sem faixa não vale para ninguém, e o app avisa");

sec("sem configurar, o robô não monta e-mail nenhum");
rmSync(process.env.AJUSTES_ARQUIVO, { force: true });
for (const v of ["SHOPEE_PREFIXO","SHOPEE_PREFIXO_ALTO","SHOPEE_EMAIL_DOMINIO"]) delete process.env[v];
let estourouEmail = false;
try { emailDaConta(124); } catch (e) { estourouEmail = /Ajustes/.test(e.message); }
tudo &= ok(estourouEmail,
  "estoura apontando para a tela, em vez de montar um e-mail de outro cliente");

sec("os campos de segredo da tela e os do robô têm o mesmo nome");
// O campo da chave do AdsPower se chamava "adsChave" na tela e
// "adspowerChave" no robô. Resultado: a tela nunca reconhecia a chave
// guardada — e o que a pessoa digitasse era DESCARTADO em silêncio, porque o
// robô só aceita nomes da sua lista. Quem achou foi o Gustavo, não um teste.
const { SEGREDOS } = await import("../src/ajustes.mjs");
const { readFileSync: lerTela } = await import("node:fs");
const tela = lerTela(new URL("../aplicativo/tela/index.html", import.meta.url), "utf8");
const naTela = [...tela.matchAll(/data-segredo="([a-zA-Z]+)"/g)].map((m) => m[1]);
const soNaTela = naTela.filter((n) => !SEGREDOS.includes(n));
const soNoRobo = SEGREDOS.filter((n) => !naTela.includes(n));
tudo &= ok(!soNaTela.length,
  "todo campo de segredo da tela existe no robô" + (soNaTela.length ? ` — sobrando: ${soNaTela}` : ""));
tudo &= ok(!soNoRobo.length,
  "e todo segredo do robô tem campo na tela" + (soNoRobo.length ? ` — faltando: ${soNoRobo}` : ""));

sec("e os campos comuns também");
// A mesma classe de erro vale para os campos que não são segredo: um id na
// tela mapeado para uma chave que o robô não conhece é configuração que some.
const real = lerTela(new URL("../aplicativo/tela/real.js", import.meta.url), "utf8");
const pares = [...real.matchAll(/\["(sh[A-Za-z]+|ads[A-Za-z]+)","([a-zA-Z]+)"\]/g)].map((m) => [m[1], m[2]]);
const { lerAjustes: ler2 } = await import("../src/ajustes.mjs");
const conhecidos = Object.keys(ler2());
const orfaos = pares.filter(([, chave]) => !conhecidos.includes(chave));
tudo &= ok(pares.length >= 5, `achei os ${pares.length} campos mapeados na tela`);
tudo &= ok(!orfaos.length,
  "todos apontam para um ajuste que o robô guarda" + (orfaos.length ? ` — órfãos: ${orfaos.map((p) => p.join("→"))}` : ""));
const idsQueNaoExistem = pares.filter(([id]) => !tela.includes(`id="${id}"`));
tudo &= ok(!idsQueNaoExistem.length,
  "e todos os campos existem de fato na tela" + (idsQueNaoExistem.length ? ` — sumiram: ${idsQueNaoExistem.map((p) => p[0])}` : ""));

rmSync(pasta, { recursive: true, force: true });
console.log(tudo ? "\n\x1b[32m\x1b[1m  ajustes de pé\x1b[0m\n"
                 : "\n\x1b[31m\x1b[1m  ajustes com furo\x1b[0m\n");
process.exit(tudo ? 0 : 1);
