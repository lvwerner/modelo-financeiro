// Vendas: o preço sugerido vem do estoque; quem vende pode combinar outro valor por item (para mais ou para menos),
// e o preço de tabela fica guardado na auditoria. Desconto opcional, baixa automática no estoque
// e, no fiado, o crediário com as parcelas. Tudo numa transação só: se faltar estoque, nada é gravado.
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { clientes, crediarios, itensVenda, movimentosEstoque, pagamentosFiado, parcelas, produtos, vendas } from "./schema";
import { auditar, novoId, dividirEmParcelas, ErroPainel, hojeSP, somarMeses, violouTrava, type Ctx } from "./comum";

const centavos = z.number().int().min(0).max(100_000_000);

export const esquemaNovaVenda = z.strictObject({
  clienteId: z.uuid().nullish(),
  data: z.iso.date().optional(),
  itens: z.array(z.strictObject({
    produtoId: z.uuid(),
    quantidade: z.number().int().min(1).max(100),
    precoUnitarioCentavos: z.number().int().min(1).max(100_000_000).optional(), // preço combinado na hora (sem ele, vale o do estoque)
  })).min(1).max(30),
  descontoCentavos: centavos.default(0),
  formaPagamento: z.enum(["pix", "cartao", "dinheiro", "prazo"]),
  parcelasCartao: z.number().int().min(1).max(12).optional(),
  observacoes: z.string().trim().max(1000).optional(),
  prazo: z.strictObject({
    entradaCentavos: centavos.default(0),
    numeroParcelas: z.number().int().min(1).max(48),
    primeiroVencimento: z.iso.date(),
    cobrarJuros: z.boolean().default(false),
    multaPercentual: z.number().min(0).max(20).default(0),
    jurosMesPercentual: z.number().min(0).max(20).default(0),
  }).optional(),
});
/** Fiado lançado direto, sem escolher produto: cliente, o que levou e quanto ficou devendo (como no caderno). */
export const esquemaNovoFiado = z.strictObject({
  clienteId: z.uuid(),
  descricao: z.string().trim().min(1).max(200), // o que levou: "Serviço de manutenção", "2 itens"…
  valorCentavos: z.number().int().min(1).max(100_000_000),
  entradaCentavos: centavos.default(0), // se já pagou uma parte na hora
  data: z.iso.date().optional(),
  pagarAte: z.iso.date().optional(), // vazio = 30 dias depois
});
export const esquemaCancelarVenda = z.strictObject({ id: z.uuid(), acao: z.literal("cancelar"), motivo: z.string().trim().min(3).max(300) });
export const esquemaListaVendas = z.object({ de: z.iso.date().optional(), ate: z.iso.date().optional(), clienteId: z.uuid().optional() });

const descricaoItem = (p: typeof produtos.$inferSelect) => (p.marca ? `${p.nome} · ${p.marca}` : p.nome);

