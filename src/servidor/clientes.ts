// Clientes (CRM básico): contato, empresa, histórico de compras e débito em aberto (soma das parcelas não pagas).
import { and, asc, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { clientes, crediarios, parcelas, vendas } from "./schema";
import { auditar, novoId, ErroPainel, type Ctx } from "./comum";
import { comStatus, listarCrediarios } from "./fiado";

const opcional = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const campos = {
  nome: z.string().trim().min(2).max(120),
  telefone: z.string().trim().max(30).nullish().transform((v) => (v ? v.replace(/\D/g, "") || null : null)),
  email: z.union([z.literal(""), z.email().max(254)]).nullish().transform((v) => (v ? v.toLowerCase() : null)),
  documento: z.string().trim().max(20).nullish().transform((v) => (v ? v.replace(/[^\dA-Za-z]/g, "") || null : null)),
  cidade: opcional(80),
  bairro: opcional(80),
  empresa: opcional(120),
  observacoes: opcional(1000),
};
export const esquemaNovoCliente = z.strictObject(campos);
export const esquemaEditarCliente = z.strictObject({ id: z.uuid(), ...campos }).partial().required({ id: true });
export const esquemaListaClientes = z.object({ busca: z.string().trim().max(80).optional(), id: z.uuid().optional() });

/** Débito em aberto de cada cliente: parcelas ainda não pagas de vendas não canceladas. */
// Subconsultas com nomes de tabela escritos por extenso (só identificadores fixos, nada vindo do usuário):
// assim "id" nunca é confundido entre a tabela de fora e a de dentro.
const debito = sql<number>`coalesce((
  select sum(p.valor_centavos - coalesce(p.valor_pago_centavos, 0)) from parcelas p
  join crediarios cr on cr.id = p.crediario_id
  join vendas v on v.id = cr.venda_id
  where cr.cliente_id = "clientes"."id" and p.pago_em is null and v.status <> 'cancelada'
), 0)::int`;

export async function listarClientes(ctx: Ctx, f: z.infer<typeof esquemaListaClientes>) {
  const filtros = [];
  if (f.busca) {
    const t = `%${f.busca.replace(/[%_\\]/g, "\\$&")}%`;
    const digitos = f.busca.replace(/\D/g, "");
    filtros.push(or(ilike(clientes.nome, t), ilike(clientes.empresa, t), ...(digitos.length >= 4 ? [ilike(clientes.telefone, `%${digitos}%`)] : [])));
  }
  return ctx.db.select({
    id: clientes.id, nome: clientes.nome, telefone: clientes.telefone, cidade: clientes.cidade, bairro: clientes.bairro, empresa: clientes.empresa,
    debitoCentavos: debito,
    compras: sql<number>`(select count(*) from vendas v where v.cliente_id = "clientes"."id" and v.status <> 'cancelada')::int`,
  }).from(clientes).where(filtros.length ? and(...filtros) : undefined).orderBy(asc(clientes.nome)).limit(300);
}

export async function detalheCliente(ctx: Ctx, id: string) {
  const [c] = await ctx.db.select().from(clientes).where(eq(clientes.id, id)).limit(1);
  if (!c) throw new ErroPainel(404, "Cliente não encontrado.");
  const compras = await ctx.db.select({
    id: vendas.id, data: vendas.data, totalCentavos: vendas.totalCentavos, formaPagamento: vendas.formaPagamento, status: vendas.status,
    itens: sql<string>`(select string_agg(i.descricao, ' + ') from itens_venda i where i.venda_id = "vendas"."id")`,
  }).from(vendas).where(eq(vendas.clienteId, id)).orderBy(desc(vendas.data), desc(vendas.criadoEm));
  const linhas = await ctx.db.select({
    id: parcelas.id, numero: parcelas.numero, valorCentavos: parcelas.valorCentavos, vencimento: parcelas.vencimento, pagoEm: parcelas.pagoEm,
    valorPagoCentavos: parcelas.valorPagoCentavos, vendaId: crediarios.vendaId, numeroParcelas: crediarios.numeroParcelas,
    cobrarJuros: crediarios.cobrarJuros, multaPercentual: crediarios.multaPercentual, jurosMesPercentual: crediarios.jurosMesPercentual,
  }).from(parcelas).innerJoin(crediarios, eq(crediarios.id, parcelas.crediarioId)).innerJoin(vendas, eq(vendas.id, crediarios.vendaId))
    .where(and(eq(crediarios.clienteId, id), ne(vendas.status, "cancelada"))).orderBy(asc(parcelas.vencimento));
  const ps = linhas.map((p) => comStatus(p));
  const crediariosCliente = await listarCrediarios(ctx, { status: "todos", clienteId: id });
  return {
    cliente: c,
    compras,
    crediarios: crediariosCliente,
    parcelas: ps,
    debitoCentavos: ps.filter((p) => p.status !== "pago").reduce((t, p) => t + p.restanteCentavos, 0),
    debitoAtualizadoCentavos: ps.filter((p) => p.status !== "pago").reduce((t, p) => t + p.valorAtualizadoCentavos, 0),
  };
}

export async function criarCliente(ctx: Ctx, d: z.infer<typeof esquemaNovoCliente>) {
  if (d.telefone) {
    const [mesmo] = await ctx.db.select({ id: clientes.id, nome: clientes.nome }).from(clientes).where(eq(clientes.telefone, d.telefone)).limit(1);
    if (mesmo) throw new ErroPainel(409, `Esse telefone já é do cliente ${mesmo.nome}.`);
  }
  const id = novoId();
  await ctx.lote([ctx.db.insert(clientes).values({ ...d, id }), auditar(ctx, "cliente.criar", "cliente", id, { nome: d.nome })]);
  return { id };
}

export async function editarCliente(ctx: Ctx, d: z.infer<typeof esquemaEditarCliente>) {
  const { id, ...campos } = d;
  const mudou = Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined));
  const [c] = await ctx.db.select({ id: clientes.id }).from(clientes).where(eq(clientes.id, id)).limit(1);
  if (!c) throw new ErroPainel(404, "Cliente não encontrado.");
  if (!Object.keys(mudou).length) return { id };
  await ctx.lote([
    ctx.db.update(clientes).set({ ...mudou, atualizadoEm: new Date() }).where(eq(clientes.id, id)),
    auditar(ctx, "cliente.editar", "cliente", id, { campos: Object.keys(mudou) }),
  ]);
  return { id };
}

