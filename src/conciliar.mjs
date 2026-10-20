// Conciliação: planilha do dia × o que foi colhido na Shopee.
//
// Uma implementação só, usada pelo relatório (conferir) e pela escrita na
// Shopify (agir). Se as duas divergirem, o relatório deixa de provar o que
// vai ser escrito — foi por isso que isso saiu de dentro do relatório.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { extrairPedido } from "./shopee.mjs";
import { normNome } from "./match.mjs";
import { DIR_COLETAS } from "./caminhos.mjs";

/** Lê captura/coletas/*.json e devolve Map<conta, pedidos extraídos>. */
export function lerColetas(dir = DIR_COLETAS) {
  const coletas = new Map();
  if (!existsSync(dir)) return coletas;

  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const d = JSON.parse(readFileSync(join(dir, f), "utf8"));
    const conta = Number(d.conta);
    if (!Number.isFinite(conta)) continue;
    const pedidos = (d.pedidos ?? []).filter((p) => p.bruto)
      .map((p) => extrairPedido(p.bruto, { orderId: p.orderId }));
    // Coleta em que NENHUMA lista de pedidos respondeu não é "a conta não
    // tem pedidos": é "a conta não foi lida". Tratar como lida foi o que fez
    // a conferência de 21/10 acusar 12 pedidos de "não achado na conta"
    // nas contas 125 e 150, cuja sessão da Shopee tinha caído.
    if (!pedidos.length && !colecaoRespondeu(d)) {
      pedidos.falhou = true;
      pedidos.pagina = d.pagina ?? null;
    }
    coletas.set(conta, pedidos);
  }
  return coletas;
}

/** Alguma lista de pedidos respondeu de verdade nesta coleta? */
export function colecaoRespondeu(d) {
  if ((d.listasBrutas ?? []).length) return true;
  return (d.listas ?? []).some((l) => l.ok === true);
}

/**
 * Para um pedido da planilha, acha o pedido correspondente na conta Shopee.
 *
 * Nunca devolve um palpite: se o nome empata e o valor não desempata, o
 * estado é "ambiguo" e ninguém escreve nada.
 *
 * @returns { estado, achado, codigo, candidatos }
 *   estado: ok | ok-valor | ambiguo | sem-codigo | nao-achado
 */
export function conciliarPedido(pedido, colhidos) {
  const iguais = colhidos.filter((c) => normNome(c.nome) === normNome(pedido.nome));

  if (iguais.length === 0)
    return { estado: "nao-achado", achado: null, codigo: "", candidatos: 0 };

  if (iguais.length === 1) {
    const achado = iguais[0];
    return achado.codigos.length
      ? { estado: "ok", achado, codigo: achado.codigos.join(" · "), candidatos: 1 }
      : { estado: "sem-codigo", achado, codigo: "", candidatos: 1 };
  }

  // nome repetido na mesma conta -> desempata por valor
  const porValor = iguais.filter((c) => pedido.valor != null && Math.abs(c.valor - pedido.valor) < 0.01);
  if (porValor.length === 1 && porValor[0].codigos.length)
    return { estado: "ok-valor", achado: porValor[0], codigo: porValor[0].codigos.join(" · "), candidatos: iguais.length };

  // UM pedido da Shopify pode ter virado DUAS compras na Shopee — vendedores
  // diferentes, entregas separadas. Aí os candidatos não competem: são partes
  // do mesmo pedido. A assinatura é o mesmo destinatário, o mesmo CEP, e os
  // valores SOMANDO o valor da planilha. Os códigos vão juntos no mesmo
  // fulfillment, que a Shopify aceita.
  const partes = pedidoDividido(pedido, iguais);
  if (partes)
    return {
      estado: "ok-partes",
      achado: partes[0],
      partes,
      codigo: partes.flatMap((p) => p.codigos).join(" · "),
      candidatos: iguais.length,
    };

  // `iguais` vai junto: sem a lista, a tela pede para a pessoa escolher
  // entre dois pedidos sem conseguir mostrar quais são os dois.
  return { estado: "ambiguo", achado: null, codigo: "",
           candidatos: iguais.length, iguais };
}

/**
 * Os candidatos são partes de um pedido só?
 * Exige os três ao mesmo tempo, porque qualquer um sozinho erra:
 * mesmo CEP, todos com código, e a soma batendo com a planilha.
 */
