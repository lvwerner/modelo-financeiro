// Contas a pagar: fixas do mês (aluguel, luz) e dívidas pagas aos poucos (fornecedor). Cada baixa vira uma saída em Gastos.
import { useState, type FormEvent } from "react";
import { chamar } from "../api";
import { Aviso, Cabecalho, Campo, dataBR, Etiqueta, FORMAS, hoje, InputDinheiro, Modal, reais, Resumo, RodapeModal, Segmentos, Tabela, useAvisar, useDados } from "../ui";

type Categoria = { id: string; nome: string; escopo: "empresa" | "pessoal" };
type Pagamento = { id: string; valorCentavos: number; data: string; forma: string | null; observacao: string | null; saldoDepoisCentavos: number | null };
type Conta = {
  id: string; nome: string; tipo: "fixa" | "divida"; escopo: "empresa" | "pessoal"; categoriaId: string; categoria: string;
  valorMensalCentavos: number | null; valorTotalCentavos: number | null; numeroParcelas: number | null; diaVencimento: number | null;
  observacao: string | null; ativo: boolean; pagoCentavos: number; pagoNoMesCentavos: number; faltaNoMesCentavos: number | null;
  saldoCentavos: number | null; situacao: "paga no mês" | "vencida" | "a pagar" | "quitada"; parcelasPagas: number | null; historico: Pagamento[];
};

const Situacao = ({ c }: { c: Conta }) => <Etiqueta valor={c.situacao} />;
const falta = (c: Conta) => (c.tipo === "divida" ? (c.saldoCentavos ?? 0) : (c.faltaNoMesCentavos ?? 0));
// a saída em Gastos leva "Nome · observação"; aqui só a observação interessa
const obsPagamento = (c: Conta, p: Pagamento) => (p.observacao ?? "").replace(c.nome, "").replace(/^\s*·\s*/, "").trim();
const valorParcela =(c: Conta) => (c.tipo === "divida" && c.numeroParcelas ? Math.round((c.valorTotalCentavos ?? 0) / c.numeroParcelas) : null);

function FormConta({ conta, categorias, aoSalvar }: { conta: Conta | null; categorias: Categoria[]; aoSalvar: () => void }) {
  const [tipo, setTipo] = useState<"fixa" | "divida">(conta?.tipo ?? "fixa");
  const [nome, setNome] = useState(conta?.nome ?? "");
  const [categoriaId, setCategoriaId] = useState(conta?.categoriaId ?? categorias.find((c) => c.escopo === "empresa")?.id ?? "");
  const [valor, setValor] = useState(conta ? (conta.tipo === "fixa" ? conta.valorMensalCentavos : conta.valorTotalCentavos) ?? 0 : 0);
  const [parcelas, setParcelas] = useState(conta?.numeroParcelas ?? 0);
  const [dia, setDia] = useState(conta?.diaVencimento ?? 0);
  const [obs, setObs] = useState(conta?.observacao ?? "");
  const [erro, setErro] = useState("");
  async function salvar(e: FormEvent) {
    e.preventDefault();
    const corpo = {
      nome: nome.trim(), categoriaId, diaVencimento: dia || null, observacao: obs.trim() || null,
      ...(tipo === "fixa" ? { valorMensalCentavos: valor } : { valorTotalCentavos: valor, numeroParcelas: parcelas || null }),
    };
    const r = conta ? await chamar("/api/contas", { id: conta.id, ...corpo }, "PATCH") : await chamar("/api/contas", { tipo, ...corpo });
    if (!r.ok) return setErro(r.erro);
    aoSalvar();
  }
  async function encerrar() {
    if (!conta || !confirm(`Encerrar a conta "${conta.nome}"? Ela some da lista, mas os pagamentos continuam nos gastos.`)) return;
    const r = await chamar("/api/contas", { id: conta.id, ativo: false }, "PATCH");
    if (!r.ok) return setErro(r.erro);
    aoSalvar();
  }
  return (
    <form onSubmit={salvar} className="space-y-3">
      {!conta && (
        <Segmentos rotulo="Tipo de conta" valor={tipo} aoMudar={setTipo} opcoes={[["fixa", "Fixa do mês"], ["divida", "Dívida / parcelada"]]} />
      )}
      <p className="text-xs text-suave">{tipo === "fixa" ? "Todo mês o mesmo valor: aluguel, luz, internet, contador…" : "Um valor total que vai sendo pago aos poucos: fornecedor, empréstimo…"}</p>
      <Campo rotulo="Nome" id="cnome"><input id="cnome" required minLength={2} maxLength={80} value={nome} placeholder={tipo === "fixa" ? "Aluguel" : "Fornecedor"} onChange={(e) => setNome(e.target.value)} /></Campo>
      <Campo rotulo="Categoria (em Gastos)" id="ccat">
        <select id="ccat" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} required>
          {(["empresa", "pessoal"] as const).map((esc) => (
            <optgroup key={esc} label={esc === "empresa" ? "Empresa" : "Pessoal"}>
              {categorias.filter((c) => c.escopo === esc).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </optgroup>
          ))}
        </select>
      </Campo>
      <div className="grid grid-cols-2 gap-2">
        <Campo rotulo={tipo === "fixa" ? "Valor por mês" : "Valor total da dívida"} id="cvalor"><InputDinheiro id="cvalor" required valor={valor} aoMudar={setValor} /></Campo>
        <Campo rotulo="Vence todo dia" id="cdia"><input id="cdia" type="number" min={1} max={31} value={dia || ""} placeholder="10" onChange={(e) => setDia(Number(e.target.value))} /></Campo>
      </div>
      {tipo === "divida" && (
        <Campo rotulo="Em quantas parcelas (opcional)" id="cparc" dica={parcelas && valor ? `${parcelas}x de ${reais(Math.round(valor / parcelas))}` : "Deixe vazio se paga quanto der, sem parcela fixa."}>
          <input id="cparc" type="number" min={1} max={120} value={parcelas || ""} onChange={(e) => setParcelas(Number(e.target.value))} />
        </Campo>
      )}
      <Campo rotulo="Observação" id="cobs"><input id="cobs" value={obs} maxLength={300} onChange={(e) => setObs(e.target.value)} /></Campo>
      <RodapeModal>
        <Aviso msg={erro} />
        <div className="flex gap-2">
          {conta && <button type="button" onClick={encerrar} className="btn btn-perigo">Encerrar conta</button>}
          <button type="submit" className="btn btn-primario flex-1" disabled={!valor || !categoriaId}>{conta ? "Salvar alterações" : "Cadastrar conta"}</button>
        </div>
      </RodapeModal>
    </form>
  );
}

