// Saídas / gastos, sempre separados em EMPRESA e PESSOAL. O escopo do gasto tem de bater com o da categoria.
import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { categoriasGasto, gastos } from "./schema";
import { auditar, novoId, ErroPainel, hojeSP, type Ctx } from "./comum";

export const esquemaNovaCategoria = z.strictObject({ nome: z.string().trim().min(2).max(60), escopo: z.enum(["empresa", "pessoal"]) });
export const esquemaNovoGasto = z.strictObject({
  categoriaId: z.uuid(),
  valorCentavos: z.number().int().min(1).max(100_000_000),
  data: z.iso.date().optional(),
  descricao: z.string().trim().max(300).optional(),
  formaPagamento: z.enum(["pix", "cartao", "dinheiro", "prazo"]).optional(),
});
export const esquemaListaGastos = z.object({
  escopo: z.enum(["empresa", "pessoal"]).optional(),
  de: z.iso.date().optional(),
  ate: z.iso.date().optional(),
});

export const listarCategorias = (ctx: Ctx) =>
  ctx.db.select().from(categoriasGasto).where(eq(categoriasGasto.ativo, true)).orderBy(asc(categoriasGasto.escopo), asc(categoriasGasto.nome));

export async function criarCategoria(ctx: Ctx, d: z.infer<typeof esquemaNovaCategoria>) {
  const [existe] = await ctx.db.select({ id: categoriasGasto.id }).from(categoriasGasto)
    .where(and(eq(categoriasGasto.escopo, d.escopo), sql`lower(${categoriasGasto.nome}) = ${d.nome.toLowerCase()}`)).limit(1);
  if (existe) throw new ErroPainel(409, "Essa categoria já existe.");
  const id = novoId();
  await ctx.lote([ctx.db.insert(categoriasGasto).values({ id, ...d }), auditar(ctx, "categoria.criar", "categoria", id, d)]);
  return { id };
}

export async function listarGastos(ctx: Ctx, f: z.infer<typeof esquemaListaGastos>) {
  const filtros: SQL[] = [];
  if (f.escopo) filtros.push(eq(gastos.escopo, f.escopo));
  if (f.de) filtros.push(gte(gastos.data, f.de));
  if (f.ate) filtros.push(lte(gastos.data, f.ate));
  const lista = await ctx.db.select({
    id: gastos.id, escopo: gastos.escopo, data: gastos.data, valorCentavos: gastos.valorCentavos, descricao: gastos.descricao,
    formaPagamento: gastos.formaPagamento, categoriaId: gastos.categoriaId, categoria: categoriasGasto.nome,
  }).from(gastos).innerJoin(categoriasGasto, eq(categoriasGasto.id, gastos.categoriaId))
    .where(filtros.length ? and(...filtros) : undefined).orderBy(desc(gastos.data), desc(gastos.criadoEm)).limit(1000);
  return { gastos: lista, totalCentavos: lista.reduce((t, g) => t + g.valorCentavos, 0) };
}

export async function criarGasto(ctx: Ctx, d: z.infer<typeof esquemaNovoGasto>) {
  const [cat] = await ctx.db.select().from(categoriasGasto).where(eq(categoriasGasto.id, d.categoriaId)).limit(1);
  if (!cat) throw new ErroPainel(400, "Categoria não encontrada.");
  const data = d.data ?? hojeSP();
  const id = novoId();
  await ctx.lote([
    ctx.db.insert(gastos).values({ id, escopo: cat.escopo, categoriaId: cat.id, valorCentavos: d.valorCentavos, data, descricao: d.descricao ?? null, formaPagamento: d.formaPagamento ?? null, criadoPor: ctx.usuarioId }),
    auditar(ctx, "gasto.criar", "gasto", id, { escopo: cat.escopo, categoria: cat.nome, valorCentavos: d.valorCentavos, data }),
  ]);
  return { id };
}

export async function excluirGasto(ctx: Ctx, id: string) {
  const [g] = await ctx.db.select().from(gastos).where(eq(gastos.id, id)).limit(1);
  if (!g) throw new ErroPainel(404, "Gasto não encontrado.");
  // a auditoria guarda o gasto inteiro: excluir não apaga o rastro
  await ctx.lote([ctx.db.delete(gastos).where(eq(gastos.id, id)), auditar(ctx, "gasto.excluir", "gasto", id, { ...g, criadoEm: String(g.criadoEm) })]);
  return { ok: true };
}
