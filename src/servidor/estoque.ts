// Estoque: produtos e serviços organizados por categoria. A quantidade só muda com movimento registrado;
// serviço não controla estoque.
import { and, asc, eq, gt, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { categoriasProduto, movimentosEstoque, produtos } from "./schema";
import { auditar, ErroPainel, novoId, violouTrava, type Ctx } from "./comum";

const centavos = z.number().int().min(0).max(100_000_000);
const texto = (max = 120) => z.string().trim().max(max);

const camposProduto = {
  nome: texto().min(1),
  marca: texto(60).nullish(),
  unidade: texto(10).min(1),
  categoriaId: z.uuid().nullish(),
  controlaEstoque: z.boolean(),
  precoCentavos: centavos.nullish(),
  custoCentavos: centavos.nullish(),
  estoqueMinimo: z.number().int().min(0).max(100_000),
  ativo: z.boolean(),
};

export const esquemaNovoProduto = z.strictObject({
  ...camposProduto,
  codigo: z.string().trim().regex(/^[A-Za-z0-9-]{2,40}$/).optional(),
  quantidade: z.number().int().min(0).max(100_000).default(0),
  unidade: camposProduto.unidade.default("un"),
  estoqueMinimo: camposProduto.estoqueMinimo.default(0),
  ativo: camposProduto.ativo.default(true),
  controlaEstoque: camposProduto.controlaEstoque.default(true),
});
/** Edição: todos os campos opcionais (o que não vier fica como está); quantidade só muda por movimento. */
export const esquemaEditarProduto = z.strictObject({ id: z.uuid(), ...camposProduto }).partial().required({ id: true });
export const esquemaMovimento = z.strictObject({
  produtoId: z.uuid(),
  delta: z.number().int().min(-100_000).max(100_000).refine((n) => n !== 0, "Informe uma quantidade diferente de zero."),
  motivo: z.enum(["entrada", "ajuste"]),
  observacao: texto(300).optional(),
});
export const esquemaListaProdutos = z.object({
  busca: texto(80).optional(),
  categoriaId: z.uuid().optional(),
  disponiveis: z.enum(["1"]).optional(), // só ativos e com estoque (para a tela de venda)
  repor: z.enum(["1"]).optional(), // só os que estão no mínimo ou abaixo
});

export async function listarProdutos(ctx: Ctx, f: z.infer<typeof esquemaListaProdutos>) {
  const filtros = [];
  if (f.categoriaId) filtros.push(eq(produtos.categoriaId, f.categoriaId));
  if (f.disponiveis) filtros.push(eq(produtos.ativo, true), or(gt(produtos.quantidade, 0), eq(produtos.controlaEstoque, false))!);
  if (f.repor) filtros.push(eq(produtos.ativo, true), eq(produtos.controlaEstoque, true), sql`${produtos.quantidade} <= ${produtos.estoqueMinimo}`);
  if (f.busca) {
    const t = `%${f.busca.replace(/[%_\\]/g, "\\$&")}%`;
    filtros.push(or(ilike(produtos.nome, t), ilike(produtos.codigo, t), ilike(produtos.marca, t), ilike(categoriasProduto.nome, t))!);
  }
  const linhas = await ctx.db.select({ p: produtos, categoria: categoriasProduto.nome }).from(produtos)
    .leftJoin(categoriasProduto, eq(categoriasProduto.id, produtos.categoriaId))
    .where(filtros.length ? and(...filtros) : undefined).orderBy(asc(categoriasProduto.nome), asc(produtos.nome)).limit(500);
  return linhas.map((l) => ({ ...l.p, categoria: l.categoria }));
}

export async function criarProduto(ctx: Ctx, d: z.infer<typeof esquemaNovoProduto>) {
  const id = novoId();
  const codigo = (d.codigo ?? `P-${id.slice(0, 6)}`).toUpperCase();
  const [existe] = await ctx.db.select({ id: produtos.id }).from(produtos).where(eq(produtos.codigo, codigo)).limit(1);
  if (existe) throw new ErroPainel(409, "Já existe um produto com esse código.");
  if (!d.categoriaId) throw new ErroPainel(400, "Escolha a categoria do produto ou serviço.");
  const quantidade = d.controlaEstoque === false ? 0 : (d.quantidade ?? 0);
  const consultas: unknown[] = [ctx.db.insert(produtos).values({ ...d, id, codigo, quantidade })];
  if (quantidade > 0) consultas.push(ctx.db.insert(movimentosEstoque).values({ produtoId: id, delta: quantidade, motivo: "entrada", observacao: "Cadastro", criadoPor: ctx.usuarioId }));
  consultas.push(auditar(ctx, "produto.criar", "produto", id, { nome: d.nome, quantidade }));
  await ctx.lote(consultas);
  return { id };
}

export async function editarProduto(ctx: Ctx, d: z.infer<typeof esquemaEditarProduto>) {
  const { id, ...campos } = d;
  const [antes] = await ctx.db.select().from(produtos).where(eq(produtos.id, id)).limit(1);
  if (!antes) throw new ErroPainel(404, "Produto não encontrado.");
  const mudou = Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined));
  if (!Object.keys(mudou).length) return { id };
  await ctx.lote([
    ctx.db.update(produtos).set({ ...mudou, atualizadoEm: new Date() }).where(eq(produtos.id, id)),
    auditar(ctx, "produto.editar", "produto", id, { antes: Object.fromEntries(Object.keys(mudou).map((k) => [k, (antes as Record<string, unknown>)[k]])), depois: mudou }),
  ]);
  return { id };
}

