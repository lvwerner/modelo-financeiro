// Contas a pagar: FIXAS (todo mês, ex.: aluguel) e DÍVIDAS pagas aos poucos (ex.: fornecedor).
// Cada pagamento (de qualquer valor, na data que for) vira também um gasto/saída, então aparece no financeiro.
// O histórico mostra "pagou R$ 1.500 em 18/11 · ficou R$ 7.500".
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { categoriasGasto, contasPagar, gastos, pagamentosConta } from "./schema";
import { auditar, novoId, ErroPainel, hojeSP, type Ctx } from "./comum";

const centavos = z.number().int().min(1).max(100_000_000);
const base = {
  nome: z.string().trim().min(2).max(80),
  categoriaId: z.uuid(),
  diaVencimento: z.number().int().min(1).max(31).nullish(),
  observacao: z.string().trim().max(300).nullish(),
};
export const esquemaNovaConta = z.discriminatedUnion("tipo", [
  z.strictObject({ tipo: z.literal("fixa"), valorMensalCentavos: centavos, ...base }),
  z.strictObject({ tipo: z.literal("divida"), valorTotalCentavos: centavos, numeroParcelas: z.number().int().min(1).max(120).nullish(), ...base }),
]);
export const esquemaEditarConta = z.strictObject({
  id: z.uuid(), ...base, valorMensalCentavos: centavos.nullish(), valorTotalCentavos: centavos.nullish(),
  numeroParcelas: z.number().int().min(1).max(120).nullish(), ativo: z.boolean(),
}).partial().required({ id: true });
export const esquemaPagarConta = z.strictObject({
  contaId: z.uuid(),
  valorCentavos: centavos,
  data: z.iso.date(),
  forma: z.enum(["pix", "cartao", "dinheiro", "prazo"]),
  observacao: z.string().trim().max(300).optional(),
});
export const esquemaListaContas = z.object({ escopo: z.enum(["empresa", "pessoal"]).optional(), inativas: z.enum(["1"]).optional() });

/** Situação da conta: quanto já pagou, quanto falta (dívida) ou se o mês está pago (fixa). */
export function situacaoConta(
  c: { tipo: "fixa" | "divida"; valorMensalCentavos: number | null; valorTotalCentavos: number | null; numeroParcelas: number | null; diaVencimento: number | null },
  pagamentos: { valorCentavos: number; data: string }[],
  hoje = hojeSP(),
) {
  const pago = pagamentos.reduce((t, p) => t + p.valorCentavos, 0);
  const mes = hoje.slice(0, 7);
  const pagoNoMes = pagamentos.filter((p) => p.data.startsWith(mes)).reduce((t, p) => t + p.valorCentavos, 0);
  if (c.tipo === "fixa") {
    const valor = c.valorMensalCentavos ?? 0;
    const faltaNoMes = Math.max(valor - pagoNoMes, 0);
    const vencido = faltaNoMes > 0 && c.diaVencimento != null && Number(hoje.slice(8, 10)) > c.diaVencimento;
    return { pagoCentavos: pago, pagoNoMesCentavos: pagoNoMes, faltaNoMesCentavos: faltaNoMes, saldoCentavos: null as number | null,
      situacao: faltaNoMes === 0 ? "paga no mês" : vencido ? "vencida" : "a pagar", parcelasPagas: null as number | null };
  }
  const total = c.valorTotalCentavos ?? 0;
  const saldo = Math.max(total - pago, 0);
  const valorParcela = c.numeroParcelas ? total / c.numeroParcelas : null;
  return {
    pagoCentavos: pago, pagoNoMesCentavos: pagoNoMes, faltaNoMesCentavos: null as number | null, saldoCentavos: saldo,
    situacao: saldo === 0 ? "quitada" : pagoNoMes > 0 ? "paga no mês" : "a pagar",
    parcelasPagas: valorParcela ? Math.min(Math.floor(pago / valorParcela + 1e-9), c.numeroParcelas!) : null,
  };
}

export async function listarContas(ctx: Ctx, f: z.infer<typeof esquemaListaContas>) {
  const filtros = [];
  if (f.escopo) filtros.push(eq(contasPagar.escopo, f.escopo));
  if (!f.inativas) filtros.push(eq(contasPagar.ativo, true));
  const contas = await ctx.db.select({
    id: contasPagar.id, nome: contasPagar.nome, tipo: contasPagar.tipo, escopo: contasPagar.escopo, categoriaId: contasPagar.categoriaId,
    categoria: categoriasGasto.nome, valorMensalCentavos: contasPagar.valorMensalCentavos, valorTotalCentavos: contasPagar.valorTotalCentavos,
    numeroParcelas: contasPagar.numeroParcelas, diaVencimento: contasPagar.diaVencimento, observacao: contasPagar.observacao, ativo: contasPagar.ativo,
  }).from(contasPagar).innerJoin(categoriasGasto, eq(categoriasGasto.id, contasPagar.categoriaId))
    .where(filtros.length ? and(...filtros) : undefined).orderBy(asc(contasPagar.nome));
  if (!contas.length) return [];
  const pags = await ctx.db.select({ id: pagamentosConta.id, contaId: pagamentosConta.contaId, valorCentavos: pagamentosConta.valorCentavos, data: pagamentosConta.data, forma: gastos.formaPagamento, observacao: gastos.descricao })
    .from(pagamentosConta).innerJoin(gastos, eq(gastos.id, pagamentosConta.gastoId))
    .where(inArray(pagamentosConta.contaId, contas.map((c) => c.id))).orderBy(asc(pagamentosConta.data), asc(pagamentosConta.criadoEm));
  const hoje = hojeSP();
  return contas.map((c) => {
    const meus = pags.filter((p) => p.contaId === c.id);
    let restante = c.valorTotalCentavos ?? 0;
    const historico = meus.map((p) => {
      restante = Math.max(restante - p.valorCentavos, 0);
      return { ...p, saldoDepoisCentavos: c.tipo === "divida" ? restante : null };
    }).reverse();
    return { ...c, ...situacaoConta(c, meus, hoje), historico };
  });
}

