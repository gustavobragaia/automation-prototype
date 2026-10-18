// As rotas sensíveis do coletor só podem responder à nossa extensão.
process.env.SHOPEE_SENHA = "senha-de-teste";
// O padrão de e-mail é configuração do cliente, sem valor padrão. O teste
// declara o que exercita, em vez de herdar o de quem instalou por último.
process.env.SHOPEE_PREFIXO ??= "chompspee";
process.env.SHOPEE_PREFIXO_ALTO ??= "Brushopee";
process.env.SHOPEE_FAIXA_PREFIXO ??= "200";
process.env.SHOPEE_EMAIL_DOMINIO ??= "givmail.com";
process.env.SHOPEE_SENHA ??= "senha-de-teste";

const { iniciarColetor } = await import("../src/coletor.mjs");
const { novoToken, limparToken } = await import("../src/credenciais.mjs");

const col = await iniciarColetor({ porta: 3911, aoLog: () => {} });
const U = "http://127.0.0.1:3911/credencial";
const chamar = (q, cab = {}) => fetch(`${U}?${q}`, { headers: cab }).then(async (r) => ({ s: r.status, b: await r.json() }));
const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;

let tudo = true;
const t = novoToken();

tudo &= ok((await chamar(`conta=7&token=${t}`)).b.email === "chompspee7@givmail.com",
           "conta abaixo de 200 usa o prefixo chompspee");
tudo &= ok((await chamar(`conta=506&token=${t}`)).b.email === "Brushopee506@givmail.com",
           "conta a partir de 200 usa o prefixo Brushopee");
tudo &= ok((await chamar("conta=7&token=errado")).s === 403, "token errado → 403");
tudo &= ok((await chamar("conta=7")).s === 403, "sem token → 403");
tudo &= ok((await chamar(`conta=7&token=${t}`, { Origin: "https://shopee.com.br" })).s === 403,
           "página da Shopee pedindo → 403 mesmo com token");
tudo &= ok((await chamar(`conta=7&token=${t}`, { Origin: "https://site-malicioso.com" })).s === 403,
           "site qualquer pedindo → 403");

limparToken();
tudo &= ok((await chamar(`conta=7&token=${t}`)).s === 403, "fora da rodada, token antigo não vale mais");

await col.fechar();
console.log(tudo ? "\n\x1b[32m\x1b[1m  defesas ok\x1b[0m\n" : "\n\x1b[31m  FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
