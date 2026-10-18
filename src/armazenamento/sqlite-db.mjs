// Banco local: abre, migra e faz backup. Regras em DECISOES.md §1.
//
// A atualização chega na máquina do cliente sem ninguém de plantão. Se a
// migração falhar, o app recusa iniciar e aponta o backup — subir com schema
// pela metade é pior que não subir.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const CAMINHO = resolve(process.env.DB_CAMINHO ?? emEstado("dados.sqlite"));
const DIR_MIGRACOES = resolve("migracoes");
const MANTER_BACKUPS = 10;

const ok = () => {};

/** 001-inicial.sql -> { numero: 1, nome, sql } */
function migracoesEmDisco() {
  if (!existsSync(DIR_MIGRACOES)) return [];
  return readdirSync(DIR_MIGRACOES)
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .map((f) => ({ numero: Number(f.match(/^(\d+)/)[1]), nome: f, caminho: join(DIR_MIGRACOES, f) }))
    .sort((a, b) => a.numero - b.numero);
}

// Ao lado do banco, não do processo: um caminho customizado (teste, cliente
// com dados em outro disco) precisa levar os backups junto.
const dirBackups = (caminho) => join(dirname(caminho), "backups");

function backup(caminho, versao, vazio) {
  if (!existsSync(caminho)) return null;
  // Banco recém-criado não tem o que preservar, e um backup vazio só polui.
  // O tamanho não serve de pista: o WAL já grava cabeçalho na abertura.
  if (vazio) return null;
  const DIR_BACKUPS = dirBackups(caminho);
  mkdirSync(DIR_BACKUPS, { recursive: true });
  const carimbo = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const destino = join(DIR_BACKUPS, `dados-v${versao}-${carimbo}.sqlite`);
  copyFileSync(caminho, destino);
  podar(DIR_BACKUPS);
  return destino;
}

function podar(DIR_BACKUPS) {
  try {
    const arqs = readdirSync(DIR_BACKUPS)
      .filter((f) => f.endsWith(".sqlite"))
      .map((f) => ({ f, t: statSync(join(DIR_BACKUPS, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of arqs.slice(MANTER_BACKUPS)) rmSync(join(DIR_BACKUPS, f), { force: true });
  } catch {}
}

/**
 * Abre o banco e aplica o que faltar.
 * @throws se a migração falhar — o chamador deve recusar iniciar.
 */
// Carregado sob demanda: o módulo é nativo, e a fase 1 roda sem ele.
let Database = null;
export function carregarDriver() {
  if (!Database) Database = require("better-sqlite3");
  return Database;
}
import { createRequire } from "node:module";
import { emEstado } from "../caminhos.mjs";
const require = createRequire(import.meta.url);

export function abrir({ aoLog = ok, caminho = CAMINHO } = {}) {
  mkdirSync(dirname(caminho), { recursive: true });
  const db = new (carregarDriver())(caminho);
  db.pragma("journal_mode = WAL");   // leitura do painel não trava a escrita da fila
  db.pragma("foreign_keys = ON");

  const migracoes = migracoesEmDisco();
  const alvo = migracoes.length ? migracoes.at(-1).numero : 0;
  const atual = db.pragma("user_version", { simple: true });

  if (atual === alvo) return db;

  if (atual > alvo) {
    db.close();
    throw new Error(
      `banco na versão ${atual}, app só conhece até ${alvo} — ` +
      "este app está desatualizado; atualize antes de abrir"
    );
  }

  const pendentes = migracoes.filter((m) => m.numero > atual);
  const vazio = db.prepare(
    "SELECT count(*) c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).get().c === 0;
  const copia = backup(caminho, atual, vazio);
  if (copia) aoLog(`backup antes de migrar: ${copia}`);

  for (const m of pendentes) {
    const sql = readFileSync(m.caminho, "utf8");
    try {
      // better-sqlite3 não deixa abrir transação explícita em volta de exec
      // com DDL; o .transaction() dele resolve isso.
      db.transaction(() => {
        db.exec(sql);
        db.pragma(`user_version = ${m.numero}`);
      })();
      aoLog(`migração ${m.nome} aplicada`);
    } catch (e) {
      db.close();
      if (copia) copyFileSync(copia, caminho);   // volta ao estado anterior
      throw new Error(
        `migração ${m.nome} falhou: ${e.message}\n` +
        (copia ? `banco restaurado a partir de ${copia}` : "banco era novo; nada a restaurar")
      );
    }
  }
  return db;
}

export const versao = (db) => db.pragma("user_version", { simple: true });
