// Direciona "/api/<recurso>" para a operação certa. Na demonstração, isso roda no próprio navegador (sem servidor):
// o painel chama `rotear()` como se fosse uma API HTTP, e o resultado volta no mesmo formato.
// Toda entrada passa pelo Zod. Funcionário: só as operações marcadas com "equipe" (vender, estoque, clientes,
// receber a prazo); o resto (resumo, gastos, contas, custo, cancelar, backup…) responde 403 para ele.
import { z } from "zod";
import { gerarBackup } from "./backup";
import { esquemaDashboard, resumo } from "./dashboard";
import { criarCliente, detalheCliente, editarCliente, esquemaEditarCliente, esquemaListaClientes, esquemaNovoCliente, listarClientes } from "./clientes";
import { ErroPainel, hojeSP, type Ctx } from "./comum";
import { criarCategoriaProduto, criarProduto, editarProduto, esquemaEditarProduto, esquemaListaProdutos, esquemaMovimento, esquemaNovaCategoriaProduto, esquemaNovoProduto, listarCategoriasProduto, listarProdutos, movimentar } from "./estoque";
import { esquemaEstornarFiado, esquemaListaCrediarios, esquemaListaParcelas, esquemaReceber, esquemaReceberCliente, estornarFiado, listarCrediarios, listarParcelas, receberFiado, receberFiadoCliente } from "./fiado";
import { criarConta, editarConta, esquemaEditarConta, esquemaListaContas, esquemaNovaConta, esquemaPagarConta, estornarConta, listarContas, pagarConta } from "./contas";
import { criarCategoria, criarGasto, esquemaListaGastos, esquemaNovaCategoria, esquemaNovoGasto, excluirGasto, listarCategorias, listarGastos } from "./gastos";
import { cancelarVenda, criarFiado, criarVenda, esquemaCancelarVenda, esquemaListaVendas, esquemaNovaVenda, esquemaNovoFiado, listarVendas } from "./vendas";

export type Metodo = "GET" | "POST" | "PATCH" | "DELETE";
type Executar = (ctx: Ctx, dados: never) => Promise<unknown>;
type Operacao = { esquema: z.ZodType; executar: Executar; status?: number; equipe?: Executar };

const op = <T extends z.ZodType>(esquema: T, executar: (ctx: Ctx, dados: z.infer<T>) => Promise<unknown>, status = 200, equipe?: true | ((ctx: Ctx, dados: z.infer<T>) => Promise<unknown>)): Operacao =>
  ({ esquema, executar: executar as Executar, status, equipe: (equipe === true ? executar : equipe) as Executar | undefined });
const negar = (msg: string): never => { throw new ErroPainel(403, msg); };

const semFiltro = z.object({});
const comId = z.object({ id: z.uuid() });

