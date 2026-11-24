// Fiado / a prazo. O cliente paga o valor que puder, quando puder (R$ 150 hoje, R$ 500 mês que vem…):
// cada pagamento fica registrado com data e forma, e o saldo é o financiado menos o que já pagou.
// Os pagamentos quitam as parcelas na ordem do vencimento; uma parcela pode ficar parcialmente paga.
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, notInArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { clientes, crediarios, pagamentosFiado, parcelas, vendas } from "./schema";
import { auditar, novoId, diasEntre, ErroPainel, hojeSP, type Ctx } from "./comum";

export type StatusParcela = "pago" | "pendente" | "atrasado";

/**
 * Valor atualizado do que falta numa parcela atrasada: multa fixa (%) + juros ao mês, proporcionais aos dias.
 * Só se a venda foi feita com "cobrar juros"; senão, é o próprio valor que falta.
 */
export function valorAtualizado(valor: number, vencimento: string, hoje: string, cobrar: boolean, multaPct: number, jurosMesPct: number) {
  const dias = diasEntre(vencimento, hoje);
  if (!cobrar || dias <= 0) return valor;
  return Math.round(valor * (1 + multaPct / 100 + (jurosMesPct / 100 / 30) * dias));
}

type LinhaParcela = {
  valorCentavos: number; vencimento: string; pagoEm: string | null; valorPagoCentavos?: number | null;
  cobrarJuros: boolean; multaPercentual: string; jurosMesPercentual: string;
};
export function comStatus<T extends LinhaParcela>(p: T, hoje = hojeSP()) {
  const status: StatusParcela = p.pagoEm ? "pago" : p.vencimento < hoje ? "atrasado" : "pendente";
  const restante = status === "pago" ? 0 : Math.max(p.valorCentavos - (p.valorPagoCentavos ?? 0), 0);
  return {
    ...p,
    status,
    restanteCentavos: restante,
    diasAtraso: status === "atrasado" ? diasEntre(p.vencimento, hoje) : 0,
    valorAtualizadoCentavos: status === "atrasado"
      ? valorAtualizado(restante, p.vencimento, hoje, p.cobrarJuros, Number(p.multaPercentual), Number(p.jurosMesPercentual))
      : restante,
  };
}

/**
 * Distribui os pagamentos (em ordem de data) pelas parcelas (em ordem de vencimento).
 * Parcela coberta por inteiro: pagoEm = data do pagamento que a completou. Sobra além do total (juros) não vira parcela.
 */
export function alocarPagamentos(
  ps: { id: string; valorCentavos: number; vencimento: string; numero: number }[],
  pagamentos: { valorCentavos: number; data: string }[],
) {
  const ordemParcelas = [...ps].sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.numero - b.numero);
  const fila = [...pagamentos].sort((a, b) => a.data.localeCompare(b.data)).map((p) => ({ ...p, sobra: p.valorCentavos }));
  let i = 0;
  return ordemParcelas.map((parc) => {
    let pago = 0;
    let quitadaEm: string | null = null;
    while (pago < parc.valorCentavos && i < fila.length) {
      const usa = Math.min(fila[i].sobra, parc.valorCentavos - pago);
      pago += usa;
      fila[i].sobra -= usa;
      if (pago === parc.valorCentavos) quitadaEm = fila[i].data;
      if (fila[i].sobra === 0) i++;
    }
    return { id: parc.id, valorPagoCentavos: pago || null, pagoEm: quitadaEm };
  });
}

export const esquemaListaParcelas = z.object({
  status: z.enum(["abertas", "atrasadas", "pagas", "todas"]).default("abertas"),
  clienteId: z.uuid().optional(),
});
export const esquemaListaCrediarios = z.object({ status: z.enum(["abertos", "quitados", "todos"]).default("abertos"), clienteId: z.uuid().optional() });
export const esquemaReceber = z.strictObject({
  crediarioId: z.uuid(),
  valorCentavos: z.number().int().min(1).max(100_000_000),
  data: z.iso.date(),
  forma: z.enum(["pix", "cartao", "dinheiro"]),
  observacao: z.string().trim().max(300).optional(),
});
export const esquemaEstornarFiado = z.object({ id: z.uuid() });
/** Pagamento no cliente (não numa compra): abate o saldo devedor dele, das compras mais antigas para as mais novas. */
export const esquemaReceberCliente = z.strictObject({
  clienteId: z.uuid(),
  valorCentavos: z.number().int().min(1).max(100_000_000),
  data: z.iso.date(),
  forma: z.enum(["pix", "cartao", "dinheiro"]),
  observacao: z.string().trim().max(300).optional(),
});

