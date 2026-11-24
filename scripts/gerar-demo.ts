// Gera o retrato dos dados de exemplo (public/demo-dados.json, ~200 KB).
// Na primeira visita o navegador cria as tabelas, insere tudo de uma vez e só ajusta as datas para hoje.
//   npm run demo:gerar   (o build já roda sozinho)
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import fs from "node:fs";
import * as schema from "../src/servidor/schema";
import { popularDemonstracao } from "../src/servidor/demo";
import { hojeSP, type Lote } from "../src/servidor/comum";
import { VERSAO_DADOS } from "../src/servidor/versao";
import { TABELAS_RETRATO, type Retrato } from "../src/servidor/retrato";

const pg = await PGlite.create();
const dir = "src/servidor/migracoes";
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort())
  for (const st of fs.readFileSync(`${dir}/${f}`, "utf8").split("--> statement-breakpoint")) if (st.trim()) await pg.exec(st);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = drizzle(pg, { schema }) as any;
const lote: Lote = async (cs) => {
  await pg.transaction(async (tx) => {
    for (const c of cs) { const { sql, params } = (c as { toSQL: () => { sql: string; params: unknown[] } }).toSQL(); await tx.query(sql, params); }
  });
};
const t0 = performance.now();
await popularDemonstracao(db, lote);

const retrato: Retrato = { versao: VERSAO_DADOS, dataBase: hojeSP(), tabelas: {} };
for (const t of TABELAS_RETRATO) retrato.tabelas[t] = (await pg.query<{ j: unknown[] | null }>(`select json_agg(x) as j from "${t}" x`)).rows[0].j ?? [];
const texto = JSON.stringify(retrato);
fs.mkdirSync("public", { recursive: true });
fs.writeFileSync("public/demo-dados.json", texto);
console.log(`demo: ${Math.round(performance.now() - t0)} ms · ${(texto.length / 1024).toFixed(0)} KB · base ${retrato.dataBase}`);
await pg.close();