/** Monta a venda a partir do estoque (preço, descrição, custo) e confere estoque, desconto e regras do fiado. */
export async function prepararVenda(ctx: Ctx, d: z.infer<typeof esquemaNovaVenda>) {
  const ids = [...new Set(d.itens.map((i) => i.produtoId))];
  const lista = await ctx.db.select().from(produtos).where(inArray(produtos.id, ids));
  const porId = new Map(lista.map((p) => [p.id, p]));
  const pedidoPorProduto = new Map<string, number>();
  const itens = d.itens.map((i) => {
    const p = porId.get(i.produtoId);
    if (!p || !p.ativo) throw new ErroPainel(400, "Um dos produtos não existe ou está inativo.");
    const precoTabela = p.precoCentavos;
    const preco = i.precoUnitarioCentavos ?? precoTabela;
    if (preco == null) throw new ErroPainel(400, `${p.nome} está sem preço no estoque. Digite o preço na venda.`);
    pedidoPorProduto.set(p.id, (pedidoPorProduto.get(p.id) ?? 0) + i.quantidade);
    return { produto: p, quantidade: i.quantidade, preco, precoTabela, total: preco * i.quantidade };
  });
  for (const [id, qtd] of pedidoPorProduto) {
    const p = porId.get(id)!;
    if (p.controlaEstoque && qtd > p.quantidade) throw new ErroPainel(409, `${p.nome}: só há ${p.quantidade} em estoque.`);
  }
  const subtotal = itens.reduce((t, i) => t + i.total, 0);
  if (d.descontoCentavos > subtotal) throw new ErroPainel(400, "O desconto é maior que o valor da venda.");
  const total = subtotal - d.descontoCentavos;

  if (d.formaPagamento === "prazo" || d.clienteId) {
    if (!d.clienteId) throw new ErroPainel(400, "Venda a prazo precisa de cliente.");
    const [c] = await ctx.db.select({ id: clientes.id }).from(clientes).where(eq(clientes.id, d.clienteId)).limit(1);
    if (!c) throw new ErroPainel(400, "Cliente não encontrado.");
  }
  let prazo: { financiado: number; parcelas: { numero: number; valor: number; vencimento: string }[] } | null = null;
  if (d.formaPagamento === "prazo") {
    if (!d.prazo) throw new ErroPainel(400, "Informe as parcelas da venda a prazo.");
    const financiado = total - d.prazo.entradaCentavos;
    if (financiado <= 0) throw new ErroPainel(400, "A entrada cobre o valor todo: registre como venda à vista.");
    if (d.prazo.primeiroVencimento < (d.data ?? hojeSP())) throw new ErroPainel(400, "O 1º vencimento não pode ser antes da venda.");
    const valores = dividirEmParcelas(financiado, d.prazo.numeroParcelas);
    prazo = { financiado, parcelas: valores.map((valor, i) => ({ numero: i + 1, valor, vencimento: somarMeses(d.prazo!.primeiroVencimento, i) })) };
  } else if (d.prazo) {
    throw new ErroPainel(400, "Parcelas só valem para pagamento a prazo.");
  }
  if (d.parcelasCartao && d.formaPagamento !== "cartao") throw new ErroPainel(400, "Parcelas do cartão só valem para pagamento no cartão.");
  return { itens, subtotal, total, prazo };
}

