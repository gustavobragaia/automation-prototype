// Cliente com mais de um pedido na mesma conta — planilha da Chomps, 21/10/2026.
//
// EDESIO LOPES DE CERQUEIRA, conta 162: #165172 (R$ 36,56, em 2 linhas — 2
// produtos) e #165173 (R$ 12,90) na planilha; duas compras na Shopee, R$ 34,80
// e R$ 14,66 (o print do Matheus). Nenhum valor bate sozinho, a soma bate
// exata. Os dois iam para "dois candidatos" e ele não sabia o que fazer.
//
// Aqui: o pareamento pelo total resolve sozinho quando dá para ter certeza, e
// NÃO resolve quando não dá (valores iguais, total que não bate, compra sem
// rastreio). E a escrita manda cada pedido UMA vez, mesmo em 2 linhas.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "esteira-par-"));
process.env.TRABALHO_DIR = dir; process.env.ESTADO_DIR = join(dir, "estado");
process.env.REGISTRO_ESCRITAS = join(dir, "escritas.json");

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

const { conciliar, pareamentoClaro } = await import("../src/conciliar.mjs");
const linha = (pedido, nome, valor) => ({ pedido: `Pedido #${pedido}`, nome, valor });
const compra = (nome, valor, codigo, cep = "08900000") => ({ nome, valor, codigos: codigo ? [codigo] : [], cep });
const rodar = (conta, pedidos, compras) => conciliar([{ conta, pedidos }], new Map([[conta, compras]])).linhas;
const de = (linhas, num) => linhas.filter((l) => l.p.pedido === `Pedido #${num}`);

sec("1. EDESIO (conta 162): dois pedidos, duas compras, a soma bate");
{
  const l = rodar(162, [
    linha(165172, "EDESIO LOPES DE CERQUEIRA", 36.56), linha(165172, "EDESIO LOPES DE CERQUEIRA", 36.56),
    linha(165173, "EDESIO LOPES DE CERQUEIRA", 12.9),
  ], [compra("Edesio Lopes de Cerqueira", 34.8, "BR2620456593785"), compra("Edesio Lopes de Cerqueira", 14.66, "BR265742968962P")]);
  const a = de(l, 165172), b = de(l, 165173);
  tudo &= ok(a.every((x) => x.estado === "ok-total" && x.codigo === "BR2620456593785"),
    "#165172 (R$ 36,56) → BR2620456593785 (R$ 34,80), nas duas linhas");
  tudo &= ok(b.every((x) => x.estado === "ok-total" && x.codigo === "BR265742968962P"),
    "#165173 (R$ 12,90) → BR265742968962P (R$ 14,66)");
  tudo &= ok(!l.some((x) => x.motivo), "nenhum dos dois vai para a conferência");
}

sec("2. HAROLDO (conta 163): dois pedidos de R$ 31,99 — não dá para saber qual é qual");
{
  const l = rodar(163, [linha(165184, "HAROLDO DEDA", 31.99), linha(165185, "HAROLDO DEDA", 31.99)],
    [compra("Haroldo Deda", 30.5, "BR000000000001A"), compra("Haroldo Deda", 33.48, "BR000000000002A")]);
  tudo &= ok(l.every((x) => x.estado === "ambiguo" && !x.codigo), "os dois ficam para você (empate), sem rastreio escrito");
  tudo &= ok(l.every((x) => x.motivo?.candidatos?.length === 2), "com os dois candidatos para escolher");
}

sec("3. Pedido de 2 produtos comprados separados, soma com 1 centavo de diferença");
{
  const l = rodar(128, [linha(164925, "Jose Ernesto Freitas de Camargo", 88.3), linha(164925, "Jose Ernesto Freitas de Camargo", 88.3)],
    [compra("Jose Ernesto Freitas de Camargo", 51.9, "BR262981565516C"), compra("Jose Ernesto Freitas de Camargo", 36.41, "BR269462194730E")]);
  tudo &= ok(l.every((x) => x.estado === "ok-partes" && x.codigo === "BR262981565516C · BR269462194730E"),
    "os dois rastreios vão para o mesmo pedido (antes: exigia o centavo exato)");
}

sec("4. Dois pedidos, três compras (um pedido de 2 produtos separados)");
{
  const l = rodar(170, [linha(165237, "GILBERTO DOS SANTOS", 50), linha(165238, "GILBERTO DOS SANTOS", 20)],
    [compra("Gilberto dos Santos", 32.1, "BR000000000010A"), compra("Gilberto dos Santos", 17.9, "BR000000000011A"),
     compra("Gilberto dos Santos", 20, "BR000000000012A")]);
  const a = de(l, 165237)[0], b = de(l, 165238)[0];
  tudo &= ok(a.estado === "ok-partes" && a.codigo.split(" · ").sort().join() === "BR000000000010A,BR000000000011A",
    "#165237 (R$ 50) fica com as duas compras que somam 50");
  tudo &= ok(b.estado === "ok-total" && b.codigo === "BR000000000012A", "#165238 (R$ 20) fica com a de 20");
}

