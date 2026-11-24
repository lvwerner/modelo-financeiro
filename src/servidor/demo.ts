// Dados de exemplo da demonstração: uma pequena empresa de comércio + serviços com 6 meses de movimento.
// Tudo é criado pelas MESMAS regras de negócio do painel (vendas baixam estoque, a prazo gera parcelas, contas geram gastos…),
// então os números do Resumo batem com as telas. Os valores são fictícios.
import { eq } from "drizzle-orm";
import type { Db } from "./banco";
import { hojeSP, somarMeses, type Ctx, type Lote } from "./comum";
import { categoriasGasto, categoriasProduto, crediarios, parcelas, usuarios } from "./schema";
import { criarProduto, movimentar } from "./estoque";
import { criarCliente } from "./clientes";
import { criarVenda } from "./vendas";
import { receberFiado } from "./fiado";
import { criarGasto } from "./gastos";
import { criarConta, pagarConta } from "./contas";

/** Sorteio com semente fixa: todo visitante vê os mesmos dados. */
function sorteador(semente: number) {
  let a = semente;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const somarDias = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);
const r$ = (reais: number) => Math.round(reais * 100);

const PRODUTOS: { cat: string; nome: string; marca?: string; preco: number; custo: number; qtd: number; min: number; servico?: boolean; un?: string; peso: number }[] = [
  { cat: "Acessórios", nome: "Fone Bluetooth", marca: "Sonora", preco: 189.9, custo: 92, qtd: 14, min: 8, peso: 6 },
  { cat: "Acessórios", nome: "Carregador USB-C 25W", marca: "Voltix", preco: 89.9, custo: 38, qtd: 50, min: 10, peso: 9 },
  { cat: "Acessórios", nome: "Cabo USB-C 1,5 m", marca: "Voltix", preco: 39.9, custo: 12.5, qtd: 28, min: 20, peso: 10 },
  { cat: "Acessórios", nome: "Capa protetora", marca: "Shield", preco: 59.9, custo: 18, qtd: 60, min: 15, peso: 10 },
  { cat: "Acessórios", nome: "Película de vidro", marca: "Shield", preco: 49.9, custo: 9, qtd: 70, min: 20, peso: 11 },
  { cat: "Acessórios", nome: "Suporte veicular", marca: "Fixa", preco: 79.9, custo: 31, qtd: 18, min: 6, peso: 3 },
  { cat: "Eletrônicos", nome: "Smartwatch Fit", marca: "Pulse", preco: 499, custo: 290, qtd: 6, min: 4, peso: 3 },
  { cat: "Eletrônicos", nome: "Caixa de som portátil", marca: "Sonora", preco: 349, custo: 180, qtd: 14, min: 4, peso: 3 },
  { cat: "Eletrônicos", nome: "Power bank 10.000 mAh", marca: "Voltix", preco: 159.9, custo: 74, qtd: 24, min: 6, peso: 5 },
  { cat: "Eletrônicos", nome: "Mouse sem fio", marca: "Clik", preco: 99.9, custo: 41, qtd: 18, min: 6, peso: 4 },
  { cat: "Eletrônicos", nome: "Teclado mecânico", marca: "Clik", preco: 389, custo: 205, qtd: 8, min: 3, peso: 2 },
  { cat: "Serviços", nome: "Troca de tela", preco: 350, custo: 160, qtd: 0, min: 0, servico: true, un: "serv", peso: 5 },
  { cat: "Serviços", nome: "Troca de bateria", preco: 220, custo: 85, qtd: 0, min: 0, servico: true, un: "serv", peso: 4 },
  { cat: "Serviços", nome: "Limpeza e revisão", preco: 120, custo: 15, qtd: 0, min: 0, servico: true, un: "serv", peso: 4 },
  { cat: "Serviços", nome: "Configuração e backup", preco: 90, custo: 0, qtd: 0, min: 0, servico: true, un: "serv", peso: 3 },
];

