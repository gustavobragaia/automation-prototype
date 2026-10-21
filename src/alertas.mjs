// Alertas: os erros que a pessoa precisa saber, ditos com todas as letras.
//
// Não é o log nem a conferência. É o que impede o robô de fazer o trabalho e
// que só uma pessoa resolve: a cota da caixa de e-mail acabou, a senha das
// contas está errada, uma conta parou esperando alguém. Antes isso aparecia
// só como efeito — "nada chegou ao coletor em 150s", "código não chegou" — e
// a causa ficava enterrada no log.
//
// Cada alerta tem um `id` estável: o mesmo problema acontecendo 30 vezes é UM
// alerta com `vezes: 30`, não trinta. E some sozinho quando o problema some
// (`resolver`), para o sino não virar ruído que a pessoa aprende a ignorar.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { emEstado } from "./caminhos.mjs";
import { emitir } from "./eventos.mjs";

const arquivo = () => emEstado("alertas.json");
const MAX = 50;

function ler() {
  try { return JSON.parse(readFileSync(arquivo(), "utf8")); } catch { return []; }
}
function gravar(lista) {
  try {
    mkdirSync(dirname(arquivo()), { recursive: true });
    writeFileSync(arquivo(), JSON.stringify(lista.slice(0, MAX), null, 2));
  } catch { /* alerta que não grava ainda aparece na tela desta abertura */ }
}

/**
 * Levanta (ou renova) um alerta.
 * @param {{id:string, nivel:"erro"|"atencao", titulo:string, texto:string,
 *          acao?:string, ir?:string, conta?:number}} a
 */
export function alertar(a) {
  const lista = ler();
  const agora = Date.now();
  const i = lista.findIndex((x) => x.id === a.id);
  const novo = i < 0;
  const alerta = novo
    ? { ...a, em: agora, desde: agora, vezes: 1 }
    : { ...lista[i], ...a, em: agora, vezes: (lista[i].vezes ?? 1) + 1 };
  if (!novo) lista.splice(i, 1);
  lista.unshift(alerta);
  gravar(lista);
  try { emitir("alerta:novo", { alerta, novo }); } catch {}
  return alerta;
}

// Resolvido não some: vai para "Resolvidos nos últimos 7 dias", com o texto
// original. O Matheus não conseguiu dizer qual aviso apareceu em 3 contas
// porque os avisos tinham sumido (21/10).
const arquivoResolvidos = () => emEstado("alertas-resolvidos.json");
const SETE_DIAS = 7 * 24 * 3600_000;
function lerResolvidos() {
  try { return JSON.parse(readFileSync(arquivoResolvidos(), "utf8")); } catch { return []; }
}
function guardarResolvido(a, comoSaiu) {
  const agora = Date.now();
  const lista = [{ ...a, resolvidoEm: agora, comoSaiu }, ...lerResolvidos()]
    .filter((x) => agora - x.resolvidoEm < SETE_DIAS).slice(0, 200);
  try { writeFileSync(arquivoResolvidos(), JSON.stringify(lista, null, 2)); } catch {}
}

function tirar(id, comoSaiu) {
  const lista = ler();
  const i = lista.findIndex((x) => x.id === id);
  if (i < 0) return false;
  const [a] = lista.splice(i, 1);
  gravar(lista);
  guardarResolvido(a, comoSaiu);
  try { emitir("alerta:resolvido", { id }); } catch {}
  return true;
}

/** O problema sumiu (a chave voltou a funcionar, a conta foi lida). */
export const resolver = (id) => tirar(id, "resolvido");

/** A pessoa leu e dispensou. Se acontecer de novo, volta. */
export const dispensar = (id) => tirar(id, "dispensado");

/** Os que saíram nos últimos 7 dias, do mais recente ao mais antigo. */
export function alertasResolvidos() {
  return lerResolvidos().filter((x) => Date.now() - x.resolvidoEm < SETE_DIAS);
}

export function lerAlertas() { return ler(); }

/** Resolve todos os alertas cujo id começa com o prefixo (ex.: "conta-humano-"). */
export function resolverPrefixo(prefixo) {
  for (const a of ler()) if (a.id.startsWith(prefixo)) resolver(a.id);
}