/** Entrada de mercadoria (+) ou ajuste de contagem (+/-). Estoque nunca fica negativo (trava do banco). */
export async function movimentar(ctx: Ctx, d: z.infer<typeof esquemaMovimento>) {
  const [p] = await ctx.db.select({ quantidade: produtos.quantidade, controlaEstoque: produtos.controlaEstoque }).from(produtos).where(eq(produtos.id, d.produtoId)).limit(1);
  if (!p) throw new ErroPainel(404, "Produto não encontrado.");
  if (!p.controlaEstoque) throw new ErroPainel(400, "Esse item é um serviço: não tem estoque.");
  if (p.quantidade + d.delta < 0) throw new ErroPainel(409, `Só há ${p.quantidade} em estoque.`);
  try {
    await ctx.lote([
      ctx.db.update(produtos).set({ quantidade: sql`${produtos.quantidade} + ${d.delta}`, atualizadoEm: new Date() }).where(eq(produtos.id, d.produtoId)),
      ctx.db.insert(movimentosEstoque).values({ produtoId: d.produtoId, delta: d.delta, motivo: d.motivo, observacao: d.observacao, criadoPor: ctx.usuarioId }),
      auditar(ctx, `estoque.${d.motivo}`, "produto", d.produtoId, { delta: d.delta, observacao: d.observacao }),
    ]);
  } catch (e) {
    if (violouTrava(e, "produtos_quantidade_ck")) throw new ErroPainel(409, "Estoque insuficiente para esse ajuste.");
    throw e;
  }
  return { ok: true };
}

// ---------- categorias do estoque ----------
export const esquemaNovaCategoriaProduto = z.strictObject({ nome: z.string().trim().min(2).max(40) });

export const listarCategoriasProduto = (ctx: Ctx) =>
  ctx.db.select({ id: categoriasProduto.id, nome: categoriasProduto.nome }).from(categoriasProduto).where(eq(categoriasProduto.ativo, true)).orderBy(asc(categoriasProduto.nome));

export async function criarCategoriaProduto(ctx: Ctx, d: z.infer<typeof esquemaNovaCategoriaProduto>) {
  const [existe] = await ctx.db.select({ id: categoriasProduto.id }).from(categoriasProduto).where(sql`lower(${categoriasProduto.nome}) = ${d.nome.toLowerCase()}`).limit(1);
  if (existe) throw new ErroPainel(409, "Essa categoria já existe.");
  const id = novoId();
  await ctx.lote([ctx.db.insert(categoriasProduto).values({ id, nome: d.nome }), auditar(ctx, "categoria_produto.criar", "categoria_produto", id, d)]);
  return { id };
}
