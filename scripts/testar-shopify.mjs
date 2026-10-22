// Testa o que decide se um rastreio vai ser escrito ou não.
// Sem rede: aqui só entram as regras, não a API da Shopify.

import { normalizarLoja, ESCOPOS } from "../src/shopify-conexao.mjs";
import { normalizarNumero, montarEntrada, urlRastreio, transportadoraDe } from "../src/shopify.mjs";
import { conciliarPedido, resolvido, pedidoDividido } from "../src/conciliar.mjs";

const ok = (c, m) => console.log(c ? `  \x1b[32m✓\x1b[0m ${m}` : `  \x1b[31m✗ ${m}\x1b[0m`) || c;
const sec = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
let tudo = true;

sec("endereço da loja");
tudo &= ok(normalizarLoja("minhaloja") === "minhaloja.myshopify.com", "nome curto ganha o domínio");
tudo &= ok(normalizarLoja("https://minhaloja.myshopify.com/admin/orders") === "minhaloja.myshopify.com",
           "URL colada do admin vira só o domínio");
tudo &= ok(normalizarLoja("MinhaLoja.MyShopify.com") === "minhaloja.myshopify.com", "maiúsculas não importam");
tudo &= ok(normalizarLoja("loja.com.br") === null, "domínio que não é myshopify é recusado");
tudo &= ok(normalizarLoja("") === null && normalizarLoja(null) === null, "vazio é recusado");

sec("número do pedido na planilha");
tudo &= ok(normalizarNumero("Pedido #164891") === "164891", 'extrai de "Pedido #164891"');
tudo &= ok(normalizarNumero("#164891") === "164891", "extrai com cerquilha");
tudo &= ok(normalizarNumero("164891") === "164891", "extrai do número puro");
tudo &= ok(normalizarNumero("entregue") === null, "texto sem número não vira pedido");
tudo &= ok(normalizarNumero(undefined) === null, "indefinido não vira pedido");

sec("nunca escrever sob dúvida");
const colhidos = [
  { nome: "Maria Silva", valor: 37.89, codigos: ["BR260000000005X"], cep: "14647020" },
  { nome: "Maria Silva", valor: 13.0, codigos: ["BR260000000003X"], cep: "15800040" },
  { nome: "Joao Souza", valor: 21.9, codigos: [], cep: "18903066" },
];
const c1 = conciliarPedido({ nome: "João Souza", valor: 21.9 }, colhidos);
tudo &= ok(c1.estado === "sem-codigo" && !resolvido(c1.estado), "achado sem rastreio não é resolvido");
const c2 = conciliarPedido({ nome: "Ana Lima", valor: 10 }, colhidos);
tudo &= ok(c2.estado === "nao-achado" && !resolvido(c2.estado), "quem não está na conta não é resolvido");
const c3 = conciliarPedido({ nome: "maria  silva", valor: null }, colhidos);
tudo &= ok(c3.estado === "ambiguo" && c3.candidatos === 2 && !c3.achado,
           "nome repetido sem valor para desempatar vira ambíguo, sem palpite");
const c4 = conciliarPedido({ nome: "MARIA SILVA", valor: 13.0 }, colhidos);
tudo &= ok(c4.estado === "ok-valor" && c4.codigo === "BR260000000003X",
           "nome repetido com valor diferente desempata no pedido certo");
const c5 = conciliarPedido({ nome: "Maria Silva", valor: 99.0 }, colhidos);
tudo &= ok(c5.estado === "ambiguo", "valor que não bate com nenhum não desempata");

sec("pedido da Shopify comprado em duas vezes na Shopee");
// caso real: #164925 valia R$ 88,30 e virou duas compras de R$ 58,41 e R$ 29,89,
// mesmo destinatário, mesmo CEP. Não são dois pedidos — são duas encomendas.
const duas = [
  { nome: "Joel Fictício Campos", valor: 58.41, cep: "01448010", codigos: ["BR260000000004X"] },
  { nome: "Joel Fictício Campos", valor: 29.89, cep: "01448010", codigos: ["BR260000000008X"] },
];
const d1 = conciliarPedido({ nome: "Joel Fictício Campos", valor: 88.3 }, duas);
tudo &= ok(d1.estado === "ok-partes" && resolvido(d1.estado), "soma exata resolve como um pedido só");
tudo &= ok(d1.partes?.length === 2 && d1.codigo.includes("BR260000000004X") && d1.codigo.includes("BR260000000008X"),
           "os dois códigos vão juntos, nenhum fica para trás");

tudo &= ok(pedidoDividido({ valor: 88.3 }, [
    { valor: 58.41, cep: "01448010", codigos: ["A"] },
    { valor: 29.89, cep: "99999000", codigos: ["B"] }]) === null,
           "CEP diferente não é pedido dividido, é cliente homônimo");
tudo &= ok(pedidoDividido({ valor: 90.0 }, [
    { valor: 58.41, cep: "01448010", codigos: ["A"] },
    { valor: 29.89, cep: "01448010", codigos: ["B"] }]) === null,
           "soma que não fecha não resolve");
tudo &= ok(pedidoDividido({ valor: 88.3 }, [
    { valor: 58.41, cep: "01448010", codigos: ["A"] },
    { valor: 29.89, cep: "01448010", codigos: [] }]) === null,
           "se uma das partes não tem rastreio, não escreve nada");
tudo &= ok(pedidoDividido({ valor: null }, [
    { valor: 58.41, cep: "01448010", codigos: ["A"] },
    { valor: 29.89, cep: "01448010", codigos: ["B"] }]) === null,
           "sem valor na planilha não dá para somar");