export async function criarVenda(ctx: Ctx, d: z.infer<typeof esquemaNovaVenda>) {
  const v = await prepararVenda(ctx, d);
  const vendaId = novoId();
  const consultas: unknown[] = [
    ctx.db.insert(vendas).values({
      id: vendaId, clienteId: d.clienteId ?? null, data: d.data ?? hojeSP(), subtotalCentavos: v.subtotal, descontoCentavos: d.descontoCentavos,
      totalCentavos: v.total, formaPagamento: d.formaPagamento, parcelasCartao: d.formaPagamento === "cartao" ? (d.parcelasCartao ?? 1) : null,
      observacoes: d.observacoes ?? null, criadoPor: ctx.usuarioId,
    }),
    ...v.itens.map((i) => ctx.db.insert(itensVenda).values({
      vendaId, produtoId: i.produto.id, descricao: descricaoItem(i.produto), quantidade: i.quantidade,
      precoUnitarioCentavos: i.preco, custoUnitarioCentavos: i.produto.custoCentavos, totalCentavos: i.total,
    })),
    // baixa no estoque: a trava do banco (quantidade >= 0) derruba a transação inteira se alguém vendeu antes
    ...v.itens.filter((i) => i.produto.controlaEstoque).map((i) => ctx.db.update(produtos).set({ quantidade: sql`${produtos.quantidade} - ${i.quantidade}`, atualizadoEm: new Date() }).where(eq(produtos.id, i.produto.id))),
    ...v.itens.filter((i) => i.produto.controlaEstoque).map((i) => ctx.db.insert(movimentosEstoque).values({ produtoId: i.produto.id, delta: -i.quantidade, motivo: "venda", vendaId, criadoPor: ctx.usuarioId })),
  ];
  if (v.prazo && d.prazo) {
    const crediarioId = novoId();
    consultas.push(
      ctx.db.insert(crediarios).values({
        id: crediarioId, vendaId, clienteId: d.clienteId!, valorCentavos: v.prazo.financiado, entradaCentavos: d.prazo.entradaCentavos,
        numeroParcelas: d.prazo.numeroParcelas, cobrarJuros: d.prazo.cobrarJuros,
        multaPercentual: d.prazo.cobrarJuros ? d.prazo.multaPercentual.toFixed(2) : "0", jurosMesPercentual: d.prazo.cobrarJuros ? d.prazo.jurosMesPercentual.toFixed(2) : "0",
      }),
      ...v.prazo.parcelas.map((p) => ctx.db.insert(parcelas).values({ crediarioId, numero: p.numero, valorCentavos: p.valor, vencimento: p.vencimento })),
    );
  }
  const precoCombinado = v.itens.filter((i) => i.preco !== i.precoTabela).map((i) => ({ produto: i.produto.nome, tabela: i.precoTabela, vendido: i.preco }));
  consultas.push(auditar(ctx, "venda.criar", "venda", vendaId, { total: v.total, forma: d.formaPagamento, itens: v.itens.length, ...(precoCombinado.length ? { precoCombinado } : {}) }));
  try {
    await ctx.lote(consultas);
  } catch (e) {
    if (violouTrava(e, "produtos_quantidade_ck")) throw new ErroPainel(409, "Estoque insuficiente: alguém vendeu esse produto agora há pouco. Atualize e tente de novo.");
    throw e;
  }
  return { id: vendaId, totalCentavos: v.total, parcelas: v.prazo?.parcelas ?? [] };
}

/** Lança um fiado sem produto do estoque: vira uma venda a prazo com um item avulso (não mexe no estoque). */
export async function criarFiado(ctx: Ctx, d: z.infer<typeof esquemaNovoFiado>) {
  const data = d.data ?? hojeSP();
  if (data > hojeSP()) throw new ErroPainel(400, "A data não pode ser no futuro.");
  const [c] = await ctx.db.select({ id: clientes.id }).from(clientes).where(eq(clientes.id, d.clienteId)).limit(1);
  if (!c) throw new ErroPainel(400, "Cliente não encontrado.");
  const financiado = d.valorCentavos - d.entradaCentavos;
  if (financiado <= 0) throw new ErroPainel(400, "A entrada cobre o valor todo: não sobrou nada a receber.");
  const pagarAte = d.pagarAte ?? somarMeses(data, 1);
  if (pagarAte < data) throw new ErroPainel(400, "A data para pagar não pode ser antes da compra.");
  const vendaId = novoId();
  const crediarioId = novoId();
  await ctx.lote([
    ctx.db.insert(vendas).values({
      id: vendaId, clienteId: d.clienteId, data, subtotalCentavos: d.valorCentavos, descontoCentavos: 0, totalCentavos: d.valorCentavos,
      formaPagamento: "prazo", observacoes: d.descricao, criadoPor: ctx.usuarioId,
    }),
    ctx.db.insert(itensVenda).values({ vendaId, produtoId: null, descricao: d.descricao, quantidade: 1, precoUnitarioCentavos: d.valorCentavos, totalCentavos: d.valorCentavos }),
    ctx.db.insert(crediarios).values({ id: crediarioId, vendaId, clienteId: d.clienteId, valorCentavos: financiado, entradaCentavos: d.entradaCentavos, numeroParcelas: 1, cobrarJuros: false, multaPercentual: "0", jurosMesPercentual: "0" }),
    ctx.db.insert(parcelas).values({ crediarioId, numero: 1, valorCentavos: financiado, vencimento: pagarAte }),
    auditar(ctx, "fiado.criar", "venda", vendaId, { valorCentavos: d.valorCentavos, entradaCentavos: d.entradaCentavos, descricao: d.descricao }),
  ]);
  return { id: vendaId, saldoCentavos: financiado };
}

