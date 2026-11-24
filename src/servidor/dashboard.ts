// Números do dashboard: faturamento, vendas, lucro, caixa, contas a receber e o resumo de empresa e pessoal.
// Duas visões de dinheiro, de propósito:
// - FATURAMENTO: o que foi vendido no período (vendas concluídas, pela data da venda);
// - CAIXA: o que de fato entrou (vendas à vista + entradas do fiado + parcelas recebidas no período).
import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { categoriasGasto, crediarios, gastos, itensVenda, pagamentosFiado, produtos, vendas } from "./schema";
import { diasEntre, ErroPainel, hojeSP, type Ctx } from "./comum";
import { listarParcelas } from "./fiado";

export const esquemaDashboard = z.object({ de: z.iso.date().optional(), ate: z.iso.date().optional() });

const somarDias = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);

/** Período anterior de mesmo tamanho, logo antes (para comparar). */
export function periodoAnterior(de: string, ate: string) {
  const dias = diasEntre(de, ate) + 1;
  return { de: somarDias(de, -dias), ate: somarDias(de, -1) };
}

/** Série do gráfico: por dia até 62 dias; acima disso, por mês. Dias sem venda entram com zero. */
export function montarSerie(de: string, ate: string, porDia: Map<string, number>) {
  const dias = diasEntre(de, ate) + 1;
  if (dias <= 62) {
    return { agrupamento: "dia" as const, pontos: Array.from({ length: dias }, (_, i) => { const d = somarDias(de, i); return { chave: d, valor: porDia.get(d) ?? 0 }; }) };
  }
  const porMes = new Map<string, number>();
  for (let i = 0; i < dias; i++) { const d = somarDias(de, i); porMes.set(d.slice(0, 7), (porMes.get(d.slice(0, 7)) ?? 0) + (porDia.get(d) ?? 0)); }
  return { agrupamento: "mes" as const, pontos: [...porMes].map(([chave, valor]) => ({ chave, valor })) };
}

const num = (v: unknown) => Number(v ?? 0);