export function pedidoDividido(pedido, candidatos) {
  if (candidatos.length < 2 || pedido.valor == null) return null;

  const ceps = new Set(candidatos.map((c) => (c.cep ?? "").replace(/\D/g, "")));
  if (ceps.size !== 1 || [...ceps][0] === "") return null;
  if (!candidatos.every((c) => c.codigos?.length)) return null;

  const soma = candidatos.reduce((t, c) => t + Number(c.valor ?? 0), 0);
  if (Math.abs(soma - Number(pedido.valor)) > 0.01) return null;

  return candidatos;
}

/**
 * Por que um pedido ficou sem rastreio.
 *
 * O `grupo` é a parte que importa: "sozinho" é o estado NORMAL de um pedido
 * pago hoje — a Shopee ainda não despachou, e amanhã resolve. Misturar isso
 * com o que precisa de decisão enche a conferência de ruído, e aí ninguém
 * abre mais a tela.
 *
 * O texto é escrito para o operador, não para quem programou: nada de código
 * de erro, e sempre com o que fazer.
 */
// `rotulo` é o nome curto que aparece na tacha colorida da conferência.
// Antes a tela mostrava o próprio código com os hífens trocados por espaço,
// e saía "nao achado na conta" e "ambiguo" na cara do cliente.
export const MOTIVOS = {
  "sem-rastreio-ainda": {
    rotulo: "ainda sem rastreio",
    grupo: "sozinho",
    texto: "O pedido está na conta, mas a Shopee ainda não despachou.",
    acao: "Nada a fazer. Volta sozinho na próxima rodada.",
  },
  "nao-achado-na-conta": {
    rotulo: "não achado na conta",
    grupo: "precisa",
    texto: "Nenhum pedido com esse cliente na conta indicada pela planilha.",
    acao: "Ou a compra foi feita em outra conta, ou a planilha aponta a conta errada.",
  },
  ambiguo: {
    rotulo: "dois candidatos",
    grupo: "precisa",
    texto: "Mais de um pedido do mesmo cliente na conta, e o valor não desempatou.",
    acao: "Escolha qual é o pedido certo.",
  },
  "nome-nao-confere": {
    rotulo: "nome não confere",
    grupo: "precisa",
    texto: "O número do pedido levou a um cliente diferente do que está na Shopee.",
    acao: "Costuma ser número digitado errado na planilha. Confira antes de escrever.",
  },
  "conta-nao-reconhecida": {
    rotulo: "conta não existe",
    grupo: "precisa",
    texto: "A conta escrita na planilha não existe.",
    acao: "Corrija a linha na planilha e suba de novo.",
  },
  "conta-sem-perfil": {
    rotulo: "conta sem perfil",
    grupo: "precisa",
    texto: "A conta não tem perfil vinculado no AdsPower.",
    acao: "Vincule o perfil na tela de Contas.",
  },
  "perfil-duplicado": {
    rotulo: "perfil repetido",
    grupo: "precisa",
    texto: "Duas contas apontam para o mesmo perfil do AdsPower.",
    acao: "Os cookies de uma sobrescrevem os da outra. Separe os perfis antes de rodar.",
  },
  "sem-numero-de-pedido": {
    rotulo: "sem número de pedido",
    grupo: "precisa",
    texto: "A linha tem rastreio, mas não tem número de pedido da Shopify.",
    acao: "Preencha a coluna NÚMERO DO PEDIDO e suba a planilha de novo.",
  },
  "nao-existe-na-loja": {
    rotulo: "não existe na loja",
    grupo: "precisa",
    texto: "Esse número de pedido não existe na loja conectada.",
    acao: "Confira o número na planilha, ou se a loja conectada é a certa.",
  },
  "sem-fulfillment-order": {
    rotulo: "sem entrega aberta",
    grupo: "precisa",
    texto: "O pedido existe mas não tem entrega aberta para receber o rastreio.",
    acao: "Costuma ser pedido já despachado ou cancelado na Shopify.",
  },
  "rastreio-nao-reconhecido": {
    rotulo: "rastreio ilegível",
    grupo: "precisa",
    texto: "O texto encontrado na Shopee não tem a cara de um código de rastreio.",
    acao: "Confira na Shopee o que está no lugar do código.",
  },
  "rastreio-simulado": {
    rotulo: "rastreio de teste",
    grupo: "precisa",
    texto: "O código veio marcado como simulado e foi recusado.",
    acao: "É proteção contra teste ligado por engano. Rode a coleta de novo.",
  },
  "falha-ao-escrever": {
    rotulo: "a Shopify recusou",
    grupo: "precisa",
    texto: "A Shopify recusou a escrita.",
    acao: "Nada foi gravado. Tente de novo; se repetir, veja a mensagem da Shopify.",
  },
  "conta-nao-lida": {
    rotulo: "conta não foi lida",
    grupo: "precisa",
    texto: "A coleta não conseguiu ler os pedidos desta conta — a sessão da Shopee caiu ou a " +
      "página foi bloqueada. Os pedidos dela NÃO foram procurados.",
    acao: "Rode a coleta de novo. Se repetir, abra o perfil da conta no AdsPower e entre na Shopee.",
  },
  "verificacao-humana": {
    rotulo: "a Shopee pediu você",
    grupo: "precisa",
    texto: "A Shopee pediu confirmação de que é uma pessoa.",
    acao: "Abra o navegador dessa conta e passe a verificação.",
  },
};

