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

// ── Pareamento pelo total do cliente ────────────────────────────────────
//
// Um cliente com DOIS pedidos na Shopify na mesma conta (EDESIO, conta 162:
// #165172 R$ 36,56 e #165173 R$ 12,90) e duas compras na Shopee (R$ 34,80 e
// R$ 14,66). Nenhum valor bate sozinho — as compras foram feitas juntas e a
// Shopee rateia frete e desconto de outro jeito —, mas a SOMA bate exata
// (49,46). Antes os dois viravam "dois candidatos" na conferência.
//
// O robô pareia quando dá para ter certeza:
//   - o total da planilha bate com o total das compras (até R$ 0,05);
//   - toda compra tem rastreio, e todo pedido fica com pelo menos uma;
//   - o melhor pareamento é CLARAMENTE melhor que o segundo (R$ 0,50 de
//     folga). Valores iguais (HAROLDO: 31,99 + 31,99) empatam e ficam para
//     a pessoa — escrever o rastreio no pedido errado é pior que perguntar.
// Mais compras que pedidos (pedido de 2 produtos comprados separados) entra
// no mesmo cálculo, exigindo também o mesmo CEP nas compras.
const FOLGA_PAREAMENTO = 0.5;
const MAX_COMPRAS_PAREAMENTO = 7;

const numeroDo = (p) => String(p?.pedido ?? "").match(/(\d{3,})/)?.[1] ?? String(p?.pedido ?? "");

/**
 * O melhor jeito de dividir as compras entre os pedidos, se for claro.
 *
 * "Claro" é: nenhuma divisão REALMENTE diferente fica a menos de R$ 0,50 da
 * melhor. Trocar os rastreios entre dois pedidos de mesmo valor do mesmo
 * cliente não é uma divisão diferente — dá o mesmo resultado, para a mesma
 * pessoa, no mesmo endereço. Antes isso contava como empate e o par ficava
 * para sempre na conferência: na Chomps, 54 dos 67 pedidos que o Matheus
 * resolveu à mão na Shopify eram pares assim (GEORGINA MARIA, conta 220:
 * #165569 e #165570, R$ 23,99 cada). Nesses, o 1º pedido fica com a 1ª
 * compra feita na Shopee (`criadoEm`), e o resultado vem com `gemeos`.
 *
 * Empate de verdade continua para a pessoa: valores que não decidem
 * (30 + 20,2 contra 25 + 25,2), ou compras que mudam de pedido entre pedidos
 * de valores DIFERENTES — mesmo que as compras tenham o mesmo valor.
 *
 * @param pedidos [{ valor, numero? }]   @param compras [{ valor, criadoEm?, orderId? }]
 * @returns null | number[]  (para cada compra, o índice do pedido; `.gemeos`
 *          quando houve pedidos/compras intercambiáveis)
 */
