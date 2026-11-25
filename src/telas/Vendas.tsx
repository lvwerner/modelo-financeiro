// Vendas: lista por período, nova venda e venda a prazo (preço sugerido pelo estoque, pode mudar na hora) e cancelamento.
import { useMemo, useState, type FormEvent } from "react";
import { chamar, comFiltros } from "../api";
import { Trash2 } from "lucide-react";
import { Aviso, Botao, Cabecalho, Campo, dataBR, Etiqueta, FORMAS, hoje, InputDinheiro, Modal, primeiroDiaDoMes, reais, Resumo, RodapeModal, somarMeses, Tabela, useAtrasado, useAvisar, useDados, useFuncionario } from "../ui";
import { FormCliente, type ClienteLista } from "./Clientes";
import { nomeProduto, type Produto } from "./Estoque";
import { NovoFiado } from "./Fiado";

type Venda = {
  id: string; data: string; totalCentavos: number; descontoCentavos: number; formaPagamento: string; parcelasCartao: number | null;
  status: string; cliente: string | null; itens: string | null; motivoCancelamento: string | null;
};
type Item = { produto: Produto; quantidade: number; preco: number }; // preco: valor combinado de cada um

const limite = (p: Produto) => (p.controlaEstoque ? p.quantidade : 999); // serviço não tem estoque
const precoTabela = (p: Produto) => p.precoCentavos ?? 0;
const precoItem = (i: Item) => i.preco * i.quantidade;
const dividir = (total: number, n: number) => Array.from({ length: n }, (_, i) => Math.floor(total / n) + (i === 0 ? total - Math.floor(total / n) * n : 0));

export function EscolherCliente({ clienteId, aoEscolher }: { clienteId: string; aoEscolher: (id: string, nome: string) => void }) {
  const [busca, setBusca] = useState("");
  const termo = useAtrasado(busca.trim());
  const { dados } = useDados<ClienteLista[]>(termo.length >= 2 ? comFiltros("/api/clientes", { busca: termo }) : null);
  const [novo, setNovo] = useState(false);
  if (novo) return <div className="cartao p-3"><FormCliente embutido aoSalvar={(id, nome) => { setNovo(false); aoEscolher(id, nome); }} /><button type="button" className="btn btn-contorno mt-2 w-full" onClick={() => setNovo(false)}>Cancelar</button></div>;
  return (
    <div>
      <input aria-label="Buscar cliente" placeholder="Digite o nome ou telefone…" value={busca} onChange={(e) => setBusca(e.target.value)} className="entrada" />
      {termo.length >= 2 && (
        <ul className="mt-1 max-h-44 overflow-y-auto rounded-md border border-borda">
          {(dados ?? []).map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => { aoEscolher(c.id, c.nome); setBusca(""); }} className={`flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-cinza ${c.id === clienteId ? "bg-cinza font-semibold" : ""}`}>
                <span>{c.nome}</span><span className="text-suave">{c.cidade ?? ""}</span>
              </button>
            </li>
          ))}
          {dados && !dados.length && <li className="px-3 py-2 text-sm text-suave">Nenhum cliente com esse nome.</li>}
        </ul>
      )}
      <button type="button" onClick={() => setNovo(true)} className="link mt-1.5 text-sm">Cadastrar cliente novo</button>
    </div>
  );
}