/** Cancela a venda e devolve os produtos ao estoque. Com parcela já recebida, é preciso estornar o pagamento antes. */
export async function cancelarVenda(ctx: Ctx, d: z.infer<typeof esquemaCancelarVenda>) {
  const [venda] = await ctx.db.select().from(vendas).where(eq(vendas.id, d.id)).limit(1);
  if (!venda) throw new ErroPainel(404, "Venda não encontrada.");
  if (venda.status === "cancelada") throw new ErroPainel(409, "Essa venda já está cancelada.");
  const pagas = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(pagamentosFiado)
    .innerJoin(crediarios, eq(crediarios.id, pagamentosFiado.crediarioId)).where(eq(crediarios.vendaId, d.id));
  if (pagas[0].n > 0) throw new ErroPainel(409, "Esse cliente já pagou parte dessa venda. Estorne os pagamentos em A receber antes de cancelar.");
  // só volta ao estoque o que controla estoque (serviço não)
  const itens = (await ctx.db.select({ produtoId: itensVenda.produtoId, quantidade: itensVenda.quantidade, controla: produtos.controlaEstoque })
    .from(itensVenda).innerJoin(produtos, eq(produtos.id, itensVenda.produtoId)).where(eq(itensVenda.vendaId, d.id))).filter((i) => i.controla);
  await ctx.lote([
    ctx.db.update(vendas).set({ status: "cancelada", canceladaEm: new Date(), motivoCancelamento: d.motivo }).where(eq(vendas.id, d.id)),
    ...itens.map((i) => ctx.db.update(produtos).set({ quantidade: sql`${produtos.quantidade} + ${i.quantidade}`, atualizadoEm: new Date() }).where(eq(produtos.id, i.produtoId!))),
    ...itens.map((i) => ctx.db.insert(movimentosEstoque).values({ produtoId: i.produtoId!, delta: i.quantidade, motivo: "cancelamento", vendaId: d.id, criadoPor: ctx.usuarioId })),
    ctx.db.delete(crediarios).where(eq(crediarios.vendaId, d.id)), // as parcelas (todas em aberto) saem junto
    auditar(ctx, "venda.cancelar", "venda", d.id, { motivo: d.motivo, total: venda.totalCentavos }),
  ]);
  return { ok: true };
}

export async function listarVendas(ctx: Ctx, f: z.infer<typeof esquemaListaVendas>) {
  const filtros: SQL[] = [];
  if (f.de) filtros.push(gte(vendas.data, f.de));
  if (f.ate) filtros.push(lte(vendas.data, f.ate));
  if (f.clienteId) filtros.push(eq(vendas.clienteId, f.clienteId));
  return ctx.db.select({
    id: vendas.id, data: vendas.data, subtotalCentavos: vendas.subtotalCentavos, descontoCentavos: vendas.descontoCentavos,
    totalCentavos: vendas.totalCentavos, formaPagamento: vendas.formaPagamento, parcelasCartao: vendas.parcelasCartao, status: vendas.status,
    motivoCancelamento: vendas.motivoCancelamento, observacoes: vendas.observacoes, clienteId: vendas.clienteId, cliente: clientes.nome,
    itens: sql<string>`(select string_agg(i.quantidade || 'x ' || i.descricao, ' + ') from itens_venda i where i.venda_id = "vendas"."id")`,
  }).from(vendas).leftJoin(clientes, eq(clientes.id, vendas.clienteId))
    .where(filtros.length ? and(...filtros) : undefined).orderBy(desc(vendas.data), desc(vendas.criadoEm)).limit(500);
}
