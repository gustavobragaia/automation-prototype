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
  { nome: "Maria Silva", valor: 37.89, codigos: ["BR263500935831Z"], cep: "14647020" },
  { nome: "Maria Silva", valor: 13.0, codigos: ["BR262357370052B"], cep: "15800040" },
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
tudo &= ok(c4.estado === "ok-valor" && c4.codigo === "BR262357370052B",
           "nome repetido com valor diferente desempata no pedido certo");
const c5 = conciliarPedido({ nome: "Maria Silva", valor: 99.0 }, colhidos);
tudo &= ok(c5.estado === "ambiguo", "valor que não bate com nenhum não desempata");

sec("pedido da Shopify comprado em duas vezes na Shopee");
// caso real: #164925 valia R$ 88,30 e virou duas compras de R$ 58,41 e R$ 29,89,
// mesmo destinatário, mesmo CEP. Não são dois pedidos — são duas encomendas.
const duas = [
  { nome: "Jose Ernesto Camargo", valor: 58.41, cep: "01448010", codigos: ["BR262981565516C"] },
  { nome: "Jose Ernesto Camargo", valor: 29.89, cep: "01448010", codigos: ["BR269462194730E"] },
];
const d1 = conciliarPedido({ nome: "Jose Ernesto Camargo", valor: 88.3 }, duas);
tudo &= ok(d1.estado === "ok-partes" && resolvido(d1.estado), "soma exata resolve como um pedido só");
tudo &= ok(d1.partes?.length === 2 && d1.codigo.includes("BR262981565516C") && d1.codigo.includes("BR269462194730E"),
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
const um = montarEntrada({ fulfillmentOrderId: "gid://1", codigos: ["BR263500935831Z"], transportadora: "Correios", notificar: false });
tudo &= ok(um.trackingInfo.number === "BR263500935831Z" && !um.trackingInfo.numbers, "um código usa 'number'");
tudo &= ok(um.notifyCustomer === false, "notificar falso é respeitado");
const dois = montarEntrada({ fulfillmentOrderId: "gid://1", codigos: ["BR263500935831Z", "SPXLM17485496"], transportadora: "Outros" });
tudo &= ok(dois.trackingInfo.numbers?.length === 2 && dois.trackingInfo.urls?.length === 2, "dois códigos usam 'numbers' + 'urls'");
let errou = false;
try { montarEntrada({ fulfillmentOrderId: null, codigos: ["BR263500935831Z"] }); } catch { errou = true; }
tudo &= ok(errou, "sem fulfillment order, falha antes de chamar a Shopify");
errou = false;
try { montarEntrada({ fulfillmentOrderId: "gid://1", codigos: [] }); } catch { errou = true; }
tudo &= ok(errou, "sem código, falha antes de chamar a Shopify");

sec("transportadora e link de rastreio");
tudo &= ok(transportadoraDe(["SPXLM17485496"]) === "Shopee Xpress", "código SPX é Shopee Xpress");
tudo &= ok(transportadoraDe(["BR263500935831Z"]) === "Correios", "código BR é Correios");
tudo &= ok(transportadoraDe(["BR263500935831Z", "SPXLM17485496"]) === "Outros", "misturado é Outros");
tudo &= ok(urlRastreio("SPXLM17485496").includes("spx.com.br"), "link do SPX aponta para a Shopee Xpress");
tudo &= ok(urlRastreio("BR263500935831Z").includes("correios"), "link do BR aponta para os Correios");

sec("escopos pedidos");
tudo &= ok(ESCOPOS.includes("write_merchant_managed_fulfillment_orders"),
           "pede o escopo que o fulfillmentCreateV2 exige");

console.log(tudo ? "\n\x1b[32m\x1b[1m  regras da Shopify ok\x1b[0m\n" : "\n\x1b[31m  FALHOU\x1b[0m\n");
process.exit(tudo ? 0 : 1);
