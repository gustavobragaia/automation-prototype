// Avisos que somem e nada para conferir depois — Matheus, 21/10/2026: ele não
// conseguiu dizer qual aviso apareceu em 3 contas porque os avisos sumiam e o
// log do app vivia só na memória.
//
// Confere: alerta resolvido/dispensado fica 7 dias; o log vai para arquivo e
// guarda 14 dias; o diagnóstico exportado não leva senha, chave nem dado de
// cliente — com dados de teste plantados de propósito em todo canto.
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "esteira-diag-"));
process.env.TRABALHO_DIR = dir; process.env.ESTADO_DIR = join(dir, "estado");
const SENHA = "SenhaDaShopee#2026", CHAVE_RAPID = "rapid-chave-secreta-123456", CHAVE_ADS = "ads-chave-secreta-987654";
process.env.SHOPEE_SENHA = SENHA; process.env.RAPIDAPI_KEY = CHAVE_RAPID; process.env.ADSPOWER_API_KEY = CHAVE_ADS;

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

const { salvarAjustes } = await import("../src/ajustes.mjs");
const { alertar, resolver, dispensar, lerAlertas, alertasResolvidos } = await import("../src/alertas.mjs");
const { gravarLinha, lerLogs } = await import("../src/log-diario.mjs");
const { montarDiagnostico } = await import("../src/diagnostico.mjs");
const { DIR_COLETAS, DIR_EVENTOS } = await import("../src/caminhos.mjs");

salvarAjustes({ shopeeSenha: SENHA, codigoChave: CHAVE_RAPID, adspowerChave: CHAVE_ADS, emailPrefixo: "loja" });

sec("1. Alerta resolvido ou dispensado não some");
alertar({ id: "conta-humano-167", nivel: "atencao", conta: 167, titulo: "A conta 167 está esperando você",
  texto: "a Shopee pediu para confirmar a identidade por e-mail, e o e-mail de verificação não chegou em 120s" });
alertar({ id: "rapidapi-pouca", nivel: "atencao", titulo: "Restam 0 consultas", texto: "x" });
resolver("conta-humano-167");
dispensar("rapidapi-pouca");
const res = alertasResolvidos();
tudo &= ok(lerAlertas().length === 0, "os dois saem do sino (contador zerado)");
tudo &= ok(res.length === 2 && res.some((a) => a.id === "conta-humano-167" && a.comoSaiu === "resolvido")
  && res.some((a) => a.id === "rapidapi-pouca" && a.comoSaiu === "dispensado"), "e ficam em \"Resolvidos\", dizendo como saíram");
tudo &= ok(/não chegou em 120s/.test(res.find((a) => a.conta === 167)?.texto ?? ""), "com o texto original do aviso (o que o Matheus precisava)");

sec("2. Log em arquivo, 14 dias");
mkdirSync(join(dir, "logs"), { recursive: true });
const velho = join(dir, "logs", "2026-09-01.log");
writeFileSync(velho, "linha velha\n");
gravarLinha("conta 167: verificacao-email-pedida");
gravarLinha("linha com a senha por engano: " + SENHA);   // um descuido no futuro
const arquivos = readdirSync(join(dir, "logs"));
tudo &= ok(arquivos.length === 1 && /^\d{4}-\d{2}-\d{2}\.log$/.test(arquivos[0]), `um arquivo por dia; o de mais de 14 dias foi apagado (${arquivos.join(", ")})`);
tudo &= ok(/conta 167: verificacao-email-pedida/.test(lerLogs(3)), "o log sobrevive: lido do arquivo, não da memória");

sec("3. O diagnóstico não leva o que não deve");
mkdirSync(DIR_COLETAS, { recursive: true }); mkdirSync(DIR_EVENTOS, { recursive: true });
writeFileSync(join(DIR_COLETAS, "conta-124.json"), JSON.stringify({ conta: "124", pagina: "https://shopee.com.br/user/purchase?type=7&token=abc",
  duracaoMs: 33000, listas: [{ tipo: 6, pagina: 0, status: 200, ok: true, corpo: { error: 0 } }],
  pedidos: [{ orderId: "1", bruto: { data: { address: { name: "Maria Cliente Real", phone: "11999998888", full_address: "Rua das Flores, 123" } } } }] }));
writeFileSync(join(DIR_EVENTOS, `${Date.now()}-precisa-humano.json`), JSON.stringify({ tipo: "precisa-humano", conta: "167", motivo: "e-mail não chegou", em: Date.now(), pagina: "https://shopee.com.br/verify/ivs?is_initial=true" }));
writeFileSync(join(DIR_EVENTOS, `${Date.now() + 1}-ivs-rede.json`), JSON.stringify({ tipo: "ivs-rede", conta: "167", resposta: '{"phone":"11999998888","email":"comprador@x.com"}' }));
const d = montarDiagnostico({ versao: "0.1.7" });
tudo &= ok(!d.includes(SENHA) && !d.includes(CHAVE_RAPID) && !d.includes(CHAVE_ADS), "nenhuma senha nem chave, nem a que entrou no log por engano");
tudo &= ok(/"shopeeSenha": "\[guardada\]"/.test(d), "os ajustes dizem só que a senha está guardada");
tudo &= ok(!/Maria Cliente Real|11999998888|Rua das Flores|comprador@x\.com/.test(d), "nenhum dado de cliente (nome, telefone, endereço, e-mail)");
tudo &= ok(/conta 124: 1 pedido\(s\) · 33000 ms/.test(d) && /6\/0:200/.test(d), "das coletas vai o resumo: quantos pedidos, tempo e status de cada consulta");
tudo &= ok(/conta 167\s+precisa-humano — e-mail não chegou/.test(d), "os avisos da extensão vão (o que travou e por quê)");
tudo &= ok(!/token=abc/.test(d), "endereços de página sem parâmetros");
tudo &= ok(/A conta 167 está esperando você/.test(d) && /resolvido/.test(d), "os alertas resolvidos vão também");

sec("4. O log da escrita não tem nome de cliente");
{
  const fonte = (await import("node:fs")).readFileSync(new URL("../src/escrita.mjs", import.meta.url), "utf8");
  tudo &= ok(!/aoLog\(`\$\{alvo\.pedido\} · \$\{alvo\.nome\}/.test(fonte), "a linha de escrita traz o pedido e a conta, sem o nome");
}

console.log(tudo ? "\n\x1b[32m\x1b[1m  diagnóstico: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  diagnóstico: FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
