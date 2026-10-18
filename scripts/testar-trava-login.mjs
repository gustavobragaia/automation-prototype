// Um login por vez em toda a rodada, não só dentro de um perfil.
process.env.SHOPEE_SENHA = "senha-de-teste";
process.env.TRAVA_LOGIN_MS = "300";              // expiração curta, para testar

const { iniciarColetor } = await import("../src/coletor.mjs");
const { novoToken, limparToken } = await import("../src/credenciais.mjs");
const t = await import("../src/trava-login.mjs");

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (x) => console.log(`\n\x1b[1m${x}\x1b[0m`);
let tudo = true;

sec("a trava, sozinha");
t.limparTrava();
tudo &= ok(t.pedirTrava(124).meu === true, "a primeira conta a pedir, leva");
tudo &= ok(t.pedirTrava(128).meu === false, "a segunda espera");
tudo &= ok(t.pedirTrava(124).meu === true, "quem já tem, continua tendo (pedir de novo não derruba)");
tudo &= ok(t.donoAtual() === 124, "o dono não mudou");
tudo &= ok(t.soltarTrava(128) === false, "quem não é dono não consegue soltar a vez de outro");
tudo &= ok(t.donoAtual() === 124, "e o dono segue de pé depois da tentativa");
tudo &= ok(t.soltarTrava(124) === true, "o dono solta");
tudo &= ok(t.pedirTrava(128).meu === true, "e a próxima entra");

sec("dona que trava no meio do login não para a rodada");
t.limparTrava();
t.pedirTrava(130);
tudo &= ok(t.pedirTrava(133).meu === false, "enquanto vale, ninguém mais entra");
await new Promise((r) => setTimeout(r, 360));
const r2 = t.pedirTrava(133);
tudo &= ok(r2.meu === true && r2.roubou === true, "passado o tempo, a vez é tomada");
tudo &= ok(t.donoAtual() === 133, "e o novo dono é quem pediu");

sec("pela rota do coletor, como a extensão faz");
const col = await iniciarColetor({ porta: 3913, aoLog: () => {} });
const U = "http://127.0.0.1:3913/trava-login";
const tok = novoToken();
const chamar = (conta, acao = "pedir", cab = {}) =>
  fetch(`${U}?conta=${conta}&token=${tok}&acao=${acao}`, { headers: cab }).then(async (r) => ({ s: r.status, b: await r.json() }));

t.limparTrava();
tudo &= ok((await chamar(124)).b.meu === true, "a rota concede à primeira");
tudo &= ok((await chamar(128)).b.meu === false, "e recusa à segunda");
tudo &= ok((await chamar(124, "soltar")).b.soltou === true, "a rota solta");
tudo &= ok((await chamar(128)).b.meu === true, "e aí a segunda entra");

sec("a rota é tão protegida quanto a da credencial");
tudo &= ok((await fetch(`${U}?conta=7&token=errado&acao=pedir`)).status === 403, "token errado → 403");
tudo &= ok((await fetch(`${U}?conta=7&acao=pedir`)).status === 403, "sem token → 403");
tudo &= ok((await chamar(7, "pedir", { Origin: "https://shopee.com.br" })).s === 403,
           "página da Shopee pedindo → 403 mesmo com token");

sec("o caso que motivou tudo: perfis simultâneos");
t.limparTrava();
// cinco perfis pedindo ao mesmo tempo, como numa rodada com concorrência 5
const juntos = await Promise.all([124, 128, 130, 133, 152].map((c) => chamar(c)));
const ganharam = juntos.filter((x) => x.b.meu).length;
tudo &= ok(ganharam === 1, `cinco perfis pedindo juntos, ${ganharam} logou (tem que ser 1)`);
const dono = t.donoAtual();
tudo &= ok([124, 128, 130, 133, 152].includes(dono), "e o dono é uma das cinco");
// o dono solta, e só mais UM entra
await chamar(dono, "soltar");
const depois = await Promise.all([124, 128, 130, 133, 152].filter((c) => c !== dono).map((c) => chamar(c)));
tudo &= ok(depois.filter((x) => x.b.meu).length === 1, "soltou, e exatamente mais um entrou");

limparToken();
await col.fechar();
console.log(tudo ? "\n\x1b[32m\x1b[1m  um login por vez, na rodada inteira\x1b[0m\n" : "\n\x1b[31m  FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