export async function criarConta(ctx: Ctx, d: z.infer<typeof esquemaNovaConta>) {
  const [cat] = await ctx.db.select().from(categoriasGasto).where(eq(categoriasGasto.id, d.categoriaId)).limit(1);
  if (!cat) throw new ErroPainel(400, "Categoria não encontrada.");
  const id = novoId();
  await ctx.lote([
    ctx.db.insert(contasPagar).values({
      id, nome: d.nome, tipo: d.tipo, escopo: cat.escopo, categoriaId: cat.id, diaVencimento: d.diaVencimento ?? null, observacao: d.observacao ?? null,
      valorMensalCentavos: d.tipo === "fixa" ? d.valorMensalCentavos : null,
      valorTotalCentavos: d.tipo === "divida" ? d.valorTotalCentavos : null,
      numeroParcelas: d.tipo === "divida" ? (d.numeroParcelas ?? null) : null,
    }),
    auditar(ctx, "conta.criar", "conta", id, { nome: d.nome, tipo: d.tipo }),
  ]);
  return { id };
}

export async function editarConta(ctx: Ctx, d: z.infer<typeof esquemaEditarConta>) {
  const { id, ...campos } = d;
  const [c] = await ctx.db.select().from(contasPagar).where(eq(contasPagar.id, id)).limit(1);
  if (!c) throw new ErroPainel(404, "Conta não encontrada.");
  const mudou: Record<string, unknown> = Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined));
  if (c.tipo === "fixa") { delete mudou.valorTotalCentavos; delete mudou.numeroParcelas; } else delete mudou.valorMensalCentavos;
  if (mudou.categoriaId) {
    const [cat] = await ctx.db.select().from(categoriasGasto).where(eq(categoriasGasto.id, mudou.categoriaId as string)).limit(1);
    if (!cat) throw new ErroPainel(400, "Categoria não encontrada.");
    mudou.escopo = cat.escopo;
  }
  if (!Object.keys(mudou).length) return { id };
  await ctx.lote([ctx.db.update(contasPagar).set(mudou).where(eq(contasPagar.id, id)), auditar(ctx, "conta.editar", "conta", id, { campos: Object.keys(mudou) })]);
  return { id };
}

/** Dá baixa (total ou parcial) numa conta: registra o pagamento e lança a saída no financeiro, juntos. */
export async function pagarConta(ctx: Ctx, d: z.infer<typeof esquemaPagarConta>) {
  const [c] = await ctx.db.select().from(contasPagar).where(eq(contasPagar.id, d.contaId)).limit(1);
  if (!c || !c.ativo) throw new ErroPainel(404, "Conta não encontrada.");
  if (d.data > hojeSP()) throw new ErroPainel(400, "A data do pagamento não pode ser no futuro.");
  if (c.tipo === "divida") {
    const pags = await ctx.db.select({ valorCentavos: pagamentosConta.valorCentavos, data: pagamentosConta.data }).from(pagamentosConta).where(eq(pagamentosConta.contaId, c.id));
    const { saldoCentavos } = situacaoConta(c, pags);
    if (!saldoCentavos) throw new ErroPainel(409, "Essa dívida já está quitada.");
    if (d.valorCentavos > saldoCentavos) throw new ErroPainel(400, `O valor passa do que falta (${(saldoCentavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}).`);
  }
  const gastoId = novoId();
  const id = novoId();
  await ctx.lote([
    ctx.db.insert(gastos).values({
      id: gastoId, escopo: c.escopo, categoriaId: c.categoriaId, valorCentavos: d.valorCentavos, data: d.data, formaPagamento: d.forma,
      descricao: `${c.nome}${d.observacao ? ` · ${d.observacao}` : ""}`, criadoPor: ctx.usuarioId,
    }),
    ctx.db.insert(pagamentosConta).values({ id, contaId: c.id, gastoId, valorCentavos: d.valorCentavos, data: d.data }),
    auditar(ctx, "conta.pagar", "conta", c.id, { valorCentavos: d.valorCentavos, data: d.data }),
  ]);
  return { id };
}

/** Desfaz um pagamento de conta (apaga a saída junto). */
export async function estornarConta(ctx: Ctx, id: string) {
  const [p] = await ctx.db.select().from(pagamentosConta).where(eq(pagamentosConta.id, id)).limit(1);
  if (!p) throw new ErroPainel(404, "Pagamento não encontrado.");
  await ctx.lote([
    ctx.db.delete(gastos).where(eq(gastos.id, p.gastoId)), // o pagamento sai junto (cascata)
    auditar(ctx, "conta.estornar", "conta", p.contaId, { valorCentavos: p.valorCentavos, data: p.data }),
  ]);
  return { ok: true };
}

