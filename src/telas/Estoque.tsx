// Estoque: produtos e serviços por categoria, com busca, cadastro, edição, entrada/ajuste e alerta de reposição.
import { useState, type FormEvent } from "react";
import { chamar, comFiltros } from "../api";
import { Aviso, Cabecalho, Campo, InputDinheiro, Modal, reais, Resumo, Tabela, useAtrasado, useDados, useFuncionario } from "../ui";

type Categoria = { id: string; nome: string };

export type Produto = {
  id: string; categoriaId: string | null; categoria: string | null; controlaEstoque: boolean; codigo: string; nome: string; marca: string | null;
  unidade: string; precoCentavos: number | null; custoCentavos: number | null; quantidade: number; estoqueMinimo: number; ativo: boolean;
};

export const nomeProduto = (p: Produto) => (p.marca ? `${p.nome} · ${p.marca}` : p.nome);
const repor = (p: Produto) => p.controlaEstoque && p.ativo && p.quantidade <= p.estoqueMinimo;

const VAZIO = { categoriaId: "", controlaEstoque: true, nome: "", marca: "", unidade: "un", codigo: "", precoCentavos: 0, custoCentavos: 0, quantidade: 0, estoqueMinimo: 0, ativo: true };

function FormProduto({ produto, categorias, aoSalvar, aoMudarCategorias }: { produto: Produto | null; categorias: Categoria[]; aoSalvar: () => void; aoMudarCategorias: () => void }) {
  const funcionario = useFuncionario(); // não vê nem mexe no custo
  const [f, setF] = useState(() => (produto ? {
    ...VAZIO, ...produto, categoriaId: produto.categoriaId ?? "", marca: produto.marca ?? "",
    precoCentavos: produto.precoCentavos ?? 0, custoCentavos: produto.custoCentavos ?? 0,
  } : { ...VAZIO, categoriaId: categorias[0]?.id ?? "" }));
  const [erro, setErro] = useState("");
  const [novaCat, setNovaCat] = useState("");
  const muda = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setErro(""); setF((x) => ({ ...x, [k]: v })); };
  const margem = f.precoCentavos && f.custoCentavos ? (f.precoCentavos - f.custoCentavos) / f.precoCentavos : null;

  async function criarCategoria() {
    if (novaCat.trim().length < 2) return;
    const r = await chamar<{ id: string }>("/api/categorias-produto", { nome: novaCat.trim() });
    if (!r.ok) return setErro(r.erro);
    setNovaCat("");
    muda("categoriaId", r.dados.id);
    aoMudarCategorias();
  }
  const escolherCategoria = (id: string) => {
    muda("categoriaId", id);
    if (!produto) muda("controlaEstoque", categorias.find((c) => c.id === id)?.nome !== "Serviços");
  };

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const corpo = {
      nome: f.nome.trim(), marca: f.marca.trim() || null, unidade: f.unidade.trim() || "un", categoriaId: f.categoriaId || null,
      precoCentavos: f.precoCentavos || null, estoqueMinimo: Number(f.estoqueMinimo) || 0, ativo: f.ativo,
      ...(funcionario ? {} : { custoCentavos: f.custoCentavos || null }),
    };
    const r = produto
      ? await chamar("/api/produtos", { id: produto.id, ...corpo }, "PATCH")
      : await chamar("/api/produtos", { ...corpo, controlaEstoque: f.controlaEstoque, quantidade: f.controlaEstoque ? Number(f.quantidade) : 0, ...(f.codigo.trim() ? { codigo: f.codigo.trim() } : {}) });
    if (!r.ok) return setErro(r.erro);
    aoSalvar();
  }

  return (
    <form onSubmit={salvar} className="space-y-3">
      <Campo rotulo="Nome" id="nome"><input id="nome" required value={f.nome} placeholder="Ex.: Fone Bluetooth, Instalação…" autoFocus={!produto} onChange={(e) => muda("nome", e.target.value)} /></Campo>
      <div className="grid grid-cols-2 gap-2">
        <Campo rotulo="Marca" id="marca"><input id="marca" value={f.marca} placeholder="Opcional" onChange={(e) => muda("marca", e.target.value)} /></Campo>
        {produto
          ? <Campo rotulo="Código" id="codigo"><input id="codigo" value={produto.codigo} disabled /></Campo>
          : <Campo rotulo="Código (SKU)" id="codigo" dica="Vazio = gerado sozinho"><input id="codigo" value={f.codigo} placeholder="PRD-020" onChange={(e) => muda("codigo", e.target.value)} /></Campo>}
      </div>
      <Campo rotulo="Categoria" id="pcat">
        <select id="pcat" value={f.categoriaId} onChange={(e) => escolherCategoria(e.target.value)} required>
          <option value="" disabled>Escolha…</option>
          {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </Campo>
      <div className="flex gap-2">
        <input aria-label="Nova categoria" placeholder="Nova categoria…" value={novaCat} onChange={(e) => setNovaCat(e.target.value)} className="entrada !min-h-9 min-w-0 flex-1 !py-1.5 text-sm" />
        <button type="button" onClick={criarCategoria} className="btn btn-contorno !min-h-9 px-3 text-sm">+ Categoria</button>
      </div>
      {!produto && (
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-5 w-5 accent-[#5b5bf0]" checked={!f.controlaEstoque} onChange={(e) => muda("controlaEstoque", !e.target.checked)} /> É serviço (não tem estoque)</label>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Campo rotulo="Preço de venda" id="preco"><InputDinheiro id="preco" valor={f.precoCentavos} aoMudar={(v) => muda("precoCentavos", v)} /></Campo>
        {!funcionario && <Campo rotulo="Custo" id="custo" dica={margem != null ? `Margem: ${(margem * 100).toFixed(0)}%` : "Para calcular o lucro"}><InputDinheiro id="custo" valor={f.custoCentavos} aoMudar={(v) => muda("custoCentavos", v)} /></Campo>}
      </div>
      {f.controlaEstoque && (
        <div className="grid grid-cols-3 gap-2">
          {!produto && <Campo rotulo="Qtd. inicial" id="qtd"><input id="qtd" type="number" min={0} value={f.quantidade} onChange={(e) => muda("quantidade", Number(e.target.value))} /></Campo>}
          <Campo rotulo="Estoque mínimo" id="min"><input id="min" type="number" min={0} value={f.estoqueMinimo} onChange={(e) => muda("estoqueMinimo", Number(e.target.value))} /></Campo>
          <Campo rotulo="Unidade" id="un"><input id="un" value={f.unidade} maxLength={10} onChange={(e) => muda("unidade", e.target.value)} /></Campo>
        </div>
      )}
      {produto && (
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-5 w-5 accent-[#5b5bf0]" checked={f.ativo} onChange={(e) => muda("ativo", e.target.checked)} /> Ativo (aparece na tela de venda)</label>
      )}
      <Aviso msg={erro} />
      <button type="submit" className="btn btn-primario w-full" disabled={!f.categoriaId}>{produto ? "Salvar alterações" : "Cadastrar"}</button>
    </form>
  );
}

function FormMovimento({ produto, aoSalvar }: { produto: Produto; aoSalvar: () => void }) {
  const [tipo, setTipo] = useState<"entrada" | "saida">("entrada");
  const [qtd, setQtd] = useState(1);
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState("");
  async function salvar(e: FormEvent) {
    e.preventDefault();
    const r = await chamar("/api/estoque", {
      produtoId: produto.id, delta: tipo === "entrada" ? qtd : -qtd, motivo: tipo === "entrada" ? "entrada" : "ajuste", observacao: obs || undefined,
    });
    if (!r.ok) return setErro(r.erro);
    aoSalvar();
  }
  return (
    <form onSubmit={salvar} className="space-y-3">
      <p className="text-sm text-suave">{nomeProduto(produto)} · hoje: <b className="text-texto">{produto.quantidade} {produto.unidade}</b> · mínimo {produto.estoqueMinimo}</p>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Movimento">
        {([["entrada", "Entrada"], ["saida", "Ajuste para menos"]] as const).map(([t, n]) => (
          <button key={t} type="button" role="radio" aria-checked={tipo === t} onClick={() => setTipo(t)} className={`btn ${tipo === t ? "btn-primario" : "btn-contorno"}`}>{n}</button>
        ))}
      </div>
      <Campo rotulo="Quantidade" id="mqtd"><input id="mqtd" type="number" min={1} required value={qtd} onChange={(e) => setQtd(Number(e.target.value))} /></Campo>
      <Campo rotulo="Observação" id="obs"><input id="obs" value={obs} maxLength={300} placeholder={tipo === "entrada" ? "Nota fiscal, fornecedor…" : "Perda, contagem…"} onChange={(e) => setObs(e.target.value)} /></Campo>
      <Aviso msg={erro} />
      <button type="submit" className="btn btn-primario w-full">Registrar</button>
    </form>
  );
}

export default function Estoque() {
  const funcionario = useFuncionario();
  const [busca, setBusca] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [soRepor, setSoRepor] = useState(false);
  const termo = useAtrasado(busca.trim());
  const { dados, erro, recarregar } = useDados<Produto[]>(comFiltros("/api/produtos", { busca: termo || undefined, categoriaId: categoriaId || undefined, repor: soRepor ? "1" : undefined }));
  const cats = useDados<Categoria[]>("/api/categorias-produto");
  const [editando, setEditando] = useState<Produto | "novo" | null>(null);
  const [movendo, setMovendo] = useState<Produto | null>(null);
  const fechar = () => { setEditando(null); setMovendo(null); void recarregar(); };
  const lista = dados ?? [];
  const fisicos = lista.filter((p) => p.controlaEstoque && p.ativo);

  return (
    <>
      <Cabecalho titulo="Estoque"><button type="button" className="btn btn-primario" onClick={() => setEditando("novo")}>+ Novo produto</button></Cabecalho>
      <Resumo itens={[
        { rotulo: "Itens em estoque", valor: String(fisicos.reduce((t, p) => t + p.quantidade, 0)), destaque: true },
        { rotulo: "Valor de venda", valor: reais(fisicos.reduce((t, p) => t + p.quantidade * (p.precoCentavos ?? 0), 0)) },
        ...(funcionario ? [] : [{ rotulo: "Valor de custo", valor: reais(fisicos.reduce((t, p) => t + p.quantidade * (p.custoCentavos ?? 0), 0)) }]),
        { rotulo: "Para repor", valor: String(lista.filter(repor).length) },
      ]} />
      <div className="mb-4 flex flex-wrap gap-2">
        <input aria-label="Buscar no estoque" placeholder="Buscar: nome, marca, código, categoria…" value={busca} onChange={(e) => setBusca(e.target.value)} className="entrada min-w-0 flex-1 basis-full sm:basis-0" />
        <select aria-label="Categoria" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} className="entrada !w-auto">
          <option value="">Todas as categorias</option>
          {(cats.dados ?? []).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <button type="button" className="chip !min-h-[44px]" aria-pressed={soRepor} onClick={() => setSoRepor((v) => !v)}>Só para repor</button>
      </div>
      <Aviso msg={erro} />
      <Tabela linhas={dados} chave={(p) => p.id} vazio="Nenhum produto encontrado." aoClicar={(p) => setEditando(p)} colunas={[
        { titulo: "Produto", valor: (p) => (
          <span className={p.ativo ? "" : "text-suave line-through"}>
            <span className="font-semibold">{p.nome}</span>
            <span className="block text-xs text-suave">{[p.codigo, p.marca].filter(Boolean).join(" · ")}</span>
          </span>
        ) },
        { titulo: "Categoria", valor: (p) => p.categoria ?? "—", esconderNoCelular: true },
        { titulo: "Preço", valor: (p) => reais(p.precoCentavos), alinhar: "direita" },
        ...(funcionario ? [] : [{ titulo: "Custo", valor: (p: Produto) => reais(p.custoCentavos), alinhar: "direita" as const, esconderNoCelular: true }]),
        { titulo: "Qtd", alinhar: "direita", valor: (p) => (!p.controlaEstoque ? <span className="text-xs font-semibold text-suave">serviço</span> :
          <button type="button" onClick={(e) => { e.stopPropagation(); setMovendo(p); }}
            className={`rounded-lg px-2.5 py-1 font-semibold tabular-nums ring-1 ${repor(p) ? "bg-red-50 text-red-700 ring-red-200" : "bg-white text-texto ring-borda hover:ring-[#c8cde0]"}`}
            aria-label={`Movimentar estoque de ${nomeProduto(p)}`} title={repor(p) ? `Abaixo do mínimo (${p.estoqueMinimo})` : "Entrada ou ajuste"}>
            {p.quantidade} ±
          </button>
        ) },
      ]} />
      <Modal titulo={editando === "novo" ? "Novo produto" : "Editar produto"} aberto={!!editando} aoFechar={fechar}>
        {editando && <FormProduto produto={editando === "novo" ? null : editando} categorias={cats.dados ?? []} aoMudarCategorias={cats.recarregar} aoSalvar={fechar} />}
      </Modal>
      <Modal titulo="Entrada ou ajuste" aberto={!!movendo} aoFechar={fechar}>{movendo && <FormMovimento produto={movendo} aoSalvar={fechar} />}</Modal>
    </>
  );
}