const ROTAS: Record<string, Partial<Record<Metodo, Operacao>>> = {
  produtos: {
    // funcionário vê preço e quantidade, nunca o custo
    GET: op(esquemaListaProdutos, listarProdutos, 200, async (ctx, f) => (await listarProdutos(ctx, f)).map((p) => ({ ...p, custoCentavos: null }))),
    POST: op(esquemaNovoProduto, criarProduto, 201, (ctx, d) => criarProduto(ctx, { ...d, custoCentavos: undefined })),
    PATCH: op(esquemaEditarProduto, editarProduto, 200, (ctx, d) => editarProduto(ctx, { ...d, custoCentavos: undefined })),
  },
  estoque: { POST: op(esquemaMovimento, movimentar, 200, true) },
  clientes: {
    GET: op(esquemaListaClientes, (ctx, f) => (f.id ? detalheCliente(ctx, f.id) : listarClientes(ctx, f)), 200, true),
    POST: op(esquemaNovoCliente, criarCliente, 201, true),
    PATCH: op(esquemaEditarCliente, editarCliente, 200, true),
  },
  vendas: {
    // funcionário só vê as vendas de hoje
    GET: op(esquemaListaVendas, listarVendas, 200, (ctx) => listarVendas(ctx, { de: hojeSP(), ate: hojeSP() })),
    POST: op(esquemaNovaVenda, criarVenda, 201, true),
    PATCH: op(esquemaCancelarVenda, cancelarVenda),
  },
  fiados: { POST: op(esquemaNovoFiado, criarFiado, 201, true) },
  parcelas: { GET: op(esquemaListaParcelas, listarParcelas) },
  crediarios: { GET: op(esquemaListaCrediarios, listarCrediarios, 200, (ctx, f) => (f.clienteId ? listarCrediarios(ctx, f) : negar("Abra o crediário pela ficha do cliente."))) },
  "pagamentos-cliente": { POST: op(esquemaReceberCliente, receberFiadoCliente, 201, true) },
  "pagamentos-fiado": { POST: op(esquemaReceber, receberFiado, 201, true), DELETE: op(esquemaEstornarFiado, estornarFiado) },
  contas: { GET: op(esquemaListaContas, listarContas), POST: op(esquemaNovaConta, criarConta, 201), PATCH: op(esquemaEditarConta, editarConta) },
  "pagamentos-conta": { POST: op(esquemaPagarConta, pagarConta, 201), DELETE: op(comId, (ctx, d) => estornarConta(ctx, d.id)) },
  "categorias-produto": { GET: op(semFiltro, listarCategoriasProduto, 200, true), POST: op(esquemaNovaCategoriaProduto, criarCategoriaProduto, 201, true) },
  categorias: { GET: op(semFiltro, listarCategorias), POST: op(esquemaNovaCategoria, criarCategoria, 201) },
  gastos: { GET: op(esquemaListaGastos, listarGastos), POST: op(esquemaNovoGasto, criarGasto, 201), DELETE: op(comId, (ctx, d) => excluirGasto(ctx, d.id)) },
  backup: { GET: op(semFiltro, gerarBackup) },
  dashboard: { GET: op(esquemaDashboard, resumo) },
};

// Nome de cada campo para a mensagem de erro (quem usa o painel precisa saber o que corrigir).
const NOMES_CAMPOS: Record<string, string> = {
  nome: "nome", marca: "marca", unidade: "unidade", codigo: "código", precoCentavos: "preço", custoCentavos: "custo",
  quantidade: "quantidade", categoriaId: "categoria", valorCentavos: "valor", data: "data", email: "e-mail",
  telefone: "telefone", itens: "produtos da venda", clienteId: "cliente", descontoCentavos: "desconto", diaVencimento: "dia do vencimento",
  estoqueMinimo: "estoque mínimo",
};
const nomeDoCampo = (caminho: PropertyKey[]) => {
  const campo = [...caminho].reverse().find((p) => typeof p === "string") as string | undefined;
  return campo ? (NOMES_CAMPOS[campo] ?? campo) : "dados";
};

export type RespostaApi = { status: number; corpo: unknown };

/** Executa uma chamada do painel: valida a entrada, confere o papel e roda a regra de negócio. */
export async function rotear(ctxBase: Omit<Ctx, "papel">, papel: "dono" | "funcionario", metodo: Metodo, caminho: string, corpo?: unknown): Promise<RespostaApi> {
  const url = new URL(caminho, "http://local");
  const recurso = url.pathname.replace(/\/+$/, "").split("/").pop() ?? "";
  const operacao = ROTAS[recurso]?.[metodo];
  if (!operacao) return { status: ROTAS[recurso] ? 405 : 404, corpo: { erro: "Operação não encontrada." } };

  const bruto = metodo === "GET" || metodo === "DELETE" ? Object.fromEntries(url.searchParams) : corpo;
  const r = operacao.esquema.safeParse(bruto);
  if (!r.success) {
    const nomes = [...new Set(r.error.issues.map((i) => nomeDoCampo(i.path)))];
    return { status: 400, corpo: { erro: `Dados inválidos. Confira: ${nomes.join(", ")}.` } };
  }

  const executar = papel === "funcionario" ? operacao.equipe : operacao.executar;
  if (!executar) return { status: 403, corpo: { erro: "Só o dono tem acesso a isso." } };
  try {
    const resultado = await executar({ ...ctxBase, papel }, r.data as never);
    return { status: operacao.status ?? 200, corpo: resultado };
  } catch (e) {
    if (e instanceof ErroPainel) return { status: e.status, corpo: { erro: e.message } };
    console.error(`[api] ${metodo} ${recurso}:`, e);
    return { status: 500, corpo: { erro: "Não foi possível concluir. Tente de novo." } };
  }
}