function DetalheConta({ c, aoMudar, aoEditar }: { c: Conta; aoMudar: () => void; aoEditar: () => void }) {
  const sugestao = c.tipo === "fixa" ? (c.faltaNoMesCentavos ?? 0) : Math.min(valorParcela(c) ?? 0, c.saldoCentavos ?? 0);
  const [valor, setValor] = useState(sugestao);
  const [data, setData] = useState(hoje());
  const [forma, setForma] = useState("pix");
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState("");
  const avisar = useAvisar();
  async function pagar(e: FormEvent) {
    e.preventDefault();
    const r = await chamar("/api/pagamentos-conta", { contaId: c.id, valorCentavos: valor, data, forma, ...(obs.trim() ? { observacao: obs.trim() } : {}) });
    if (!r.ok) return setErro(r.erro);
    setErro(""); setObs(""); setValor(0);
    avisar("Pagamento registrado e lançado em Gastos.");
    aoMudar();
  }
  async function estornar(p: Pagamento) {
    if (!confirm(`Desfazer o pagamento de ${reais(p.valorCentavos)} de ${dataBR(p.data)}? A saída em Gastos também é apagada.`)) return;
    const r = await chamar(`/api/pagamentos-conta?id=${p.id}`, undefined, "DELETE");
    if (!r.ok) return setErro(r.erro);
    avisar("Pagamento desfeito.");
    aoMudar();
  }
  const quitada = c.situacao === "quitada";
  return (
    <div className="space-y-4">
      {c.tipo === "divida" ? (
        <Resumo itens={[{ rotulo: "Devia", valor: reais(c.valorTotalCentavos) }, { rotulo: "Já pagou", valor: reais(c.pagoCentavos) }, { rotulo: "Falta", valor: reais(c.saldoCentavos) }]} />
      ) : (
        <Resumo itens={[{ rotulo: "Por mês", valor: reais(c.valorMensalCentavos) }, { rotulo: "Pago este mês", valor: reais(c.pagoNoMesCentavos) }, { rotulo: "Falta no mês", valor: reais(c.faltaNoMesCentavos), tom: c.situacao === "vencida" ? "perigo" : undefined }]} />
      )}
      <p className="text-xs text-suave">
        {c.categoria} ({c.escopo === "empresa" ? "empresa" : "pessoal"}){c.diaVencimento ? ` · vence dia ${c.diaVencimento}` : ""}
        {c.numeroParcelas ? ` · ${c.parcelasPagas}/${c.numeroParcelas} parcelas de ${reais(valorParcela(c))}` : ""}{c.observacao ? ` · ${c.observacao}` : ""}
        {" · "}<button type="button" onClick={aoEditar} className="link">Editar conta</button>
      </p>
      {!quitada && (
        <form onSubmit={pagar} className="cartao space-y-3 p-3">
          <h3 className="text-sm font-semibold">Dar baixa (pagar)</h3>
          <div className="grid grid-cols-2 gap-2">
            <Campo rotulo="Valor pago" id="pvalor"><InputDinheiro id="pvalor" required valor={valor} aoMudar={setValor} /></Campo>
            <Campo rotulo="Data" id="pdata"><input id="pdata" type="date" max={hoje()} value={data} onChange={(e) => setData(e.target.value)} required /></Campo>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Campo rotulo="Pago com" id="pforma"><select id="pforma" value={forma} onChange={(e) => setForma(e.target.value)}>{Object.entries(FORMAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
            <Campo rotulo="Observação" id="pobs"><input id="pobs" value={obs} maxLength={300} placeholder="Pago pelo financeiro" onChange={(e) => setObs(e.target.value)} /></Campo>
          </div>
          <button type="submit" className="btn btn-primario w-full" disabled={!valor}>Confirmar pagamento</button>
        </form>
      )}
      <Aviso msg={erro} />
      <div>
        <h3 className="mb-2 text-sm font-semibold">Histórico</h3>
        {!c.historico.length ? <p className="text-sm text-suave">Nenhum pagamento ainda.</p> : (
          <ul className="divide-y divide-borda rounded-md border border-borda">
            {c.historico.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span>
                  <b>{dataBR(p.data)}</b> · pagou <b>{reais(p.valorCentavos)}</b>{p.forma ? ` (${FORMAS[p.forma] ?? p.forma})` : ""}
                  {p.saldoDepoisCentavos != null && <> · ficou <b>{reais(p.saldoDepoisCentavos)}</b></>}
                  {obsPagamento(c, p) && <span className="block text-xs text-suave">{obsPagamento(c, p)}</span>}
                </span>
                <button type="button" onClick={() => estornar(p)} className="link-perigo shrink-0">Desfazer</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function Contas() {
  const { dados, erro, recarregar } = useDados<Conta[]>("/api/contas");
  const cats = useDados<Categoria[]>("/api/categorias");
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [editando, setEditando] = useState<Conta | "nova" | null>(null);
  const lista = dados ?? [];
  const aberta = lista.find((c) => c.id === abertaId) ?? null;
  const fixas = lista.filter((c) => c.tipo === "fixa");
  const dividas = lista.filter((c) => c.tipo === "divida");
  const colunas = [
    { titulo: "Conta", valor: (c: Conta) => <span className="font-medium">{c.nome}</span> },
    { titulo: "Vence", valor: (c: Conta) => (c.diaVencimento ? `dia ${c.diaVencimento}` : "—"), esconderNoCelular: true },
    { titulo: "Categoria", valor: (c: Conta) => c.categoria, esconderNoCelular: true },
    { titulo: "Último pagamento", valor: (c: Conta) => (c.historico[0] ? `${reais(c.historico[0].valorCentavos)} em ${dataBR(c.historico[0].data)}` : "—"), esconderNoCelular: true },
    { titulo: "Falta", valor: (c: Conta) => <span className="font-medium">{reais(falta(c))}</span>, alinhar: "direita" as const },
    { titulo: "Situação", valor: (c: Conta) => <Situacao c={c} /> },
  ];
  return (
    <>
      <Cabecalho titulo="Contas a pagar" descricao="Contas fixas do mês e dívidas parceladas. Cada pagamento entra em Gastos."><button type="button" className="btn btn-primario" onClick={() => setEditando("nova")} disabled={!cats.dados}>+ Nova conta</button></Cabecalho>
      <Resumo itens={[
        { rotulo: "Falta pagar este mês (fixas)", valor: reais(fixas.reduce((t, c) => t + (c.faltaNoMesCentavos ?? 0), 0)) },
        { rotulo: "Contas vencidas", valor: String(fixas.filter((c) => c.situacao === "vencida").length), tom: fixas.some((c) => c.situacao === "vencida") ? "perigo" : undefined },
        { rotulo: "Dívidas em aberto", valor: reais(dividas.reduce((t, c) => t + (c.saldoCentavos ?? 0), 0)) },
        { rotulo: "Pago este mês", valor: reais(lista.reduce((t, c) => t + c.pagoNoMesCentavos, 0)) },
      ]} />
      <Aviso msg={erro} />
      <h2 className="mb-2 mt-2 text-sm font-semibold">Fixas do mês</h2>
      <Tabela linhas={dados ? fixas : null} chave={(c) => c.id} vazio="Nenhuma conta fixa. Cadastre aluguel, luz, internet…" aoClicar={(c) => setAbertaId(c.id)} colunas={colunas} alturaMaxima={false} />
      <h2 className="mb-2 mt-6 text-sm font-semibold">Dívidas e parceladas</h2>
      <Tabela linhas={dados ? dividas : null} chave={(c) => c.id} vazio="Nenhuma dívida. Cadastre fornecedores e empréstimos." aoClicar={(c) => setAbertaId(c.id)} colunas={colunas} alturaMaxima={false} />
      <Modal titulo={aberta?.nome ?? "Conta"} largo aberto={!!aberta && !editando} aoFechar={() => setAbertaId(null)}>
        {aberta && <DetalheConta key={aberta.id} c={aberta} aoMudar={() => void recarregar()} aoEditar={() => setEditando(aberta)} />}
      </Modal>
      <Modal titulo={editando === "nova" ? "Nova conta a pagar" : "Editar conta"} aberto={!!editando} aoFechar={() => setEditando(null)}>
        {editando && cats.dados && <FormConta conta={editando === "nova" ? null : editando} categorias={cats.dados} aoSalvar={() => { if (editando !== "nova") setAbertaId(null); setEditando(null); void recarregar(); }} />}
      </Modal>
    </>
  );
}