const camposParcela = {
  id: parcelas.id, numero: parcelas.numero, valorCentavos: parcelas.valorCentavos, vencimento: parcelas.vencimento,
  pagoEm: parcelas.pagoEm, valorPagoCentavos: parcelas.valorPagoCentavos, crediarioId: parcelas.crediarioId,
  numeroParcelas: crediarios.numeroParcelas, cobrarJuros: crediarios.cobrarJuros, multaPercentual: crediarios.multaPercentual,
  jurosMesPercentual: crediarios.jurosMesPercentual, vendaId: vendas.id, dataVenda: vendas.data,
  clienteId: clientes.id, cliente: clientes.nome, telefone: clientes.telefone,
};

export async function listarParcelas(ctx: Ctx, f: z.infer<typeof esquemaListaParcelas>) {
  const hoje = hojeSP();
  const filtros: SQL[] = [ne(vendas.status, "cancelada")];
  if (f.clienteId) filtros.push(eq(crediarios.clienteId, f.clienteId));
  if (f.status === "abertas") filtros.push(isNull(parcelas.pagoEm));
  if (f.status === "atrasadas") filtros.push(isNull(parcelas.pagoEm), lt(parcelas.vencimento, hoje));
  if (f.status === "pagas") filtros.push(isNotNull(parcelas.pagoEm));
  const linhas = await ctx.db.select(camposParcela).from(parcelas)
    .innerJoin(crediarios, eq(crediarios.id, parcelas.crediarioId))
    .innerJoin(vendas, eq(vendas.id, crediarios.vendaId))
    .innerJoin(clientes, eq(clientes.id, crediarios.clienteId))
    .where(and(...filtros)).orderBy(asc(parcelas.vencimento), asc(clientes.nome)).limit(1000);
  return linhas.map((p) => comStatus(p, hoje));
}

/** Crediários (uma venda a prazo cada) com saldo, histórico de pagamentos e situação. */
export async function listarCrediarios(ctx: Ctx, f: z.infer<typeof esquemaListaCrediarios>) {
  const hoje = hojeSP();
  const filtros: SQL[] = [ne(vendas.status, "cancelada")];
  if (f.clienteId) filtros.push(eq(crediarios.clienteId, f.clienteId));
  const lista = await ctx.db.select({
    id: crediarios.id, valorCentavos: crediarios.valorCentavos, entradaCentavos: crediarios.entradaCentavos, numeroParcelas: crediarios.numeroParcelas,
    cobrarJuros: crediarios.cobrarJuros, vendaId: vendas.id, dataVenda: vendas.data, totalVenda: vendas.totalCentavos, criadoEmVenda: vendas.criadoEm,
    clienteId: clientes.id, cliente: clientes.nome, telefone: clientes.telefone,
    itens: sql<string | null>`(select string_agg(i.quantidade || 'x ' || i.descricao, ' + ') from itens_venda i where i.venda_id = "vendas"."id")`,
  }).from(crediarios).innerJoin(vendas, eq(vendas.id, crediarios.vendaId)).innerJoin(clientes, eq(clientes.id, crediarios.clienteId))
    .where(and(...filtros)).orderBy(asc(clientes.nome), desc(vendas.data)).limit(500);
  if (!lista.length) return [];
  const ids = lista.map((c) => c.id);
  const [todasParcelas, todosPagamentos] = await Promise.all([
    ctx.db.select(camposParcela).from(parcelas).innerJoin(crediarios, eq(crediarios.id, parcelas.crediarioId))
      .innerJoin(vendas, eq(vendas.id, crediarios.vendaId)).innerJoin(clientes, eq(clientes.id, crediarios.clienteId))
      .where(inArray(parcelas.crediarioId, ids)).orderBy(asc(parcelas.vencimento)),
    ctx.db.select().from(pagamentosFiado).where(inArray(pagamentosFiado.crediarioId, ids)).orderBy(asc(pagamentosFiado.data), asc(pagamentosFiado.criadoEm)),
  ]);
  const resultado = lista.map((c) => {
    const ps = todasParcelas.filter((p) => p.crediarioId === c.id).map((p) => comStatus(p, hoje));
    const pags = todosPagamentos.filter((p) => p.crediarioId === c.id);
    const pago = pags.reduce((t, p) => t + p.valorCentavos, 0);
    // histórico com o saldo depois de cada pagamento ("pagou R$ 150 em 18/11 · ficou R$ 1.050")
    let corrente = c.valorCentavos;
    const historico = pags.map((p) => {
      corrente = Math.max(corrente - p.valorCentavos, 0);
      return { id: p.id, valorCentavos: p.valorCentavos, data: p.data, forma: p.forma, observacao: p.observacao, saldoDepoisCentavos: corrente, criadoEm: p.criadoEm };
    });
    const abertas = ps.filter((p) => p.status !== "pago");
    return {
      ...c,
      pagoCentavos: pago,
      saldoCentavos: abertas.reduce((t, p) => t + p.restanteCentavos, 0),
      saldoAtualizadoCentavos: abertas.reduce((t, p) => t + p.valorAtualizadoCentavos, 0),
      parcelasPagas: ps.length - abertas.length,
      atrasado: abertas.some((p) => p.status === "atrasado"),
      proximoVencimento: abertas[0]?.vencimento ?? null,
      parcelas: ps,
      historico: historico.reverse(),
    };
  });
  if (f.status === "abertos") return resultado.filter((c) => c.saldoCentavos > 0);
  if (f.status === "quitados") return resultado.filter((c) => c.saldoCentavos === 0);
  return resultado;
}