sec("5. Quando NÃO dá para ter certeza, nada é escrito sozinho");
{
  // o total não bate: tem uma compra antiga do mesmo cliente na conta
  let l = rodar(162, [linha(1, "Maria Teste", 36.56), linha(2, "Maria Teste", 12.9)],
    [compra("Maria Teste", 34.8, "BR0001X"), compra("Maria Teste", 14.66, "BR0002X"), compra("Maria Teste", 99.9, "BR0003X")]);
  tudo &= ok(l.every((x) => x.estado === "ambiguo"), "total não bate (compra de outro dia na conta): fica para você");
  // uma das compras ainda sem rastreio
  l = rodar(162, [linha(1, "Maria Teste", 36.56), linha(2, "Maria Teste", 12.9)],
    [compra("Maria Teste", 34.8, "BR0001X"), compra("Maria Teste", 14.66, null)]);
  tudo &= ok(!l.some((x) => x.estado === "ok-total"), "compra sem rastreio ainda: não pareia");
  // compras para endereços diferentes, mais compras que pedidos
  l = rodar(162, [linha(1, "Maria Teste", 50)],
    [compra("Maria Teste", 30, "BR0001X", "01310100"), compra("Maria Teste", 20, "BR0002X", "20040002")]);
  tudo &= ok(!l.some((x) => x.estado === "ok-partes" || x.estado === "ok-total"), "duas compras para CEPs diferentes não viram um pedido só");
  // quase empate: a diferença entre os dois jeitos é pequena demais
  tudo &= ok(pareamentoClaro([{ valor: 30 }, { valor: 20.2 }], [{ valor: 25 }, { valor: 25.2 }]) === null,
    "pareamento com menos de R$ 0,50 de folga para o segundo melhor: não decide");
}

sec("6. A escrita manda cada pedido uma vez só, mesmo em 2 linhas");
{
  let mutacoes = 0;
  globalThis.fetch = async (url, opcoes = {}) => {
    const corpo = JSON.parse(opcoes.body ?? "{}");
    const resp = (data) => new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
    if (/fulfillmentCreateV2/.test(corpo.query)) {
      mutacoes++;
      const t = corpo.variables.f.trackingInfo;
      return resp({ fulfillmentCreateV2: { userErrors: [], fulfillment: { id: "gid://F/" + mutacoes, status: "SUCCESS",
        trackingInfo: (t.numbers ?? [t.number]).map((n) => ({ number: n, url: "", company: t.company })) } } });
    }
    const nums = [...String(corpo.variables.q).matchAll(/name:(\d+)/g)].map((m) => m[1]);
    return resp({ orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: nums.map((n) => ({
      name: "#" + n, id: "gid://O/" + n, createdAt: "2026-10-21T10:00:00Z", displayFulfillmentStatus: "UNFULFILLED",
      shippingAddress: { name: "EDESIO LOPES DE CERQUEIRA", zip: "08900000" }, totalPriceSet: { shopMoney: { amount: "1" } },
      lineItems: { nodes: [] }, fulfillmentOrders: { nodes: [{ id: "gid://FO/" + n, status: "OPEN" }] } })) } });
  };
  const { escreverRastreios } = await import("../src/escrita.mjs");
  const contas = [{ conta: 162, pedidos: [linha(165172, "EDESIO LOPES DE CERQUEIRA", 36.56), linha(165172, "EDESIO LOPES DE CERQUEIRA", 36.56),
    linha(165173, "EDESIO LOPES DE CERQUEIRA", 12.9)] }];
  const coletas = new Map([[162, [compra("Edesio Lopes de Cerqueira", 34.8, "BR2620456593785"), compra("Edesio Lopes de Cerqueira", 14.66, "BR265742968962P")]]]);
  const r = await escreverRastreios(contas, coletas, { escrever: true, conexao: { loja: "t.myshopify.com", modo: "token-fixo", accessToken: "x" } });
  tudo &= ok(r.escritos === 2 && r.falhas === 0 && mutacoes === 2,
    `2 pedidos, 2 escritas, nenhuma recusa (${mutacoes} envios; antes: 3, e o repetido voltava recusado)`);
}

console.log(tudo ? "\n\x1b[32m\x1b[1m  pareamento: ok\x1b[0m\n" : "\n\x1b[31m\x1b[1m  pareamento: FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
