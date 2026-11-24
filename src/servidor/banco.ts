// Banco da demonstração: um Postgres de verdade rodando no navegador (PGlite), salvo no IndexedDB.
// As mesmas regras de negócio e o mesmo SQL de produção — só que sem servidor, para o cliente testar à vontade.
//
// Primeira visita: cria as tabelas, insere de uma vez o retrato dos dados de exemplo (public/demo-dados.json, gerado no build)
// e empurra todas as datas para que o "hoje" do retrato vire o hoje de verdade. Sem o arquivo, gera tudo aqui mesmo.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { hojeSP, type Lote } from "./comum";
import { VERSAO_DADOS } from "./versao";
import { TABELAS_RETRATO, type Retrato } from "./retrato";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;
export type Banco = { pg: PGlite; db: Db; lote: Lote; donoId: string; funcionarioId: string };

const NOME = "modelo-financeiro-demo";
const migracoes = import.meta.glob("./migracoes/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const abrirPg = async () => {
  try {
    // relaxedDurability: grava no IndexedDB em segundo plano (bem mais rápido)
    return await PGlite.create(`idb://${NOME}`, { relaxedDurability: true });
  } catch {
    return await PGlite.create(); // navegador sem IndexedDB: só na memória
  }
};
const apagarIdb = () => new Promise<void>((ok) => {
  try {
    const r = indexedDB.deleteDatabase(`/pglite/${NOME}`);
    r.onsuccess = r.onerror = r.onblocked = () => ok();
  } catch { ok(); }
});

const versaoDe = async (pg: PGlite) =>
  (await pg.query<{ v: number }>("select (select versao from _demo limit 1) as v").catch(() => null))?.rows[0]?.v ?? null;

/** Move todas as datas e horários do banco em N dias (o retrato foi tirado no dia do build). */
export async function trazerParaHoje(pg: PGlite) {
  const { rows } = await pg.query<{ base: string }>("select data_base::text as base from _demo limit 1");
  const dias = Math.round((Date.parse(hojeSP()) - Date.parse(rows[0].base)) / 86_400_000);
  if (!dias) return;
  const colunas = await pg.query<{ tabela: string; coluna: string; tipo: string }>(`
    select table_name as tabela, column_name as coluna, data_type as tipo from information_schema.columns
    where table_schema = 'public' and data_type in ('date', 'timestamp with time zone') and table_name <> '_demo'`);
  const porTabela = new Map<string, string[]>();
  for (const c of colunas.rows) {
    const expr = c.tipo === "date" ? `"${c.coluna}" = "${c.coluna}" + ${dias}` : `"${c.coluna}" = "${c.coluna}" + make_interval(days => ${dias})`;
    porTabela.set(c.tabela, [...(porTabela.get(c.tabela) ?? []), expr]);
  }
  await pg.transaction(async (tx) => {
    for (const [tabela, sets] of porTabela) await tx.query(`update "${tabela}" set ${sets.join(", ")}`);
    await tx.query("update _demo set data_base = $1", [hojeSP()]);
  });
}

export async function criarTabelas(pg: PGlite) {
  await pg.exec("drop schema if exists public cascade; create schema public;");
  for (const arquivo of Object.keys(migracoes).sort())
    for (const st of migracoes[arquivo].split("--> statement-breakpoint")) if (st.trim()) await pg.exec(st);
  await pg.exec("create table _demo (versao int not null, data_base date not null);");
}

/** Insere o retrato (cada tabela num comando só) e marca a data em que ele foi tirado. */
export async function carregarRetrato(pg: PGlite, r: Retrato) {
  await pg.transaction(async (tx) => {
    for (const t of TABELAS_RETRATO)
      if (r.tabelas[t]?.length) await tx.query(`insert into "${t}" select * from json_populate_recordset(null::"${t}", $1::json)`, [JSON.stringify(r.tabelas[t])]);
    await tx.query("insert into _demo (versao, data_base) values ($1, $2)", [VERSAO_DADOS, r.dataBase]);
  });
}

/** Sem o retrato (ex.: rodando sem o build): gera os dados aqui no navegador (leva alguns segundos). */
async function gerarAqui(pg: PGlite, db: Db, lote: Lote) {
  const { popularDemonstracao } = await import("./demo");
  await popularDemonstracao(db, lote);
  await pg.query("insert into _demo (versao, data_base) values ($1, $2)", [VERSAO_DADOS, hojeSP()]); // só marca como pronto no fim
}

const montar = (pg: PGlite) => {
  const db = drizzle(pg, { schema }) as unknown as Db;
  /** Várias escritas numa transação só: se uma falha, nenhuma grava. */
  const lote: Lote = async (consultas) => {
    await pg.transaction(async (tx) => {
      for (const c of consultas) {
        const { sql, params } = (c as { toSQL: () => { sql: string; params: unknown[] } }).toSQL();
        await tx.query(sql, params);
      }
    });
  };
  return { db, lote };
};

async function abrir(): Promise<Banco> {
  const pg = await abrirPg();
  if ((await versaoDe(pg)) !== VERSAO_DADOS) {
    const retrato = await fetch("/demo-dados.json").then((r) => (r.ok ? (r.json() as Promise<Retrato>) : null)).catch(() => null);
    await criarTabelas(pg);
    if (retrato?.tabelas && retrato.versao === VERSAO_DADOS) {
      await carregarRetrato(pg, retrato);
      await trazerParaHoje(pg);
    } else {
      const { db, lote } = montar(pg);
      await gerarAqui(pg, db, lote);
    }
  }
  const { db, lote } = montar(pg);
  const usuarios = await db.select().from(schema.usuarios);
  return {
    pg, db, lote,
    donoId: usuarios.find((u) => u.papel === "dono")!.id,
    funcionarioId: usuarios.find((u) => u.papel === "funcionario")!.id,
  };
}

let promessa: Promise<Banco> | null = null;
export const banco = () => (promessa ??= abrir());

/** Apaga tudo e volta aos dados de exemplo. */
export async function restaurarDemonstracao() {
  const { pg } = await banco();
  await pg.exec("drop table if exists _demo;");
  await pg.close();
  promessa = null;
  await apagarIdb();
  window.location.reload();
}
