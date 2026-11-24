// Formato do retrato dos dados de exemplo (public/demo-dados.json): as linhas de cada tabela, na ordem das chaves estrangeiras.
export const TABELAS_RETRATO = [
  "usuarios", "categorias_produto", "produtos", "clientes", "vendas", "itens_venda", "movimentos_estoque", "crediarios", "parcelas",
  "pagamentos_fiado", "categorias_gasto", "gastos", "contas_pagar", "pagamentos_conta",
] as const;
export type Retrato = { versao: number; dataBase: string; tabelas: Record<string, unknown[]> };
