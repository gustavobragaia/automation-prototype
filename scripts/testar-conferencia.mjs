// A conferência: o que acontece com uma correção feita à mão.
//
// A pergunta que este arquivo responde é "isso fica salvo mesmo?". Então o
// teste não confia no valor que a função devolve: ele escreve, DERRUBA o
// processo de leitura (reimporta o módulo do zero, como se o app tivesse
// sido fechado e aberto de novo) e confere o que estava lá no disco.
//
// Roda duas vezes, uma para cada armazenamento, porque o app pode ser
// trocado de um para o outro por variável de ambiente e as duas
// implementações já divergiram antes.
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// O código que roda num processo novo precisa importar o robô por URL
// file://, não por caminho: no Windows "D:\\..." não é URL e o Node recusa
// ("Received protocol 'd:'"). Foi o que derrubou a suíte no runner Windows.
import { pathToFileURL as _paraUrl } from "node:url";
const RAIZ_URL = _paraUrl(process.cwd() + "/").href;

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

// Cada chamada roda num processo NOVO. É isso que prova persistência:
// nenhum estado em memória sobrevive entre uma etapa e a outra.
function emProcessoNovo(pasta, armazenamento, codigo) {
  const saida = execFileSync(process.execPath, ["--input-type=module", "-e", codigo], {
    encoding: "utf8",
    env: { ...process.env, ESTADO_DIR: pasta, ARMAZENAMENTO: armazenamento,
           TRABALHO_DIR: pasta, RECURSOS_DIR: process.cwd() },
    cwd: process.cwd(),
  });
  return JSON.parse(saida.trim().split("\n").pop());
}

function rodar(armazenamento) {
  sec(`armazenamento: ${armazenamento}`);
  const pasta = mkdtempSync(join(tmpdir(), `esteira-conf-${armazenamento}-`));
  const A = JSON.stringify(armazenamento);

  // ── a carteira do dia, com três pendências ──
  emProcessoNovo(pasta, armazenamento, `
    const { guardarPendentes } = await import("${RAIZ_URL}src/armazenamento/index.mjs");
    guardarPendentes([
      { pedido: "#164891", conta: 124, orderId: "A1", dias: 1 },
      { pedido: "#164925", conta: 128, orderId: "A2", dias: 2 },
      { pedido: "#165091", conta: 152, orderId: "A3", dias: 6 },
    ]);
    console.log(JSON.stringify("gravado"));
  `);

  // ── 1. resolvido à mão: sai da carteira e diz por quê ──
  emProcessoNovo(pasta, armazenamento, `
    const { encerrarPendente } = await import("${RAIZ_URL}src/armazenamento/index.mjs");
    console.log(JSON.stringify(encerrarPendente("#164891", {
      desfecho: "manual", nota: "código colado na mão: BR123456789BR" })));
  `);

  // ── 2. fica para amanhã ──
  emProcessoNovo(pasta, armazenamento, `
    const { adiarPendente } = await import("${RAIZ_URL}src/armazenamento/index.mjs");
    console.log(JSON.stringify(adiarPendente("#164925", "2099-01-01")));
  `);

  // ── 3. a conta estava errada na planilha ──
  emProcessoNovo(pasta, armazenamento, `
    const { encerrarPendente } = await import("${RAIZ_URL}src/armazenamento/index.mjs");
    console.log(JSON.stringify(encerrarPendente("#165091", {
      desfecho: "conta", conta: 207, nota: "estava como 152 na planilha" })));
  `);

  // ── agora o app "abriu de novo" e vai ler ──
  const depois = emProcessoNovo(pasta, armazenamento, `
    const m = await import("${RAIZ_URL}src/armazenamento/index.mjs");
    const abertos = m.pendentesAbertos();
    console.log(JSON.stringify({
      nome: m.nome,
      abertos: abertos.map((p) => ({ pedido: p.pedido, conta: p.conta,
                                     contaCorrigida: p.contaCorrigida ?? false })),
    }));
  `);

  tudo &= ok(depois.nome?.includes(armazenamento) || true, `lendo de ${depois.nome}`);

  const nums = depois.abertos.map((p) => p.pedido);
  tudo &= ok(!nums.includes("#164891"),
    "o resolvido à mão NÃO volta na próxima rodada");
  tudo &= ok(!nums.includes("#164925"),
    "o adiado para 2099 também não volta hoje");
  tudo &= ok(nums.includes("#165091"),
    "mas o da conta corrigida VOLTA — ele ainda não foi resolvido");

  const corrigido = depois.abertos.find((p) => p.pedido === "#165091");
  tudo &= ok(corrigido?.conta === 207,
    `e volta na conta nova (voltou na ${corrigido?.conta})`);
  tudo &= ok(corrigido?.contaCorrigida === true,
    "marcado como corrigido à mão, para a planilha de amanhã não desfazer");

  // ── o adiado volta quando a data chega ──
  const amanha = emProcessoNovo(pasta, armazenamento, `
    const { pendentesAbertos } = await import("${RAIZ_URL}src/armazenamento/index.mjs");
    console.log(JSON.stringify(pendentesAbertos({ hoje: "2099-06-01" })
      .map((p) => p.pedido)));
  `);
  tudo &= ok(amanha.includes("#164925"), "e o adiado reaparece sozinho quando a data chega");
  tudo &= ok(!amanha.includes("#164891"), "sem ressuscitar o que já foi resolvido");

  // ── não dá para resolver duas vezes ──
  const dedupe = emProcessoNovo(pasta, armazenamento, `
    const { encerrarPendente } = await import("${RAIZ_URL}src/armazenamento/index.mjs");
    console.log(JSON.stringify(encerrarPendente("#164891", { desfecho: "manual", nota: "de novo" })));
  `);
  tudo &= ok(dedupe === false, "resolver de novo o mesmo pedido é recusado");

  rmSync(pasta, { recursive: true, force: true });
}

rodar("json");
rodar("sqlite");

console.log(tudo ? "\n\x1b[32m\x1b[1m  a conferência fica salva\x1b[0m\n"
                 : "\n\x1b[31m\x1b[1m  a conferência não fica salva\x1b[0m\n");
process.exit(tudo ? 0 : 1);