const CLIENTES = [
  ["Mariana Costa", "11991234501", "São Paulo", "Pinheiros"], ["Rafael Almeida", "11991234502", "São Paulo", "Moema"],
  ["Juliana Pereira", "11991234503", "Campinas", "Cambuí"], ["Bruno Oliveira", "11991234504", "Curitiba", "Batel"],
  ["Camila Rodrigues", "11991234505", "Belo Horizonte", "Savassi"], ["Lucas Fernandes", "11991234506", "Rio de Janeiro", "Botafogo"],
  ["Patrícia Gomes", "11991234507", "Porto Alegre", "Moinhos de Vento"], ["Thiago Martins", "11991234508", "São Paulo", "Tatuapé"],
  ["Fernanda Ribeiro", "11991234509", "Florianópolis", "Centro"], ["Diego Carvalho", "11991234510", "Santos", "Gonzaga"],
  ["Aline Souza", "11991234511", "São Paulo", "Vila Mariana"], ["Gustavo Lima", "11991234512", "Goiânia", "Setor Bueno"],
  ["Renata Barbosa", "11991234513", "Curitiba", "Água Verde"], ["Felipe Araújo", "11991234514", "Ribeirão Preto", "Jardim Irajá"],
  ["Beatriz Rocha", "11991234515", "São Paulo", "Santana"], ["Eduardo Teixeira", "11991234516", "Brasília", "Asa Sul"],
  ["Larissa Mendes", "11991234517", "Campinas", "Taquaral"], ["Rodrigo Nunes", "11991234518", "Salvador", "Barra"],
] as const;

const CATEGORIAS_GASTO: [string, "empresa" | "pessoal"][] = [
  ["Aluguel", "empresa"], ["Energia", "empresa"], ["Internet e telefone", "empresa"], ["Fornecedores", "empresa"],
  ["Salários", "empresa"], ["Impostos", "empresa"], ["Marketing", "empresa"], ["Manutenção", "empresa"], ["Material de escritório", "empresa"],
  ["Mercado", "pessoal"], ["Combustível", "pessoal"], ["Lazer", "pessoal"], ["Saúde", "pessoal"],
];

