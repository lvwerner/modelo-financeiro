// Esquema do banco do modelo financeiro (Postgres via Drizzle ORM). Na demonstração, o Postgres roda no próprio
// navegador (PGlite + IndexedDB); em produção, o mesmo esquema vai para um Postgres gerenciado (Neon, Supabase…).
// Regras gerais:
// - Dinheiro sempre em CENTAVOS (integer): R$ 2.490,00 = 249000. Nada de float.
// - Datas de negócio (venda, vencimento, gasto) em `date`; registros de sistema em `timestamptz`.
// - Todo lançamento guarda `criadoPor` e entra no log de auditoria.
import { sql } from "drizzle-orm";
import {
  boolean, check, date, index, integer, jsonb, numeric, pgEnum, pgTable, smallint, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const criadoEm = () => timestamp("criado_em", { withTimezone: true }).notNull().defaultNow();
const atualizadoEm = () => timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow();

// ---------- enums ----------
export const tipoConta = pgEnum("tipo_conta", ["fixa", "divida"]);
export const formaPagamento = pgEnum("forma_pagamento", ["pix", "cartao", "dinheiro", "prazo"]);
export const statusVenda = pgEnum("status_venda", ["concluida", "cancelada"]);
export const motivoMovimento = pgEnum("motivo_movimento", ["entrada", "venda", "cancelamento", "ajuste"]);
export const escopoGasto = pgEnum("escopo_gasto", ["empresa", "pessoal"]);

// ---------- acesso ----------
/** "dono": painel inteiro; "funcionario": só vender, estoque (sem custo), clientes e receber a prazo. */
export const usuarios = pgTable("usuarios", {
  id: id(),
  nome: text("nome").notNull(),
  email: text("email").notNull(),
  papel: text("papel").notNull().default("dono"),
  tema: text("tema").notNull().default("sistema"), // preferência do perfil: vale em qualquer dispositivo
  criadoEm: criadoEm(),
}, (t) => [
  uniqueIndex("usuarios_email_uq").on(sql`lower(${t.email})`),
  check("usuarios_papel_ck", sql`${t.papel} in ('dono', 'funcionario')`),
  check("usuarios_tema_ck", sql`${t.tema} in ('claro', 'escuro', 'sistema')`),
]);

/** Quem fez o quê: toda criação, edição e cancelamento fica registrado. */
export const auditoria = pgTable("auditoria", {
  id: id(),
  usuarioId: uuid("usuario_id").references(() => usuarios.id, { onDelete: "set null" }),
  acao: text("acao").notNull(),
  entidade: text("entidade"),
  entidadeId: uuid("entidade_id"),
  dados: jsonb("dados"),
  ip: text("ip"),
  criadoEm: criadoEm(),
}, (t) => [index("auditoria_data_idx").on(t.criadoEm)]);

// ---------- estoque ----------
/** Categorias do estoque (Produtos, Serviços, Acessórios…): a empresa cria as que quiser. */
export const categoriasProduto = pgTable("categorias_produto", {
  id: id(),
  nome: text("nome").notNull(),
  ativo: boolean("ativo").notNull().default(true),
  criadoEm: criadoEm(),
}, (t) => [uniqueIndex("categorias_produto_nome_uq").on(sql`lower(${t.nome})`)]);

/** Produtos e serviços. Serviço não controla estoque (a venda não mexe na quantidade). */
export const produtos = pgTable("produtos", {
  id: id(),
  categoriaId: uuid("categoria_id").references(() => categoriasProduto.id, { onDelete: "set null" }),
  controlaEstoque: boolean("controla_estoque").notNull().default(true),
  codigo: text("codigo").notNull(), // SKU / código interno
  nome: text("nome").notNull(),
  marca: text("marca"),
  unidade: text("unidade").notNull().default("un"), // un, cx, kg, h…
  precoCentavos: integer("preco_centavos"), // nulo = sob consulta
  custoCentavos: integer("custo_centavos"), // quanto a empresa pagou: permite ver lucro
  quantidade: integer("quantidade").notNull().default(0),
  estoqueMinimo: integer("estoque_minimo").notNull().default(0), // abaixo disso: alerta de reposição
  ativo: boolean("ativo").notNull().default(true),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
}, (t) => [
  uniqueIndex("produtos_codigo_uq").on(t.codigo),
  check("produtos_quantidade_ck", sql`${t.quantidade} >= 0`), // estoque nunca fica negativo
  check("produtos_precos_ck", sql`coalesce(${t.precoCentavos}, 0) >= 0 and coalesce(${t.custoCentavos}, 0) >= 0`),
]);

/** Histórico do estoque: cada entrada, venda, cancelamento ou ajuste vira uma linha. */
export const movimentosEstoque = pgTable("movimentos_estoque", {
  id: id(),
  produtoId: uuid("produto_id").notNull().references(() => produtos.id, { onDelete: "restrict" }),
  delta: integer("delta").notNull(),
  motivo: motivoMovimento("motivo").notNull(),
  vendaId: uuid("venda_id").references(() => vendas.id, { onDelete: "set null" }),
  observacao: text("observacao"),
  criadoPor: uuid("criado_por").references(() => usuarios.id, { onDelete: "set null" }),
  criadoEm: criadoEm(),
}, (t) => [index("movimentos_produto_idx").on(t.produtoId), check("movimentos_delta_ck", sql`${t.delta} <> 0`)]);

// ---------- clientes (CRM básico) ----------
export const clientes = pgTable("clientes", {
  id: id(),
  nome: text("nome").notNull(),
  telefone: text("telefone"), // WhatsApp, só dígitos com DDD
  email: text("email"),
  documento: text("documento"), // CPF/CNPJ, opcional
  cidade: text("cidade"),
  bairro: text("bairro"),
  empresa: text("empresa"),
  observacoes: text("observacoes"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
}, (t) => [index("clientes_nome_idx").on(sql`lower(${t.nome})`), index("clientes_telefone_idx").on(t.telefone)]);

// ---------- vendas ----------
export const vendas = pgTable("vendas", {
  id: id(),
  clienteId: uuid("cliente_id").references(() => clientes.id, { onDelete: "restrict" }),
  data: date("data").notNull().default(sql`current_date`),
  subtotalCentavos: integer("subtotal_centavos").notNull(),
  descontoCentavos: integer("desconto_centavos").notNull().default(0),
  totalCentavos: integer("total_centavos").notNull(),
  formaPagamento: formaPagamento("forma_pagamento").notNull(),
  parcelasCartao: smallint("parcelas_cartao"),
  status: statusVenda("status").notNull().default("concluida"),
  canceladaEm: timestamp("cancelada_em", { withTimezone: true }),
  motivoCancelamento: text("motivo_cancelamento"),
  observacoes: text("observacoes"),
  criadoPor: uuid("criado_por").references(() => usuarios.id, { onDelete: "set null" }),
  criadoEm: criadoEm(),
}, (t) => [
  index("vendas_data_idx").on(t.data),
  index("vendas_cliente_idx").on(t.clienteId),
  check("vendas_valores_ck", sql`${t.descontoCentavos} >= 0 and ${t.descontoCentavos} <= ${t.subtotalCentavos} and ${t.totalCentavos} = ${t.subtotalCentavos} - ${t.descontoCentavos}`),
  check("vendas_prazo_cliente_ck", sql`${t.formaPagamento} <> 'prazo' or ${t.clienteId} is not null`),
  check("vendas_parcelas_cartao_ck", sql`${t.parcelasCartao} is null or ${t.parcelasCartao} between 1 and 12`),
]);

/** Itens da venda. O preço é COPIADO do estoque no momento da venda: mudar o preço depois não altera vendas antigas. */
export const itensVenda = pgTable("itens_venda", {
  id: id(),
  vendaId: uuid("venda_id").notNull().references(() => vendas.id, { onDelete: "cascade" }),
  produtoId: uuid("produto_id").references(() => produtos.id, { onDelete: "restrict" }), // vazio = item avulso
  descricao: text("descricao").notNull(),
  quantidade: integer("quantidade").notNull().default(1),
  precoUnitarioCentavos: integer("preco_unitario_centavos").notNull(),
  custoUnitarioCentavos: integer("custo_unitario_centavos"),
  totalCentavos: integer("total_centavos").notNull(),
}, (t) => [
  index("itens_venda_venda_idx").on(t.vendaId),
  check("itens_venda_ck", sql`${t.quantidade} > 0 and ${t.precoUnitarioCentavos} >= 0 and ${t.totalCentavos} = ${t.quantidade} * ${t.precoUnitarioCentavos}`),
]);

// ---------- a prazo / crediário ----------
/** O acordo de uma venda a prazo. Juros é opcional e escolhido em cada venda. */
export const crediarios = pgTable("crediarios", {
  id: id(),
  vendaId: uuid("venda_id").notNull().references(() => vendas.id, { onDelete: "cascade" }),
  clienteId: uuid("cliente_id").notNull().references(() => clientes.id, { onDelete: "restrict" }),
  valorCentavos: integer("valor_centavos").notNull(),
  entradaCentavos: integer("entrada_centavos").notNull().default(0),
  numeroParcelas: smallint("numero_parcelas").notNull(),
  cobrarJuros: boolean("cobrar_juros").notNull().default(false),
  multaPercentual: numeric("multa_percentual", { precision: 5, scale: 2 }).notNull().default("0"),
  jurosMesPercentual: numeric("juros_mes_percentual", { precision: 5, scale: 2 }).notNull().default("0"),
  criadoEm: criadoEm(),
}, (t) => [
  uniqueIndex("crediarios_venda_uq").on(t.vendaId),
  index("crediarios_cliente_idx").on(t.clienteId),
  check("crediarios_ck", sql`${t.numeroParcelas} between 1 and 48 and ${t.valorCentavos} > 0 and ${t.entradaCentavos} >= 0`),
  check("crediarios_juros_ck", sql`${t.multaPercentual} between 0 and 20 and ${t.jurosMesPercentual} between 0 and 20`),
]);

/** Parcelas. O status é calculado na consulta: "pago", "atrasado" (vencimento < hoje) ou "pendente". */
export const parcelas = pgTable("parcelas", {
  id: id(),
  crediarioId: uuid("crediario_id").notNull().references(() => crediarios.id, { onDelete: "cascade" }),
  numero: smallint("numero").notNull(),
  valorCentavos: integer("valor_centavos").notNull(),
  vencimento: date("vencimento").notNull(),
  pagoEm: date("pago_em"),
  valorPagoCentavos: integer("valor_pago_centavos"),
  formaRecebimento: formaPagamento("forma_recebimento"),
  observacao: text("observacao"),
}, (t) => [
  uniqueIndex("parcelas_numero_uq").on(t.crediarioId, t.numero),
  index("parcelas_vencimento_idx").on(t.vencimento),
  check("parcelas_ck", sql`${t.valorCentavos} > 0 and coalesce(${t.valorPagoCentavos}, 0) >= 0`),
]);

// ---------- saídas / gastos ----------
export const categoriasGasto = pgTable("categorias_gasto", {
  id: id(),
  nome: text("nome").notNull(),
  escopo: escopoGasto("escopo").notNull(),
  ativo: boolean("ativo").notNull().default(true),
}, (t) => [uniqueIndex("categorias_nome_uq").on(t.escopo, sql`lower(${t.nome})`)]);

/** Gastos separados em EMPRESA e PESSOAL. */
export const gastos = pgTable("gastos", {
  id: id(),
  escopo: escopoGasto("escopo").notNull(),
  categoriaId: uuid("categoria_id").notNull().references(() => categoriasGasto.id, { onDelete: "restrict" }),
  descricao: text("descricao"),
  valorCentavos: integer("valor_centavos").notNull(),
  data: date("data").notNull().default(sql`current_date`),
  formaPagamento: formaPagamento("forma_pagamento"),
  criadoPor: uuid("criado_por").references(() => usuarios.id, { onDelete: "set null" }),
  criadoEm: criadoEm(),
}, (t) => [index("gastos_data_idx").on(t.escopo, t.data), check("gastos_valor_ck", sql`${t.valorCentavos} > 0`)]);

/** Pagamentos de um crediário (abatimento de qualquer valor, quitando as parcelas mais antigas primeiro). */
export const pagamentosFiado = pgTable("pagamentos_fiado", {
  id: id(),
  crediarioId: uuid("crediario_id").notNull().references(() => crediarios.id, { onDelete: "cascade" }),
  valorCentavos: integer("valor_centavos").notNull(),
  data: date("data").notNull(),
  forma: formaPagamento("forma").notNull(),
  observacao: text("observacao"),
  criadoPor: uuid("criado_por").references(() => usuarios.id, { onDelete: "set null" }),
  criadoEm: criadoEm(),
}, (t) => [index("pagamentos_fiado_crediario_idx").on(t.crediarioId), index("pagamentos_fiado_data_idx").on(t.data), check("pagamentos_fiado_valor_ck", sql`${t.valorCentavos} > 0`)]);

// ---------- contas a pagar ----------
/** Conta FIXA (todo mês, ex.: aluguel) ou DÍVIDA (valor total pago aos poucos, ex.: fornecedor). */
export const contasPagar = pgTable("contas_pagar", {
  id: id(),
  nome: text("nome").notNull(),
  tipo: tipoConta("tipo").notNull(),
  escopo: escopoGasto("escopo").notNull().default("empresa"),
  categoriaId: uuid("categoria_id").notNull().references(() => categoriasGasto.id, { onDelete: "restrict" }),
  valorMensalCentavos: integer("valor_mensal_centavos"),
  valorTotalCentavos: integer("valor_total_centavos"),
  numeroParcelas: smallint("numero_parcelas"),
  diaVencimento: smallint("dia_vencimento"),
  observacao: text("observacao"),
  ativo: boolean("ativo").notNull().default(true),
  criadoEm: criadoEm(),
}, (t) => [
  check("contas_valor_ck", sql`(${t.tipo} = 'fixa' and ${t.valorMensalCentavos} > 0) or (${t.tipo} = 'divida' and ${t.valorTotalCentavos} > 0)`),
  check("contas_dia_ck", sql`${t.diaVencimento} is null or ${t.diaVencimento} between 1 and 31`),
  check("contas_parcelas_ck", sql`${t.numeroParcelas} is null or ${t.numeroParcelas} between 1 and 120`),
]);

/** Cada pagamento de uma conta. Gera também um gasto (saída) — apagar o gasto apaga o pagamento junto. */
export const pagamentosConta = pgTable("pagamentos_conta", {
  id: id(),
  contaId: uuid("conta_id").notNull().references(() => contasPagar.id, { onDelete: "restrict" }),
  gastoId: uuid("gasto_id").notNull().references(() => gastos.id, { onDelete: "cascade" }),
  valorCentavos: integer("valor_centavos").notNull(),
  data: date("data").notNull(),
  criadoEm: criadoEm(),
}, (t) => [index("pagamentos_conta_conta_idx").on(t.contaId), uniqueIndex("pagamentos_conta_gasto_uq").on(t.gastoId), check("pagamentos_conta_valor_ck", sql`${t.valorCentavos} > 0`)]);