/** Recalcula as parcelas de um crediário a partir de todos os pagamentos (consultas para entrar no lote). */
async function realocar(ctx: Ctx, crediarioId: string, pagamentos: { valorCentavos: number; data: string }[]) {
  const ps = await ctx.db.select({ id: parcelas.id, valorCentavos: parcelas.valorCentavos, vencimento: parcelas.vencimento, numero: parcelas.numero })
    .from(parcelas).where(eq(parcelas.crediarioId, crediarioId));
  return alocarPagamentos(ps, pagamentos).map((a) =>
    ctx.db.update(parcelas).set({ valorPagoCentavos: a.valorPagoCentavos, pagoEm: a.pagoEm, formaRecebimento: null }).where(eq(parcelas.id, a.id)));
}

async function carregarCrediario(ctx: Ctx, id: string) {
  const [c] = await ctx.db.select({ id: crediarios.id, valor: crediarios.valorCentavos, status: vendas.status, cliente: clientes.nome })
    .from(crediarios).innerJoin(vendas, eq(vendas.id, crediarios.vendaId)).innerJoin(clientes, eq(clientes.id, crediarios.clienteId))
    .where(eq(crediarios.id, id)).limit(1);
  if (!c) throw new ErroPainel(404, "Venda a prazo não encontrada.");
  if (c.status === "cancelada") throw new ErroPainel(409, "Essa venda foi cancelada.");
  return c;
}

/** Recebe um valor qualquer do cliente: abate do saldo e quita as parcelas mais antigas primeiro. */
export async function receberFiado(ctx: Ctx, d: z.infer<typeof esquemaReceber>) {
  const c = await carregarCrediario(ctx, d.crediarioId);
  if (d.data > hojeSP()) throw new ErroPainel(400, "A data do pagamento não pode ser no futuro.");
  const [situacao] = await listarCrediarios(ctx, { status: "todos" }).then((l) => l.filter((x) => x.id === d.crediarioId));
  const limite = situacao?.saldoAtualizadoCentavos ?? 0;
  if (limite <= 0) throw new ErroPainel(409, `${c.cliente} já quitou essa compra.`);
  if (d.valorCentavos > limite) throw new ErroPainel(400, `O valor passa do que falta pagar (${(limite / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}).`);
  const anteriores = await ctx.db.select({ valorCentavos: pagamentosFiado.valorCentavos, data: pagamentosFiado.data }).from(pagamentosFiado).where(eq(pagamentosFiado.crediarioId, d.crediarioId));
  const id = novoId();
  await ctx.lote([
    ctx.db.insert(pagamentosFiado).values({ id, crediarioId: d.crediarioId, valorCentavos: d.valorCentavos, data: d.data, forma: d.forma, observacao: d.observacao ?? null, criadoPor: ctx.usuarioId }),
    ...(await realocar(ctx, d.crediarioId, [...anteriores, { valorCentavos: d.valorCentavos, data: d.data }])),
    auditar(ctx, "fiado.receber", "crediario", d.crediarioId, { valorCentavos: d.valorCentavos, data: d.data, forma: d.forma }),
  ]);
  return { id, saldoCentavos: Math.max((situacao?.saldoCentavos ?? 0) - d.valorCentavos, 0) }; // mesmo saldo da tela (sem juros)
}

