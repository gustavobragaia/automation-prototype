// Troca o link de rastreio dos pedidos que o robô JÁ escreveu na Shopify.
//
// Até a 0.1.12 o link ia para rastreamento.correios.com.br, que parou de
// funcionar (formulário vazio com captcha), e a transportadora ia como
// "Correios" para códigos da Shopee Express. A Chomps pediu o parcelsapp
// (26/10/2026). Os pedidos novos já saem certos; estes são os antigos.
//
// Cuidados, cada um de um teste na loja de teste (26/10):
//   - a Shopify SUBSTITUI o rastreio inteiro ao atualizar: mandar 1 de 2
//     códigos apagou o outro. Então lê o pedido e reenvia TODOS os códigos;
//   - só troca link QUEBRADO (Correios, SPX, vazio). Link que alguém pôs à
//     mão fica como está;
//   - só mexe no que o robô escreveu (o registro de escritas), nunca nos
//     pedidos que a pessoa processou na Shopify;
//   - sem avisar o cliente final;
//   - rodar de novo não muda nada (o que já está certo é pulado).
import { graphql, urlRastreio, transportadoraDe } from "./shopify.mjs";
import { lerRegistro } from "./escrita.mjs";

const LINK_QUEBRADO = /rastreamento\.correios\.com\.br|correios\.com\.br\/rastreamento|spx\.com\.br\/track/i;
const quebrado = (url) => !url || LINK_QUEBRADO.test(url);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const LER = `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Fulfillment {
  id status order { name } trackingInfo { number url company } } } }`;
const ATUALIZAR = `mutation($id: ID!, $t: FulfillmentTrackingInput!) {
  fulfillmentTrackingInfoUpdate(fulfillmentId: $id, trackingInfoInput: $t, notifyCustomer: false) {
    fulfillment { id trackingInfo { number url company } } userErrors { field message } } }`;

// A Shopify limita o ritmo ("THROTTLED"): espera e tenta de novo.
async function comPaciencia(fn, { pausa = dormir, vezes = 6 } = {}) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (!/THROTTLED|HTTP 429|HTTP 5\d\d/.test(e.message) || i >= vezes) throw e;
      await pausa(1000 * 2 ** (i - 1));
    }
  }
}

/**
 * O que seria trocado, sem trocar nada.
 * @returns {{ aCorrigir: {fulfillmentId, pedido, de, para}[], jaCertos, cancelados, naoAchados, total }}
 */
export async function planejarCorrecao({ conexao, registro = lerRegistro(), pausa, lote = 50 } = {}) {
  const ids = [...new Set(Object.values(registro).map((r) => r?.fulfillmentId).filter(Boolean))];
  const aCorrigir = []; let jaCertos = 0, cancelados = 0, naoAchados = 0;
  for (let i = 0; i < ids.length; i += lote) {
    const parte = ids.slice(i, i + lote);
    const d = await comPaciencia(() => graphql(LER, { ids: parte }, { conexao }), { pausa });
    parte.forEach((id, k) => {
      const f = d.nodes?.[k];
      if (!f?.id) { naoAchados++; return; }
      if (f.status === "CANCELLED" || f.status === "ERROR" || f.status === "FAILURE") { cancelados++; return; }
      const infos = f.trackingInfo ?? [];
      if (!infos.length || !infos.some((t) => quebrado(t.url))) { jaCertos++; return; }
      const numeros = infos.map((t) => t.number);
      const urls = infos.map((t) => (quebrado(t.url) ? urlRastreio(t.number) : t.url));
      aCorrigir.push({ fulfillmentId: f.id, pedido: f.order?.name ?? "",
        de: infos.map((t) => ({ number: t.number, url: t.url, company: t.company })),
        para: { numbers: numeros, urls, company: transportadoraDe(numeros) } });
    });
  }
  return { aCorrigir, jaCertos, cancelados, naoAchados, total: ids.length };
}

/** Troca, um pedido por vez. Devolve o que deu certo e o que falhou, com o motivo. */
export async function corrigirLinks(plano, { conexao, aoProgresso = () => {}, pausa } = {}) {
  let corrigidos = 0; const falhas = [];
  for (const [i, item] of plano.aCorrigir.entries()) {
    try {
      const d = await comPaciencia(() => graphql(ATUALIZAR, { id: item.fulfillmentId, t: item.para }, { conexao }), { pausa });
      const r = d.fulfillmentTrackingInfoUpdate;
      if (r.userErrors?.length) throw new Error(r.userErrors.map((u) => u.message).join("; "));
      // confere o que ficou gravado: nenhum código pode ter sumido
      const ficou = (r.fulfillment?.trackingInfo ?? []).map((t) => t.number).sort().join();
      if (ficou !== [...item.para.numbers].sort().join())
        throw new Error(`a Shopify gravou outros códigos (${ficou || "nenhum"})`);
      corrigidos++;
    } catch (e) {
      falhas.push({ pedido: item.pedido, erro: e.message });
    }
    aoProgresso({ feitos: i + 1, total: plano.aCorrigir.length, corrigidos, falhas: falhas.length });
  }
  return { corrigidos, falhas };
}