export async function popularDemonstracao(db: Db, lote: Lote) {
  const sorte = sorteador(2026);
  const entre = (a: number, b: number) => a + Math.floor(sorte() * (b - a + 1));
  const escolher = <T,>(lista: readonly T[]) => lista[Math.floor(sorte() * lista.length)];
  const hoje = hojeSP();
  const inicio = somarDias(hoje, -182);

  const [dono] = await db.insert(usuarios).values([
    { nome: "Ana Ribeiro", email: "dono@empresa.demo", papel: "dono" },
    { nome: "Carlos Lima", email: "equipe@empresa.demo", papel: "funcionario" },
  ]).returning();
  const ctx: Ctx = { db, lote, usuarioId: dono.id, ip: "demo", papel: "dono" };

  // categorias
  const catsProduto = await db.insert(categoriasProduto).values([...new Set(PRODUTOS.map((p) => p.cat))].map((nome) => ({ nome }))).returning();
  const catsGasto = await db.insert(categoriasGasto).values(CATEGORIAS_GASTO.map(([nome, escopo]) => ({ nome, escopo }))).returning();
  const catGasto = (nome: string) => catsGasto.find((c) => c.nome === nome)!.id;

  // produtos e serviços (estoque inicial alto: as vendas dos 6 meses vão baixando)
  const produtos: { id: string; preco: number; peso: number; servico: boolean; estoque: number; alvo: number }[] = [];
  for (const [i, p] of PRODUTOS.entries()) {
    const estoqueInicial = p.servico ? 0 : p.qtd;
    const { id } = await criarProduto(ctx, {
      codigo: `${p.servico ? "SRV" : "PRD"}-${String(i + 1).padStart(3, "0")}`, nome: p.nome, marca: p.marca ?? null, unidade: p.un ?? "un",
      categoriaId: catsProduto.find((c) => c.nome === p.cat)!.id, controlaEstoque: !p.servico, precoCentavos: r$(p.preco), custoCentavos: r$(p.custo),
      quantidade: estoqueInicial, estoqueMinimo: p.min, ativo: true,
    });
    produtos.push({ id, preco: r$(p.preco), peso: p.peso, servico: !!p.servico, estoque: estoqueInicial, alvo: p.qtd });
  }
  const pesoTotal = produtos.reduce((t, p) => t + p.peso, 0);
  const sortearProduto = () => {
    let x = sorte() * pesoTotal;
    for (const p of produtos) { x -= p.peso; if (x <= 0) return p; }
    return produtos[0];
  };

  // clientes
  const clientes: string[] = [];
  for (const [nome, telefone, cidade, bairro] of CLIENTES) {
    const { id } = await criarCliente(ctx, { nome, telefone, cidade, bairro, email: `${nome.split(" ")[0].toLowerCase()}@email.demo`, documento: null, empresa: null, observacoes: null });
    clientes.push(id);
  }

  // vendas: mais movimento nos meses recentes e aos sábados
  const prazoVendas: { vendaId: string; data: string }[] = [];
  for (let d = 0; d <= 182; d++) {
    const data = somarDias(inicio, d);
    const diaSemana = new Date(`${data}T12:00:00Z`).getUTCDay();
    if (diaSemana === 0) continue; // domingo fechado
    // reposição de 15 em 15 dias (menos no último mês: alguns itens chegam ao mínimo, para o painel mostrar o alerta)
    if (d % 15 === 1 && d < 160) {
      for (const p of produtos.filter((x) => !x.servico && x.estoque < x.alvo)) {
        await movimentar(ctx, { produtoId: p.id, delta: p.alvo - p.estoque, motivo: "entrada", observacao: "Compra do fornecedor" });
        p.estoque = p.alvo;
      }
    }
    const crescimento = 0.75 + (d / 182) * 0.5;
    const n = Math.round((diaSemana === 6 ? 4 : 2.4) * crescimento * (0.6 + sorte() * 0.8));
    for (let k = 0; k < n; k++) {
      const itens = new Map<string, number>();
      const qtdItens = sorte() < 0.7 ? 1 : entre(2, 3);
      for (let j = 0; j < qtdItens; j++) {
        const p = sortearProduto();
        const q = p.servico || p.preco > 30000 ? 1 : entre(1, 2);
        if (!p.servico && p.estoque - (itens.get(p.id) ?? 0) < q) continue;
        itens.set(p.id, (itens.get(p.id) ?? 0) + q);
      }
      if (!itens.size) continue;
      const subtotal = [...itens].reduce((t, [id, q]) => t + produtos.find((p) => p.id === id)!.preco * q, 0);
      const s = sorte();
      const forma = s < 0.42 ? "pix" : s < 0.75 ? "cartao" : s < 0.9 ? "dinheiro" : "prazo";
      const comCliente = forma === "prazo" || sorte() < 0.45;
      const desconto = sorte() < 0.18 ? Math.round(subtotal * 0.05 / 100) * 100 : 0;
      const total = subtotal - desconto;
      try {
        const venda = await criarVenda(ctx, {
          data, clienteId: comCliente ? escolher(clientes) : null, itens: [...itens].map(([produtoId, quantidade]) => ({ produtoId, quantidade })),
          descontoCentavos: desconto, formaPagamento: forma, parcelasCartao: forma === "cartao" ? (total > 30000 ? entre(1, 6) : 1) : undefined,
          prazo: forma === "prazo" ? {
            entradaCentavos: sorte() < 0.5 ? Math.round(total * 0.2 / 100) * 100 : 0, numeroParcelas: total > 40000 ? entre(2, 4) : entre(1, 2),
            primeiroVencimento: somarMeses(data, 1), cobrarJuros: sorte() < 0.5, multaPercentual: 2, jurosMesPercentual: 1,
          } : undefined,
        });
        for (const [id, q] of itens) { const p = produtos.find((x) => x.id === id)!; if (!p.servico) p.estoque -= q; }
        if (forma === "prazo") prazoVendas.push({ vendaId: venda.id, data });
      } catch { /* estoque acabou: pula */ }
    }
  }

  // recebimentos a prazo: a maioria paga em dia; alguns atrasam (para o painel mostrar cobranças)
  for (const v of prazoVendas) {
    const [cr] = await db.select().from(crediarios).where(eq(crediarios.vendaId, v.vendaId));
    const ps = await db.select().from(parcelas).where(eq(parcelas.crediarioId, cr.id));
    const atrasa = sorte() < 0.22;
    for (const p of ps.sort((a, b) => a.numero - b.numero)) {
      if (p.vencimento > hoje) break;
      if (atrasa && p.vencimento > somarDias(hoje, -75)) break;
      const dataPg = somarDias(p.vencimento, -entre(0, 5));
      await receberFiado(ctx, { crediarioId: cr.id, valorCentavos: p.valorCentavos, data: dataPg > hoje ? hoje : dataPg, forma: escolher(["pix", "dinheiro", "cartao"] as const) });
    }
  }

  // contas fixas e dívidas, com os pagamentos dos meses que já passaram
  const contas = [
    { nome: "Aluguel da sala", cat: "Aluguel", valor: 3200, dia: 5 },
    { nome: "Energia elétrica", cat: "Energia", valor: 480, dia: 12 },
    { nome: "Internet fibra + telefone", cat: "Internet e telefone", valor: 189.9, dia: 15 },
    { nome: "Salário — atendente", cat: "Salários", valor: 2600, dia: 5 },
    { nome: "Simples Nacional", cat: "Impostos", valor: 1150, dia: 20 },
  ];
  for (const c of contas) {
    const { id } = await criarConta(ctx, { tipo: "fixa", nome: c.nome, categoriaId: catGasto(c.cat), valorMensalCentavos: r$(c.valor), diaVencimento: c.dia, observacao: null });
    for (let m = 5; m >= 0; m--) {
      const venc = `${somarMeses(hoje, -m).slice(0, 8)}${String(c.dia).padStart(2, "0")}`;
      if (venc > hoje) continue;
      const variacao = c.cat === "Energia" || c.cat === "Impostos" ? 0.85 + sorte() * 0.3 : 1;
      await pagarConta(ctx, { contaId: id, valorCentavos: Math.round(r$(c.valor) * variacao), data: venc, forma: "pix" });
    }
  }
  const divida = await criarConta(ctx, { tipo: "divida", nome: "Fornecedor de eletrônicos", categoriaId: catGasto("Fornecedores"), valorTotalCentavos: r$(18000), numeroParcelas: 10, diaVencimento: 10, observacao: "Compra de estoque parcelada" });
  for (let m = 5; m >= 0; m--) {
    const venc = `${somarMeses(hoje, -m).slice(0, 8)}10`;
    if (venc <= hoje) await pagarConta(ctx, { contaId: divida.id, valorCentavos: r$(1800), data: venc, forma: "pix" });
  }
  await criarConta(ctx, { tipo: "divida", nome: "Empréstimo capital de giro", categoriaId: catGasto("Fornecedores"), valorTotalCentavos: r$(12000), numeroParcelas: 12, diaVencimento: 25, observacao: "Banco — 12x" });

  // gastos avulsos da empresa e pessoais
  const avulsos: [string, string, number, number, number][] = [
    // categoria, descrição, mín, máx, vezes por mês
    ["Marketing", "Anúncios nas redes sociais", 150, 450, 2],
    ["Manutenção", "Ferramentas e peças", 80, 300, 1],
    ["Material de escritório", "Papelaria e embalagens", 40, 160, 1],
    ["Fornecedores", "Reposição de acessórios", 600, 1800, 2],
    ["Mercado", "Compras do mês", 300, 900, 2],
    ["Combustível", "Abastecimento", 150, 280, 3],
    ["Lazer", "Restaurante / passeio", 80, 260, 1],
    ["Saúde", "Farmácia", 40, 180, 1],
  ];
  for (let m = 5; m >= 0; m--) {
    for (const [cat, descricao, min, max, vezes] of avulsos) {
      for (let v = 0; v < vezes; v++) {
        const data = `${somarMeses(hoje, -m).slice(0, 8)}${String(entre(1, 28)).padStart(2, "0")}`;
        if (data > hoje) continue;
        await criarGasto(ctx, { categoriaId: catGasto(cat), valorCentavos: r$(entre(min, max)), data, descricao, formaPagamento: escolher(["pix", "cartao", "dinheiro"] as const) });
      }
    }
  }
}