export function pareamentoClaro(pedidos, compras) {
  const n = pedidos.length, m = compras.length;
  if (!n || m < n || m > MAX_COMPRAS_PAREAMENTO) return null;
  if (pedidos.some((p) => p.valor == null) || compras.some((c) => c.valor == null)) return null;
  const total = (xs) => xs.reduce((t, x) => t + Number(x.valor), 0);
  if (Math.abs(total(pedidos) - total(compras)) > TOLERANCIA_SOMA) return null;

  const centavos = (v) => Math.round(Number(v) * 100);
  const custoDe = (atual) => {
    const somas = new Array(n).fill(0), qtd = new Array(n).fill(0);
    atual.forEach((i, k) => { somas[i] += Number(compras[k].valor); qtd[i]++; });
    if (qtd.some((q) => q === 0)) return null;          // todo pedido fica com alguma
    return somas.reduce((t, s, i) => t + Math.abs(s - Number(pedidos[i].valor)), 0);
  };
  // O que cada divisão "entrega": para cada valor de pedido, QUAIS compras
  // cada pedido daquele valor recebe. Duas divisões com a mesma assinatura só
  // diferem por trocar os rastreios entre pedidos de valor idêntico. Compras
  // de mesmo valor NÃO são intercambiáveis: duas compras de R$ 25 podem ser
  // produtos diferentes, e trocá-las entre um pedido de R$ 30 e um de R$ 20
  // seria escrever errado.
  // "Mesmo valor" é até R$ 0,05 de diferença (a mesma tolerância das somas):
  // #165264/#165265 são R$ 19,49 e R$ 19,50 — o mesmo produto, arredondado.
  const ordemValor = pedidos.map((_, i) => i).sort((a, b) => Number(pedidos[a].valor) - Number(pedidos[b].valor));
  const classe = new Array(n);
  ordemValor.forEach((i, pos) => {
    const anterior = ordemValor[pos - 1];
    classe[i] = pos > 0 && Number(pedidos[i].valor) - Number(pedidos[anterior].valor) <= TOLERANCIA_SOMA + 1e-9
      ? classe[anterior] : centavos(pedidos[i].valor);
  });
  const assinatura = (atual) => {
    const porPedido = pedidos.map(() => []);
    atual.forEach((i, k) => porPedido[i].push(k));
    const porValor = new Map();
    porPedido.forEach((vs, i) => {
      const chave = classe[i];
      if (!porValor.has(chave)) porValor.set(chave, []);
      porValor.get(chave).push(vs.sort((a, b) => a - b).join("+"));
    });
    return [...porValor].sort((a, b) => a[0] - b[0]).map(([v, l]) => `${v}:${l.sort().join("|")}`).join(";");
  };
  const todas = (fn) => {
    const atual = new Array(m).fill(0);
    const ir = (k) => { if (k === m) return fn(atual); for (let i = 0; i < n; i++) { atual[k] = i; ir(k + 1); } };
    ir(0);
  };

  let custoMelhor = Infinity;
  todas((a) => { const c = custoDe(a); if (c != null && c < custoMelhor) custoMelhor = c; });
  if (custoMelhor === Infinity) return null;

  // A ordem das compras e dos pedidos, para escolher entre divisões
  // equivalentes: o pedido de número menor fica com a compra mais antiga.
  const rankCompra = compras.map((c, k) => k)
    .sort((a, b) => (Number(compras[a].criadoEm) || 0) - (Number(compras[b].criadoEm) || 0) ||
                    String(compras[a].orderId ?? "").localeCompare(String(compras[b].orderId ?? "")) || a - b);
  const posCompra = new Array(m); rankCompra.forEach((k, pos) => { posCompra[k] = pos; });
  const ordemPedido = pedidos.map((p, i) => i)
    .sort((a, b) => String(pedidos[a].numero ?? "").localeCompare(String(pedidos[b].numero ?? ""), undefined, { numeric: true }) || a - b);
  const chaveCronologica = (atual) => ordemPedido.map((i) =>
    Math.min(...atual.map((pi, k) => (pi === i ? posCompra[k] : Infinity)))).join(",");

  // Toda divisão a menos de R$ 0,50 da melhor tem que ENTREGAR o mesmo que
  // ela (mesma assinatura); senão é dúvida de verdade. Divisões equivalentes
  // têm exatamente o mesmo custo, então uma um pouco mais cara já cai aqui.
  let melhor = null, chaveMelhor = null, assinaturaMelhor = null, alternativas = 0, duvida = false;
  todas((a) => {
    if (duvida) return;
    const c = custoDe(a);
    if (c == null || c >= custoMelhor + FOLGA_PAREAMENTO) return;
    const sig = assinatura(a);
    if (assinaturaMelhor === null) assinaturaMelhor = sig;
    else if (sig !== assinaturaMelhor) { duvida = true; return; }
    alternativas++;
    const chave = chaveCronologica(a);
    if (!melhor || chave.localeCompare(chaveMelhor, undefined, { numeric: true }) < 0) { melhor = [...a]; chaveMelhor = chave; }
  });
  if (duvida || !melhor) return null;
  if (alternativas > 1) melhor.gemeos = true;
  return melhor;
}

function parearPorCliente(linhas, coletas) {
  const grupos = new Map();
  for (const l of linhas) {
    if (!(l.estado === "ambiguo" || RESOLVIDO.has(l.estado))) continue;
    const chave = `${l.conta}|${normNome(l.p.nome)}`;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(l);
  }
  for (const doGrupo of grupos.values()) {
    const temDuvida = doGrupo.some((l) => l.estado === "ambiguo");
    // o mesmo rastreio em dois pedidos diferentes também precisa ser refeito
    const donoDe = new Map(); let conflito = false;
    for (const l of doGrupo) for (const c of String(l.codigo || "").split(" · ").filter(Boolean)) {
      if (donoDe.has(c) && donoDe.get(c) !== numeroDo(l.p)) conflito = true;
      donoDe.set(c, numeroDo(l.p));
    }
    if (!temDuvida && !conflito) continue;

    const { conta, p } = doGrupo[0];
    const compras = (coletas.get(conta) ?? []).filter((c) => normNome(c.nome) === normNome(p.nome));
    if (!compras.length || !compras.every((c) => c.codigos?.length)) { if (conflito) emDuvida(doGrupo, compras); else tirarUsados(doGrupo); continue; }
    // pedido em várias linhas (2 produtos) é um pedido só
    const porNumero = new Map();
    for (const l of doGrupo) {
      const num = numeroDo(l.p);
      if (!porNumero.has(num)) porNumero.set(num, { valor: l.p.valor ?? null, numero: num, linhas: [] });
      porNumero.get(num).linhas.push(l);
    }
    const pedidos = [...porNumero.values()];
    if (compras.length > pedidos.length) {
      const ceps = new Set(compras.map((c) => String(c.cep ?? "").replace(/\D/g, "")));
      if (ceps.size !== 1 || [...ceps][0] === "") { if (conflito) emDuvida(doGrupo, compras); else tirarUsados(doGrupo); continue; }
    }
    const par = pareamentoClaro(pedidos, compras);
    if (!par) { if (conflito) emDuvida(doGrupo, compras); else tirarUsados(doGrupo); continue; }
    pedidos.forEach((ped, i) => {
      const minhas = compras.filter((_, k) => par[k] === i);
      for (const l of ped.linhas) {
        l.estado = minhas.length > 1 ? "ok-partes" : "ok-total";
        l.achado = minhas[0];
        l.partes = minhas.length > 1 ? minhas : undefined;
        l.codigo = minhas.flatMap((c) => c.codigos).join(" · ");
        l.candidatos = compras.length;
        // pedidos iguais do mesmo cliente: qual rastreio vai em qual foi
        // pela ordem da compra na Shopee (ver pareamentoClaro)
        if (par.gemeos) l.gemeos = true; else delete l.gemeos;
        delete l.motivo;
      }
    });
  }
}