export async function resumo(ctx: Ctx, f: z.infer<typeof esquemaDashboard>) {
  const hoje = hojeSP();
  const ate = f.ate ?? hoje;
  const de = f.de ?? `${ate.slice(0, 8)}01`;
  if (de > ate) throw new ErroPainel(400, "A data inicial é depois da final.");
  if (diasEntre(de, ate) > 3 * 366) throw new ErroPainel(400, "Escolha um período de até 3 anos.");
  const ant = periodoAnterior(de, ate);
  const noPeriodo = and(eq(vendas.status, "concluida"), gte(vendas.data, de), lte(vendas.data, ate));

  const [listaVendas, faturamentoAnterior, custos, entradasFiado, recebidas, porCategoria, estoque, parcelasAbertas] = await Promise.all([
    ctx.db.select({ id: vendas.id, data: vendas.data, total: vendas.totalCentavos, forma: vendas.formaPagamento }).from(vendas).where(noPeriodo),
    ctx.db.select({ v: sql<number>`coalesce(sum(${vendas.totalCentavos}), 0)::bigint` }).from(vendas)
      .where(and(eq(vendas.status, "concluida"), gte(vendas.data, ant.de), lte(vendas.data, ant.ate))),
    // custo por venda; "completa" = todos os itens têm custo (só essas entram no lucro)
    ctx.db.select({
      vendaId: itensVenda.vendaId,
      custo: sql<number>`coalesce(sum(${itensVenda.custoUnitarioCentavos} * ${itensVenda.quantidade}), 0)::bigint`,
      completa: sql<boolean>`bool_and(${itensVenda.custoUnitarioCentavos} is not null)`,
    }).from(itensVenda).innerJoin(vendas, eq(vendas.id, itensVenda.vendaId)).where(noPeriodo).groupBy(itensVenda.vendaId),
    ctx.db.select({ v: sql<number>`coalesce(sum(${crediarios.entradaCentavos}), 0)::bigint` }).from(crediarios)
      .innerJoin(vendas, eq(vendas.id, crediarios.vendaId)).where(noPeriodo),
    // tudo o que os clientes pagaram do fiado no período (pagamentos de qualquer valor)
    ctx.db.select({ v: sql<number>`coalesce(sum(${pagamentosFiado.valorCentavos}), 0)::bigint` }).from(pagamentosFiado)
      .innerJoin(crediarios, eq(crediarios.id, pagamentosFiado.crediarioId)).innerJoin(vendas, eq(vendas.id, crediarios.vendaId))
      .where(and(ne(vendas.status, "cancelada"), gte(pagamentosFiado.data, de), lte(pagamentosFiado.data, ate))),
    ctx.db.select({ escopo: gastos.escopo, categoria: categoriasGasto.nome, v: sql<number>`sum(${gastos.valorCentavos})::bigint` }).from(gastos)
      .innerJoin(categoriasGasto, eq(categoriasGasto.id, gastos.categoriaId))
      .where(and(gte(gastos.data, de), lte(gastos.data, ate))).groupBy(gastos.escopo, categoriasGasto.nome),
    ctx.db.select({
      itens: sql<number>`coalesce(sum(${produtos.quantidade}), 0)::int`,
      repor: sql<number>`count(*) filter (where ${produtos.controlaEstoque} and ${produtos.quantidade} <= ${produtos.estoqueMinimo})::int`,
      valorVenda: sql<number>`coalesce(sum(${produtos.quantidade} * ${produtos.precoCentavos}), 0)::bigint`,
      valorCusto: sql<number>`coalesce(sum(${produtos.quantidade} * ${produtos.custoCentavos}), 0)::bigint`,
      semCusto: sql<number>`count(*) filter (where ${produtos.custoCentavos} is null and ${produtos.quantidade} > 0)::int`,
    }).from(produtos).where(eq(produtos.ativo, true)),
    listarParcelas(ctx, { status: "abertas" }),
  ]);

  // vendas
  const faturamento = listaVendas.reduce((t, v) => t + v.total, 0);
  const porForma = { pix: 0, cartao: 0, dinheiro: 0, prazo: 0 } as Record<"pix" | "cartao" | "dinheiro" | "prazo", number>;
  const porDia = new Map<string, number>();
  for (const v of listaVendas) {
    porForma[v.forma] += v.total;
    porDia.set(v.data, (porDia.get(v.data) ?? 0) + v.total);
  }

  // lucro bruto: só das vendas com custo em todos os itens
  const custoPorVenda = new Map(custos.map((c) => [c.vendaId, c]));
  const comCusto = listaVendas.filter((v) => custoPorVenda.get(v.id)?.completa);
  const lucro = comCusto.reduce((t, v) => t + v.total - num(custoPorVenda.get(v.id)?.custo), 0);
  const faturamentoComCusto = comCusto.reduce((t, v) => t + v.total, 0);

  // caixa (o que entrou de verdade)
  const vendasAVista = porForma.pix + porForma.cartao + porForma.dinheiro;
  const caixa = { vendasAVista, entradasFiado: num(entradasFiado[0]?.v), parcelasRecebidas: num(recebidas[0]?.v) };
  const entrouNoCaixa = caixa.vendasAVista + caixa.entradasFiado + caixa.parcelasRecebidas;

  // gastos separados
  const cat = (e: string) => porCategoria.filter((g) => g.escopo === e).map((g) => ({ categoria: g.categoria, valor: num(g.v) })).sort((a, b) => b.valor - a.valor);
  const gastosEmpresa = cat("empresa");
  const gastosPessoal = cat("pessoal");
  const totalEmpresa = gastosEmpresa.reduce((t, g) => t + g.valor, 0);
  const totalPessoal = gastosPessoal.reduce((t, g) => t + g.valor, 0);

  // contas a receber (hoje, não depende do período)
  const atrasadas = parcelasAbertas.filter((p) => p.status === "atrasado");
  const em30 = somarDias(hoje, 30);
  const devedores = new Map<string, { clienteId: string; nome: string; telefone: string | null; valor: number; atrasado: number }>();
  for (const p of parcelasAbertas) {
    const d = devedores.get(p.clienteId) ?? { clienteId: p.clienteId, nome: p.cliente, telefone: p.telefone, valor: 0, atrasado: 0 };
    d.valor += p.valorAtualizadoCentavos;
    if (p.status === "atrasado") d.atrasado += p.valorAtualizadoCentavos;
    devedores.set(p.clienteId, d);
  }

  const e = estoque[0];
  return {
    periodo: { de, ate },
    anterior: { ...ant, faturamento: num(faturamentoAnterior[0]?.v) },
    faturamento,
    vendas: listaVendas.length,
    ticketMedio: listaVendas.length ? Math.round(faturamento / listaVendas.length) : 0,
    porForma,
    lucro: { valor: lucro, vendasComCusto: comCusto.length, faturamentoComCusto, margem: faturamentoComCusto ? lucro / faturamentoComCusto : null },
    caixa: { ...caixa, total: entrouNoCaixa },
    empresa: { entrou: entrouNoCaixa, gastos: totalEmpresa, resultado: entrouNoCaixa - totalEmpresa, porCategoria: gastosEmpresa },
    pessoal: { gastos: totalPessoal, porCategoria: gastosPessoal },
    receber: {
      total: parcelasAbertas.reduce((t, p) => t + p.restanteCentavos, 0),
      atrasado: atrasadas.reduce((t, p) => t + p.restanteCentavos, 0),
      atrasadoComJuros: atrasadas.reduce((t, p) => t + p.valorAtualizadoCentavos, 0),
      proximos30Dias: parcelasAbertas.filter((p) => p.status === "pendente" && p.vencimento <= em30).reduce((t, p) => t + p.restanteCentavos, 0),
      parcelasAtrasadas: atrasadas.length,
      devedores: [...devedores.values()].sort((a, b) => b.atrasado - a.atrasado || b.valor - a.valor).slice(0, 6),
    },
    estoque: { itens: num(e?.itens), repor: num(e?.repor), valorVenda: num(e?.valorVenda), valorCusto: num(e?.valorCusto), semCusto: num(e?.semCusto) },
    serie: montarSerie(de, ate, porDia),
  };
}
