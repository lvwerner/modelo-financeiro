// Cópia de segurança: todos os dados num arquivo JSON para baixar e guardar.
// Não inclui senhas, segredos do 2FA nem sessões.
import { categoriasGasto, categoriasProduto, clientes, contasPagar, crediarios, gastos, itensVenda, movimentosEstoque, pagamentosConta, pagamentosFiado, parcelas, produtos, vendas } from "./schema";
import { auditar, type Ctx } from "./comum";

export async function gerarBackup(ctx: Ctx) {
  const [catP, pf, cp, pc] = await Promise.all([ctx.db.select().from(categoriasProduto), ctx.db.select().from(pagamentosFiado), ctx.db.select().from(contasPagar), ctx.db.select().from(pagamentosConta)]);
  const [p, m, c, v, i, cr, pa, cat, g] = await Promise.all([
    ctx.db.select().from(produtos), ctx.db.select().from(movimentosEstoque), ctx.db.select().from(clientes),
    ctx.db.select().from(vendas), ctx.db.select().from(itensVenda), ctx.db.select().from(crediarios),
    ctx.db.select().from(parcelas), ctx.db.select().from(categoriasGasto), ctx.db.select().from(gastos),
  ]);
  const dados = {
    geradoEm: new Date().toISOString(),
    versao: 2,
    tabelas: { categoriasProduto: catP, produtos: p, movimentosEstoque: m, clientes: c, vendas: v, itensVenda: i, crediarios: cr, parcelas: pa, pagamentosFiado: pf, categoriasGasto: cat, gastos: g, contasPagar: cp, pagamentosConta: pc },
  };
  await auditar(ctx, "backup.baixar", "backup", null, { linhas: p.length + m.length + c.length + v.length + i.length + cr.length + pa.length + cat.length + g.length });
  return dados;
}