// Rastreio que já foi para outro pedido do mesmo cliente não pode ser
// oferecido de novo na conferência: um clique o escreveria em dois pedidos.
function tirarUsados(doGrupo) {
  const usados = new Set(doGrupo.filter((l) => RESOLVIDO.has(l.estado))
    .flatMap((l) => String(l.codigo || "").split(" · ").filter(Boolean)));
  if (!usados.size) return;
  for (const l of doGrupo) {
    if (l.estado !== "ambiguo" || !l.motivo?.candidatos) continue;
    l.motivo = { ...l.motivo, candidatos: l.motivo.candidatos.filter((c) => !(c.codigos ?? []).some((x) => usados.has(x))) };
  }
}

// Conflito sem pareamento claro: vira dúvida, com os candidatos para escolher.
function emDuvida(doGrupo, compras) {
  for (const l of doGrupo) {
    l.estado = "ambiguo"; l.achado = null; l.codigo = "";
    l.motivo = motivoDe("ambiguo", { candidatos: compras.map((c) => ({
      codigos: c.codigos ?? [], valor: c.valor ?? null, cep: c.cep ?? null, orderId: c.orderId ?? null })) });
  }
}

// ── O que a conferência ainda precisa mostrar ────────────────────────────
//
// A conferência mostra a CARTEIRA: o que ficou pendente na rodada anterior.
// Se a conciliação de agora já resolve um desses pedidos (versão nova que
// pareia pelo total, coleta nova), ele não é mais dúvida — vai ser escrito
// na etapa 4. Mostrar mesmo assim fazia o Matheus decidir à mão o que o robô
// já sabia (EDESIO, 0.1.8, 21/10).
//
// Só saem os motivos que a PRÓPRIA conciliação cria. O que a Shopify barrou
// (nome que não confere, pedido que não existe na loja, recusa ao escrever)
// continua: a conciliação não enxerga a Shopify e não pode dar isso por
// resolvido.
const MOTIVOS_DA_CONCILIACAO = new Set(["ambiguo", "nao-achado-na-conta", "sem-rastreio-ainda", "conta-nao-lida"]);

export function separarJaResolvidos(pendentes, linhas) {
  const agora = new Map();
  for (const l of linhas) if (resolvido(l.estado) && l.codigo) agora.set(l.p.pedido, l);
  const ficam = [], resolvidos = [];
  for (const p of pendentes) {
    const l = agora.get(p.pedido);
    const motivo = typeof p.motivo === "string" ? p.motivo : p.motivo?.codigo;
    if (l && MOTIVOS_DA_CONCILIACAO.has(motivo) && Number(p.conta) === Number(l.conta))
      resolvidos.push({ pedido: p.pedido, conta: l.conta, codigo: l.codigo });
    else ficam.push(p);
  }
  return { ficam, resolvidos };
}

/**
 * Os candidatos são partes de um pedido só?
 * Exige os três ao mesmo tempo, porque qualquer um sozinho erra:
 * mesmo CEP, todos com código, e a soma batendo com a planilha.
 */
const TOLERANCIA_SOMA = 0.05;

export function pedidoDividido(pedido, candidatos) {
  if (candidatos.length < 2 || pedido.valor == null) return null;

  const ceps = new Set(candidatos.map((c) => (c.cep ?? "").replace(/\D/g, "")));
  if (ceps.size !== 1 || [...ceps][0] === "") return null;
  if (!candidatos.every((c) => c.codigos?.length)) return null;

  const soma = candidatos.reduce((t, c) => t + Number(c.valor ?? 0), 0);
  // Até R$ 0,05: a Shopee arredonda o rateio de frete e desconto entre as
  // compras, e um centavo a mais jogava o pedido para a conferência.
  if (Math.abs(soma - Number(pedido.valor)) > TOLERANCIA_SOMA) return null;

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
  "parte-pendente": {
    rotulo: "esperando a outra parte",
    grupo: "sozinho",
    texto: "Parte deste pedido foi comprada em outra conta (ou em outra linha) e ainda não tem rastreio, ou está em dúvida.",
    acao: "O robô escreve todos os rastreios juntos quando a outra parte ficar pronta. Se ela estiver em \"Precisa de você\", resolva lá.",
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

const RESOLVIDO = new Set(["ok", "ok-valor", "ok-partes", "ok-total"]);
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

  parearPorCliente(linhas, coletas);

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
