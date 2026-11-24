// Saídas / gastos: EMPRESA e PESSOAL sempre separados, com total do período, categorias e exclusão.
import { useState, type FormEvent } from "react";
import { chamar, comFiltros } from "../api";
import { Aviso, Cabecalho, Campo, dataBR, FORMAS, hoje, InputDinheiro, Modal, primeiroDiaDoMes, reais, Resumo, Tabela, useDados } from "../ui";

type Categoria = { id: string; nome: string; escopo: "empresa" | "pessoal" };
type Gasto = { id: string; escopo: string; data: string; valorCentavos: number; descricao: string | null; formaPagamento: string | null; categoria: string };

function NovoGasto({ escopo, categorias, aoSalvar, aoMudarCategorias }: { escopo: "empresa" | "pessoal"; categorias: Categoria[]; aoSalvar: () => void; aoMudarCategorias: () => void }) {
  const doEscopo = categorias.filter((c) => c.escopo === escopo);
  const [categoriaId, setCategoriaId] = useState(doEscopo[0]?.id ?? "");
  const [valor, setValor] = useState(0);
  const [data, setData] = useState(hoje());
  const [descricao, setDescricao] = useState("");
  const [forma, setForma] = useState("pix");
  const [novaCat, setNovaCat] = useState("");
  const [erro, setErro] = useState("");

  async function criarCategoria() {
    if (novaCat.trim().length < 2) return;
    const r = await chamar<{ id: string }>("/api/categorias", { nome: novaCat.trim(), escopo });
    if (!r.ok) return setErro(r.erro);
    setNovaCat("");
    setCategoriaId(r.dados.id);
    aoMudarCategorias();
  }
  async function salvar(e: FormEvent) {
    e.preventDefault();
    const r = await chamar("/api/gastos", { categoriaId, valorCentavos: valor, data, formaPagamento: forma, ...(descricao.trim() ? { descricao: descricao.trim() } : {}) });
    if (!r.ok) return setErro(r.erro);
    aoSalvar();
  }
  return (
    <form onSubmit={salvar} className="space-y-3">
      <Campo rotulo="Categoria" id="cat">
        <select id="cat" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} required>
          {doEscopo.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </Campo>
      <div className="flex gap-2">
        <input aria-label="Nova categoria" placeholder="Nova categoria…" value={novaCat} onChange={(e) => setNovaCat(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-borda px-3 py-2 text-sm" />
        <button type="button" onClick={criarCategoria} className="btn btn-contorno min-h-9 px-3 py-1.5 text-sm">Criar</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Campo rotulo="Valor" id="gvalor"><InputDinheiro id="gvalor" required valor={valor} aoMudar={setValor} /></Campo>
        <Campo rotulo="Data" id="gdata"><input id="gdata" type="date" value={data} onChange={(e) => setData(e.target.value)} required /></Campo>
      </div>
      <Campo rotulo="Pago com" id="gforma">
        <select id="gforma" value={forma} onChange={(e) => setForma(e.target.value)}>{Object.entries(FORMAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </Campo>
      <Campo rotulo="Descrição" id="gdesc"><input id="gdesc" value={descricao} maxLength={300} onChange={(e) => setDescricao(e.target.value)} /></Campo>
      <Aviso msg={erro} />
      <button type="submit" className="btn btn-escuro w-full" disabled={!valor || !categoriaId}>Lançar gasto {escopo === "empresa" ? "da empresa" : "pessoal"}</button>
    </form>
  );
}

export default function Gastos() {
  const [escopo, setEscopo] = useState<"empresa" | "pessoal">("empresa");
  const [de, setDe] = useState(primeiroDiaDoMes());
  const [ate, setAte] = useState(hoje());
  const { dados, erro, recarregar } = useDados<{ gastos: Gasto[]; totalCentavos: number }>(comFiltros("/api/gastos", { escopo, de, ate }));
  const cats = useDados<Categoria[]>("/api/categorias");
  const [novo, setNovo] = useState(false);
  const [msg, setMsg] = useState("");

  async function excluir(g: Gasto) {
    if (!confirm(`Excluir o gasto de ${reais(g.valorCentavos)} (${g.categoria})?`)) return;
    const r = await chamar(`/api/gastos?id=${g.id}`, undefined, "DELETE");
    setMsg(r.ok ? "" : r.erro);
    void recarregar();
  }
  const porCategoria = Object.entries((dados?.gastos ?? []).reduce<Record<string, number>>((m, g) => ({ ...m, [g.categoria]: (m[g.categoria] ?? 0) + g.valorCentavos }), {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 3);

  return (
    <>
      <Cabecalho titulo="Gastos"><button type="button" className="btn btn-escuro" onClick={() => setNovo(true)} disabled={!cats.dados}>+ Lançar gasto</button></Cabecalho>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="flex gap-2" role="tablist">
          {(["empresa", "pessoal"] as const).map((e) => (
            <button key={e} type="button" role="tab" aria-selected={escopo === e} onClick={() => setEscopo(e)} className={`btn min-h-10 px-5 ${escopo === e ? "btn-escuro" : "btn-contorno"}`}>{e === "empresa" ? "Empresa" : "Pessoal"}</button>
          ))}
        </div>
        <Campo rotulo="De" id="gde"><input id="gde" type="date" value={de} onChange={(e) => setDe(e.target.value)} /></Campo>
        <Campo rotulo="Até" id="gate"><input id="gate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></Campo>
      </div>
      <Resumo itens={[
        { rotulo: `Total ${escopo === "empresa" ? "da empresa" : "pessoal"}`, valor: reais(dados?.totalCentavos ?? 0), destaque: true },
        ...porCategoria.map(([c, v]) => ({ rotulo: c, valor: reais(v) })),
      ]} />
      <Aviso msg={erro || msg} />
      <Tabela linhas={dados?.gastos ?? null} chave={(g) => g.id} vazio="Nenhum gasto no período." colunas={[
        { titulo: "Data", valor: (g) => dataBR(g.data) },
        { titulo: "Categoria", valor: (g) => <b>{g.categoria}</b> },
        { titulo: "Descrição", valor: (g) => g.descricao ?? "—", esconderNoCelular: true },
        { titulo: "Pago com", valor: (g) => (g.formaPagamento ? FORMAS[g.formaPagamento] : "—"), esconderNoCelular: true },
        { titulo: "Valor", valor: (g) => reais(g.valorCentavos), alinhar: "direita" },
        { titulo: "", valor: (g) => <button type="button" onClick={() => excluir(g)} className="text-xs font-semibold text-red-700 hover:underline" aria-label={`Excluir gasto ${g.categoria}`}>Excluir</button>, alinhar: "direita" },
      ]} />
      <Modal titulo={`Novo gasto ${escopo === "empresa" ? "da empresa" : "pessoal"}`} aberto={novo} aoFechar={() => setNovo(false)}>
        {novo && cats.dados && <NovoGasto escopo={escopo} categorias={cats.dados} aoMudarCategorias={cats.recarregar} aoSalvar={() => { setNovo(false); void recarregar(); }} />}
      </Modal>
    </>
  );
}