/** O motivo completo, pronto para gravar e para mostrar. */
export function motivoDe(codigo, extra = {}) {
  const m = MOTIVOS[codigo];
  if (!m) return { codigo, grupo: "precisa", texto: codigo, acao: "" };
  return { codigo, ...m, ...extra };
}

/** Estados que viram motivo, e qual. */
const MOTIVO_DO_ESTADO = {
  "sem-codigo": "sem-rastreio-ainda",
  "nao-achado": "nao-achado-na-conta",
  ambiguo: "ambiguo",
};

/**
 * Onde mais esse cliente aparece? Para o caso de a planilha apontar a conta
 * errada — o operador não tem como caçar um nome em 80 contas.
 */
export function sugerirContas(nome, coletas, exceto) {
  const alvo = normNome(nome);
  if (!alvo) return [];
  const achados = [];
  for (const [conta, colhidos] of coletas) {
    if (conta === exceto) continue;
    for (const c of colhidos)
      if (normNome(c.nome) === alvo) achados.push({ conta, pedido: c });
  }
  return achados;
}

const RESOLVIDO = new Set(["ok", "ok-valor", "ok-partes"]);
export const resolvido = (estado) => RESOLVIDO.has(estado);

/**
 * Concilia a planilha inteira contra as coletas.
 * @param contas saída de lerPendentes().contas
 * @returns { linhas, resumo }
 */
export function conciliar(contas, coletas) {
  const porConta = new Map(contas.map((c) => [c.conta, c.pedidos]));
  const linhas = [];

  // Conta da planilha que não foi lida: cada pedido dela vira pendência com
  // o motivo certo. Antes, conta sem coleta simplesmente sumia da rodada —
  // nem escrita, nem conferência, nem carteira.
  for (const [conta, pedidos] of [...porConta].sort((a, b) => a[0] - b[0])) {
    const c = coletas.get(conta);
    if (c && !c.falhou) continue;
    for (const p of pedidos ?? [])
      linhas.push({ conta, p, estado: "nao-lida", achado: null, codigo: "", candidatos: 0,
        motivo: motivoDe("conta-nao-lida", c?.pagina ? { pagina: c.pagina } : {}) });
  }

  for (const [conta, colhidos] of [...coletas].sort((a, b) => a[0] - b[0])) {
    if (colhidos.falhou) continue;   // já virou "conta não foi lida" acima
    for (const p of porConta.get(conta) ?? []) {
      const r = conciliarPedido(p, colhidos);
      const codigo = MOTIVO_DO_ESTADO[r.estado];
      const linha = { conta, p, ...r };
      if (codigo) {
        // onde mais esse cliente aparece, para o caso de conta errada
        const onde = codigo === "nao-achado-na-conta"
          ? sugerirContas(p.nome, coletas, conta) : [];
        const extra = {};
        if (onde.length) extra.sugestoes = onde;
        // Os dois candidatos do empate, para a tela poder mostrá-los.
        if (r.estado === "ambiguo" && r.iguais?.length)
          extra.candidatos = r.iguais.map((c) => ({
            codigos: c.codigos ?? [], valor: c.valor ?? null,
            cep: c.cep ?? null, orderId: c.orderId ?? null }));
        linha.motivo = motivoDe(codigo, extra);
      }
      linhas.push(linha);
    }
  }

  const resumo = { total: linhas.length, casados: 0, ambiguos: 0, semCodigo: 0, naoAchados: 0,
                   precisaDeVoce: 0, seResolveSozinho: 0 };
  for (const l of linhas) {
    if (resolvido(l.estado)) resumo.casados++;
    else if (l.estado === "ambiguo") resumo.ambiguos++;
    else if (l.estado === "sem-codigo") resumo.semCodigo++;
    else resumo.naoAchados++;
    // o número que vai para a tela é este: o outro grupo não pede nada
    if (l.motivo?.grupo === "precisa") resumo.precisaDeVoce++;
    else if (l.motivo?.grupo === "sozinho") resumo.seResolveSozinho++;
  }
  return { linhas, resumo };
}