/** Nova venda; com `fiado`, já vem como compra a prazo (cliente obrigatório, paga até a data combinada). */
export function NovaVenda({ aoSalvar, fiado = false }: { aoSalvar: () => void; fiado?: boolean }) {
  const [itens, setItens] = useState<Item[]>([]);
  const [busca, setBusca] = useState("");
  const termo = useAtrasado(busca.trim());
  const { dados: achados } = useDados<Produto[]>(termo.length >= 2 ? comFiltros("/api/produtos", { busca: termo, disponiveis: "1" }) : null);
  const [cliente, setCliente] = useState({ id: "", nome: "" });
  const [desconto, setDesconto] = useState(0);
  const [forma, setForma] = useState(fiado ? "prazo" : "pix");
  const [parcelasCartao, setParcelasCartao] = useState(1);
  const [entrada, setEntrada] = useState(0);
  const [nParcelas, setNParcelas] = useState(fiado ? 1 : 3);
  const [primeiroVenc, setPrimeiroVenc] = useState(somarMeses(hoje(), 1));
  const [juros, setJuros] = useState({ cobrar: false, multa: 2, mes: 1 });
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  const subtotal = itens.reduce((t, i) => t + precoItem(i), 0);
  const total = Math.max(subtotal - desconto, 0);
  const parcelas = useMemo(() => (forma === "prazo" && total - entrada > 0 ? dividir(total - entrada, nParcelas) : []), [forma, total, entrada, nParcelas]);

  const adicionar = (p: Produto) => {
    setItens((xs) => (xs.some((x) => x.produto.id === p.id) ? xs : [...xs, { produto: p, quantidade: 1, preco: precoTabela(p) }]));
    setBusca("");
  };
  const mudarItem = (id: string, m: Partial<Item>) => setItens((xs) => xs.map((x) => (x.produto.id === id ? { ...x, ...m } : x)));

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    if (!itens.length) return setErro("Adicione pelo menos um produto.");
    const semPreco = itens.find((i) => !i.preco);
    if (semPreco) return setErro(`Digite o preço de ${nomeProduto(semPreco.produto)}.`);
    if (forma === "prazo" && !cliente.id) return setErro("Venda a prazo precisa de cliente.");
    setEnviando(true);
    const r = await chamar("/api/vendas", {
      clienteId: cliente.id || null,
      itens: itens.map((i) => ({ produtoId: i.produto.id, quantidade: i.quantidade, precoUnitarioCentavos: i.preco })),
      descontoCentavos: desconto,
      formaPagamento: forma,
      ...(forma === "cartao" ? { parcelasCartao } : {}),
      ...(forma === "prazo" ? { prazo: { entradaCentavos: entrada, numeroParcelas: nParcelas, primeiroVencimento: primeiroVenc, cobrarJuros: juros.cobrar, multaPercentual: juros.multa, jurosMesPercentual: juros.mes } } : {}),
      ...(obs.trim() ? { observacoes: obs.trim() } : {}),
    });
    setEnviando(false);
    if (!r.ok) return setErro(r.erro);
    aoSalvar();
  }

  return (
    <form onSubmit={salvar} className="space-y-4">
      <div>
        <p className="mb-1 text-sm font-medium">Produtos</p>
        <input aria-label="Buscar produto" placeholder="Buscar no estoque: nome, marca, código…" value={busca} onChange={(e) => setBusca(e.target.value)} className="entrada" />
        {termo.length >= 2 && (
          <ul className="mt-1 max-h-48 overflow-y-auto rounded-md border border-borda">
            {(achados ?? []).map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => adicionar(p)} className="flex w-full justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-cinza disabled:opacity-50">
                  <span>{nomeProduto(p)} <span className="text-suave">· {p.categoria ?? "Sem categoria"}{p.controlaEstoque ? ` · ${p.quantidade} em estoque` : ""}</span></span>
                  <span className="font-semibold">{p.precoCentavos == null ? "digitar preço" : reais(p.precoCentavos)}</span>
                </button>
              </li>
            ))}
            {achados && !achados.length && <li className="px-3 py-2 text-sm text-suave">Nada disponível com esse nome.</li>}
          </ul>
        )}
        <ul className="mt-2 space-y-2">
          {itens.map((i) => (
            <li key={i.produto.id} className="rounded-md border border-borda p-3 text-sm">
              <div className="flex justify-between gap-2"><span className="font-medium">{nomeProduto(i.produto)}</span><span className="valor font-medium">{reais(precoItem(i))}</span></div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1">Preço cada
                  <InputDinheiro id={`preco-${i.produto.id}`} rotulo={`Preço de cada ${nomeProduto(i.produto)}`} className="entrada !min-h-8 !w-32 !py-1" valor={i.preco} aoMudar={(v) => mudarItem(i.produto.id, { preco: v })} />
                </label>
                <label className="flex items-center gap-1">Qtd
                  <input type="number" aria-label="Quantidade" min={1} max={limite(i.produto)} value={i.quantidade} onChange={(e) => mudarItem(i.produto.id, { quantidade: Math.max(1, Math.min(Number(e.target.value), limite(i.produto))) })} className="entrada !min-h-8 !w-20 !py-1" />
                </label>
                <button type="button" onClick={() => setItens((xs) => xs.filter((x) => x.produto.id !== i.produto.id))} className="ml-auto grid h-8 w-8 place-items-center rounded-md text-suave hover:bg-perigo-fundo hover:text-perigo" aria-label={`Remover ${nomeProduto(i.produto)}`}><Trash2 size={16} aria-hidden /></button>
              </div>
              {i.preco !== precoTabela(i.produto) && precoTabela(i.produto) > 0 && (
                <p className="mt-1 text-xs text-suave">Preço do estoque: {reais(precoTabela(i.produto))} · <button type="button" className="font-semibold underline" onClick={() => mudarItem(i.produto.id, { preco: precoTabela(i.produto) })}>voltar</button></p>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="mb-1 text-sm font-medium">Cliente {forma === "prazo" ? "(obrigatório a prazo)" : "(opcional)"}</p>
        {cliente.id && <p className="mb-1 flex items-center justify-between rounded-md border border-borda bg-cinza px-3 py-2 text-sm"><span className="font-medium">{cliente.nome}</span><button type="button" onClick={() => setCliente({ id: "", nome: "" })} className="link">Trocar</button></p>}
        {!cliente.id && <EscolherCliente clienteId={cliente.id} aoEscolher={(id, nome) => setCliente({ id, nome })} />}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Campo rotulo="Desconto" id="desconto"><InputDinheiro id="desconto" valor={desconto} aoMudar={(v) => setDesconto(Math.min(v, subtotal))} /></Campo>
        {!fiado && <Campo rotulo="Pagamento" id="forma">
          <select id="forma" value={forma} onChange={(e) => setForma(e.target.value)}>
            {Object.entries(FORMAS).map(([k, v]) => <option key={k} value={k}>{v === "A prazo" ? "A prazo (crediário)" : v}</option>)}
          </select>
        </Campo>}
        {forma === "cartao" && (
          <Campo rotulo="Parcelas no cartão" id="pcartao">
            <select id="pcartao" value={parcelasCartao} onChange={(e) => setParcelasCartao(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}x</option>)}
            </select>
          </Campo>
        )}
      </div>

      {forma === "prazo" && (
        <div className="space-y-3 rounded-md border border-borda p-3">
          <div className="grid grid-cols-3 gap-2">
            <Campo rotulo={fiado ? "Entrada (se pagou algo)" : "Entrada"} id="entrada"><InputDinheiro id="entrada" valor={entrada} aoMudar={(v) => setEntrada(Math.min(v, Math.max(total - 1, 0)))} /></Campo>
            <Campo rotulo={fiado ? "Dividir em" : "Parcelas"} id="nparc"><select id="nparc" value={nParcelas} onChange={(e) => setNParcelas(Number(e.target.value))}>{Array.from({ length: 24 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}x</option>)}</select></Campo>
            <Campo rotulo={fiado && nParcelas === 1 ? "Pagar até" : "1º vencimento"} id="venc"><input id="venc" type="date" min={hoje()} value={primeiroVenc} onChange={(e) => setPrimeiroVenc(e.target.value)} required /></Campo>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[var(--acento)]" checked={juros.cobrar} onChange={(e) => setJuros((j) => ({ ...j, cobrar: e.target.checked }))} /> Cobrar multa e juros se atrasar</label>
          {juros.cobrar && (
            <div className="grid grid-cols-2 gap-2">
              <Campo rotulo="Multa (%)" id="multa"><input id="multa" type="number" step="0.1" min={0} max={20} value={juros.multa} onChange={(e) => setJuros((j) => ({ ...j, multa: Number(e.target.value) }))} /></Campo>
              <Campo rotulo="Juros ao mês (%)" id="jmes"><input id="jmes" type="number" step="0.1" min={0} max={20} value={juros.mes} onChange={(e) => setJuros((j) => ({ ...j, mes: Number(e.target.value) }))} /></Campo>
            </div>
          )}
          {parcelas.length > 0 && (
            <ul className="valor text-sm text-suave">
              {parcelas.map((v, i) => <li key={i} className="flex justify-between"><span>{i + 1}ª · {dataBR(somarMeses(primeiroVenc, i))}</span><span>{reais(v)}</span></li>)}
            </ul>
          )}
        </div>
      )}

      <Campo rotulo="Observações" id="vobs"><input id="vobs" value={obs} maxLength={1000} onChange={(e) => setObs(e.target.value)} /></Campo>
      <RodapeModal>
        <div className="space-y-0.5 text-sm">
          {desconto > 0 && <p className="flex justify-between text-suave"><span>Subtotal</span><span className="valor">{reais(subtotal)}</span></p>}
          {desconto > 0 && <p className="flex justify-between text-suave"><span>Desconto</span><span className="valor">− {reais(desconto)}</span></p>}
          <p className="flex items-baseline justify-between"><span className="font-medium">Total</span><span className="valor text-lg font-semibold">{reais(total)}</span></p>
        </div>
        <Aviso msg={erro} />
        <button type="submit" className="btn btn-primario w-full" disabled={enviando || !itens.length}>{enviando ? "Registrando…" : fiado ? "Registrar a prazo" : "Registrar venda"}</button>
      </RodapeModal>
    </form>
  );
}

function Cancelar({ venda, aoSalvar }: { venda: Venda; aoSalvar: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  async function salvar(e: FormEvent) {
    e.preventDefault();
    const r = await chamar("/api/vendas", { id: venda.id, acao: "cancelar", motivo }, "PATCH");
    if (!r.ok) return setErro(r.erro);
    aoSalvar();
  }
  return (
    <form onSubmit={salvar} className="space-y-3 text-sm">
      <p>{dataBR(venda.data)} · {venda.cliente ?? "sem cliente"} · <span className="valor font-semibold">{reais(venda.totalCentavos)}</span></p>
      <p className="text-suave">{venda.itens}</p>
      {venda.status === "cancelada" ? <p><Etiqueta valor="cancelada" /> {venda.motivoCancelamento}</p> : (
        <>
          <p className="text-suave">Cancelar devolve os produtos ao estoque e apaga as parcelas em aberto. Fica registrado na auditoria.</p>
          <Campo rotulo="Motivo do cancelamento" id="motivo"><input id="motivo" required minLength={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
          <RodapeModal>
            <Aviso msg={erro} />
            <button type="submit" className="btn btn-perigo w-full">Cancelar venda</button>
          </RodapeModal>
        </>
      )}
    </form>
  );
}

export default function Vendas() {
  const funcionario = useFuncionario();
  const [de, setDe] = useState(primeiroDiaDoMes());
  const [ate, setAte] = useState(hoje());
  const { dados, erro, recarregar } = useDados<Venda[]>(comFiltros("/api/vendas", { de, ate }));
  const [nova, setNova] = useState<"venda" | "fiado" | false>(false);
  const [aberta, setAberta] = useState<Venda | null>(null);
  const validas = (dados ?? []).filter((v) => v.status !== "cancelada");
  const porForma = (f: string) => validas.filter((v) => v.formaPagamento === f).reduce((t, v) => t + v.totalCentavos, 0);
  const avisar = useAvisar();
  const fechar = () => { setNova(false); setAberta(null); void recarregar(); };
  const salvou = (msg: string) => () => { avisar(msg); fechar(); };

  return (
    <>
      <Cabecalho titulo={funcionario ? "Vendas de hoje" : "Vendas"} descricao={funcionario ? undefined : "Vendas concluídas e canceladas no período. Clique numa venda para ver ou cancelar."}>
        <Botao onClick={() => setNova("fiado")}>Venda a prazo rápida</Botao>
        <Botao variante="primario" onClick={() => setNova("venda")}>Nova venda</Botao>
      </Cabecalho>
      {!funcionario && <div className="mb-3 flex flex-wrap items-end gap-2">
        <Campo rotulo="De" id="de"><input id="de" type="date" value={de} onChange={(e) => setDe(e.target.value)} /></Campo>
        <Campo rotulo="Até" id="ate"><input id="ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></Campo>
      </div>}
      {!funcionario && <Resumo itens={[
        { rotulo: `Vendido (${validas.length} vendas)`, valor: reais(validas.reduce((t, v) => t + v.totalCentavos, 0)) },
        { rotulo: "Pix + dinheiro", valor: reais(porForma("pix") + porForma("dinheiro")) },
        { rotulo: "Cartão", valor: reais(porForma("cartao")) },
        { rotulo: "A prazo", valor: reais(porForma("prazo")) },
      ]} />}
      <Aviso msg={erro} />
      <Tabela linhas={dados} chave={(v) => v.id} vazio={funcionario ? "Nenhuma venda hoje ainda." : "Nenhuma venda no período."} aoClicar={funcionario ? undefined : setAberta} colunas={[
        { titulo: "Data", valor: (v) => dataBR(v.data) },
        { titulo: "Cliente", valor: (v) => v.cliente ?? "—" },
        { titulo: "Itens", valor: (v) => <span className="line-clamp-1">{v.itens}</span>, esconderNoCelular: true },
        { titulo: "Pagamento", valor: (v) => `${FORMAS[v.formaPagamento]}${v.parcelasCartao && v.parcelasCartao > 1 ? ` ${v.parcelasCartao}x` : ""}` },
        { titulo: "Total", valor: (v) => <span className={`font-medium ${v.status === "cancelada" ? "text-suave line-through" : ""}`}>{reais(v.totalCentavos)}</span>, alinhar: "direita" },
        { titulo: "Status", valor: (v) => <Etiqueta valor={v.status} /> },
      ]} />
      <Modal titulo={nova === "fiado" ? "Venda a prazo rápida" : "Nova venda"} aberto={!!nova} aoFechar={fechar} largo={nova === "venda"}>{nova === "venda" && <NovaVenda aoSalvar={salvou("Venda registrada.")} />}{nova === "fiado" && <NovoFiado aoSalvar={salvou("Venda a prazo registrada.")} />}</Modal>
      <Modal titulo="Venda" aberto={!!aberta} aoFechar={fechar}>{aberta && <Cancelar venda={aberta} aoSalvar={salvou("Venda cancelada.")} />}</Modal>
    </>
  );
}