/** Recebe no CLIENTE: o valor abate as compras a prazo dele da mais antiga para a mais nova (num pagamento só). */
export async function receberFiadoCliente(ctx: Ctx, d: z.infer<typeof esquemaReceberCliente>) {
  if (d.data > hojeSP()) throw new ErroPainel(400, "A data do pagamento não pode ser no futuro.");
  const abertos = (await listarCrediarios(ctx, { status: "abertos", clienteId: d.clienteId }))
    .sort((a, b) => a.dataVenda.localeCompare(b.dataVenda) || a.id.localeCompare(b.id));
  const limite = abertos.reduce((t, c) => t + c.saldoAtualizadoCentavos, 0);
  if (limite <= 0) throw new ErroPainel(409, "Esse cliente não tem nada a pagar.");
  if (d.valorCentavos > limite) throw new ErroPainel(400, `O valor passa do que o cliente deve (${(limite / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}).`);
  const anteriores = await ctx.db.select({ crediarioId: pagamentosFiado.crediarioId, valorCentavos: pagamentosFiado.valorCentavos, data: pagamentosFiado.data })
    .from(pagamentosFiado).where(inArray(pagamentosFiado.crediarioId, abertos.map((c) => c.id)));
  const agora = new Date(); // a mesma hora em todas as partes: a tela mostra como um pagamento só
  let falta = d.valorCentavos;
  const consultas: unknown[] = [];
  for (const c of abertos) {
    if (falta <= 0) break;
    const parte = Math.min(falta, c.saldoAtualizadoCentavos);
    falta -= parte;
    consultas.push(ctx.db.insert(pagamentosFiado).values({
      crediarioId: c.id, valorCentavos: parte, data: d.data, forma: d.forma, observacao: d.observacao ?? null, criadoPor: ctx.usuarioId, criadoEm: agora,
    }));
    const doCrediario = anteriores.filter((a) => a.crediarioId === c.id);
    consultas.push(...(await realocar(ctx, c.id, [...doCrediario, { valorCentavos: parte, data: d.data }])));
  }
  consultas.push(auditar(ctx, "fiado.receber", "cliente", d.clienteId, { valorCentavos: d.valorCentavos, data: d.data, forma: d.forma }));
  await ctx.lote(consultas);
  const saldo = abertos.reduce((t, c) => t + c.saldoCentavos, 0);
  return { saldoCentavos: Math.max(saldo - d.valorCentavos, 0) };
}

/**
 * Desfaz um pagamento lançado errado: o saldo e as parcelas voltam a ser recalculados sem ele.
 * Se o pagamento foi recebido no cliente e dividido entre compras, desfaz todas as partes juntas.
 */
export async function estornarFiado(ctx: Ctx, d: z.infer<typeof esquemaEstornarFiado>) {
  const [p] = await ctx.db.select({ pg: pagamentosFiado, clienteId: crediarios.clienteId }).from(pagamentosFiado)
    .innerJoin(crediarios, eq(crediarios.id, pagamentosFiado.crediarioId)).where(eq(pagamentosFiado.id, d.id)).limit(1);
  if (!p) throw new ErroPainel(404, "Pagamento não encontrado.");
  await carregarCrediario(ctx, p.pg.crediarioId);
  const partes = await ctx.db.select({ id: pagamentosFiado.id, crediarioId: pagamentosFiado.crediarioId, valorCentavos: pagamentosFiado.valorCentavos })
    .from(pagamentosFiado).innerJoin(crediarios, eq(crediarios.id, pagamentosFiado.crediarioId))
    .where(and(eq(crediarios.clienteId, p.clienteId), eq(pagamentosFiado.criadoEm, p.pg.criadoEm), eq(pagamentosFiado.data, p.pg.data), eq(pagamentosFiado.forma, p.pg.forma)));
  const ids = partes.map((x) => x.id);
  const consultas: unknown[] = [ctx.db.delete(pagamentosFiado).where(inArray(pagamentosFiado.id, ids))];
  for (const crediarioId of new Set(partes.map((x) => x.crediarioId))) {
    const restantes = await ctx.db.select({ valorCentavos: pagamentosFiado.valorCentavos, data: pagamentosFiado.data }).from(pagamentosFiado)
      .where(and(eq(pagamentosFiado.crediarioId, crediarioId), notInArray(pagamentosFiado.id, ids)));
    consultas.push(...(await realocar(ctx, crediarioId, restantes)));
  }
  consultas.push(auditar(ctx, "fiado.estornar", "crediario", p.pg.crediarioId, { valorCentavos: partes.reduce((t, x) => t + x.valorCentavos, 0), data: p.pg.data, partes: ids.length }));
  await ctx.lote(consultas);
  return { ok: true };
}