tudo &= ok(pedidoDividido({ valor: 88.3 }, [
    { valor: 88.3, cep: "", codigos: ["A"] },
    { valor: 0, cep: "", codigos: ["B"] }]) === null,
           "CEP vazio nos dois não serve de prova");

sec("montagem do fulfillment");
const um = montarEntrada({ fulfillmentOrderId: "gid://1", codigos: ["BR260000000005X"], transportadora: "Correios", notificar: false });
tudo &= ok(um.trackingInfo.number === "BR260000000005X" && !um.trackingInfo.numbers, "um código usa 'number'");
tudo &= ok(um.notifyCustomer === false, "notificar falso é respeitado");
const dois = montarEntrada({ fulfillmentOrderId: "gid://1", codigos: ["BR260000000005X", "SPXLM10000001"], transportadora: "Outros" });
tudo &= ok(dois.trackingInfo.numbers?.length === 2 && dois.trackingInfo.urls?.length === 2, "dois códigos usam 'numbers' + 'urls'");
let errou = false;
try { montarEntrada({ fulfillmentOrderId: null, codigos: ["BR260000000005X"] }); } catch { errou = true; }
tudo &= ok(errou, "sem fulfillment order, falha antes de chamar a Shopify");
errou = false;
try { montarEntrada({ fulfillmentOrderId: "gid://1", codigos: [] }); } catch { errou = true; }
tudo &= ok(errou, "sem código, falha antes de chamar a Shopify");

sec("transportadora e link de rastreio");
tudo &= ok(transportadoraDe(["SPXLM10000001"]) === "Shopee Xpress", "código SPX é Shopee Xpress");
tudo &= ok(transportadoraDe(["BR260000000005X"]) === "Correios", "código BR é Correios");
tudo &= ok(transportadoraDe(["BR260000000005X", "SPXLM10000001"]) === "Outros", "misturado é Outros");
tudo &= ok(urlRastreio("SPXLM10000001").includes("spx.com.br"), "link do SPX aponta para a Shopee Xpress");
tudo &= ok(urlRastreio("BR260000000005X").includes("correios"), "link do BR aponta para os Correios");

sec("uma implementação só");
// O bug que isto previne: o ciclo de produção tinha a PRÓPRIA função de
// casamento, pior que a provada, e ninguém percebia porque o relatório
// media a outra.
import { readFileSync } from "node:fs";
const ciclo = readFileSync(new URL("../src/ciclo.mjs", import.meta.url), "utf8");
tudo &= ok(/escreverRastreios/.test(ciclo), "o ciclo de produção usa escreverRastreios");
tudo &= ok(!/function casar\s*\(/.test(ciclo), "o ciclo não tem mais função de casamento própria");
tudo &= ok(!/pedidosAbertos/.test(ciclo), "o ciclo não casa mais contra os pedidos abertos da loja");

const escrita = readFileSync(new URL("../src/escrita.mjs", import.meta.url), "utf8");
tudo &= ok(/PARECE_SIMULADO/.test(escrita), "a proteção contra rastreio simulado sobreviveu à unificação");
tudo &= ok(/normalizarNumero/.test(escrita), "a escrita busca o pedido pelo número, não por nome");
tudo &= ok(/normNome\(x\.achado\?\.nome \?\? x\.p\.nome\) !== naLoja/.test(escrita) && /divergentes\.length/.test(escrita),
           "a conferência de nome continua barrando antes de escrever (em todas as linhas do pedido)");
tudo &= ok(/registro\[num\]\?\.fulfillmentId/.test(escrita), "a idempotência continua no caminho único");

sec("só sai da carteira o que a Shopify aceitou");
// Já aconteceu: quem decidia era `planejado`, a lista do que IA ser escrito.
// Pedido recusado pela Shopify saía da carteira e sumia no dia seguinte.
tudo &= ok(/const gravados = \[\]/.test(escrita), "a escrita acumula o que foi gravado de fato");
tudo &= ok(/gravados\.push/.test(escrita), "e só depois do enviar() dar certo");
const cicloTxt = readFileSync(new URL("../src/ciclo.mjs", import.meta.url), "utf8");
tudo &= ok(/baixarPendentes\([^;]*res\.gravados/.test(cicloTxt),
           "o ciclo baixa pela lista de gravados (e dos já atendidos), não pela de planejados");
tudo &= ok(!/baixarPendentes\([^)]*planejado/.test(cicloTxt),
           "e não usa planejado em lugar nenhum para baixar");

sec("todo motivo é apresentável");
import { MOTIVOS } from "../src/conciliar.mjs";
const ruins = Object.entries(MOTIVOS).filter(([, m]) =>
  !m.grupo || !["precisa", "sozinho"].includes(m.grupo) || !m.texto || !m.acao);
tudo &= ok(ruins.length === 0, `os ${Object.keys(MOTIVOS).length} motivos têm grupo, texto e ação`);
const usados = [...escrita.matchAll(/anotar\(l, "([a-z-]+)"/g)].map((m) => m[1]);
const semCadastro = usados.filter((c) => !MOTIVOS[c]);
tudo &= ok(semCadastro.length === 0,
  `os ${new Set(usados).size} motivos usados na escrita estão cadastrados${semCadastro.length ? ": falta " + semCadastro.join(", ") : ""}`);

sec("escopos pedidos");
tudo &= ok(ESCOPOS.includes("write_merchant_managed_fulfillment_orders"),
           "pede o escopo que o fulfillmentCreateV2 exige");

console.log(tudo ? "\n\x1b[32m\x1b[1m  regras da Shopify ok\x1b[0m\n" : "\n\x1b[31m  FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
