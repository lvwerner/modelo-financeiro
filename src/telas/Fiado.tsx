// A receber por cliente: saldo devedor de cada um e o extrato "comprou + / pagou −".
// O pagamento é recebido no cliente e abate as compras mais antigas primeiro.
import { useState, type FormEvent } from "react";
import { chamar } from "../api";
import { Aviso, Cabecalho, Campo, dataBR, Etiqueta, FORMAS, hoje, InputDinheiro, Modal, reais, Resumo, somarMeses, Tabela, useDados, useFuncionario } from "../ui";
import { FormCliente } from "./Clientes";
import { EscolherCliente } from "./Vendas";

type Parcela = { id: string; numero: number; valorCentavos: number; restanteCentavos: number; vencimento: string; status: "pago" | "pendente" | "atrasado" };
type Pagamento = { id: string; valorCentavos: number; data: string; forma: string; observacao: string | null; criadoEm: string };
export type Crediario = {
  id: string; valorCentavos: number; entradaCentavos: number; numeroParcelas: number; cobrarJuros: boolean; dataVenda: string; totalVenda: number;
  clienteId: string; cliente: string; telefone: string | null; itens: string | null; criadoEmVenda: string; pagoCentavos: number; saldoCentavos: number; saldoAtualizadoCentavos: number;
  parcelasPagas: number; atrasado: boolean; proximoVencimento: string | null; parcelas: Parcela[]; historico: Pagamento[];
};
type Evento = { chave: string; tipo: "compra" | "entrada" | "pagamento"; data: string; valor: number; texto: string; obs?: string | null; idPagamento?: string; ordem: string };
export type ClienteFiado = {
  clienteId: string; cliente: string; telefone: string | null; comprou: number; saldo: number; saldoAtualizado: number;
  atrasado: boolean; proximoVencimento: string | null; eventos: Evento[];
};

const telefoneBR = (t: string | null) => (t ? t.replace(/^(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3") : "");

/** Junta as compras a prazo de cada cliente: saldo devedor e o histórico em ordem de data. */
export function agruparPorCliente(crediarios: Crediario[]): ClienteFiado[] {
  const mapa = new Map<string, ClienteFiado>();
  for (const c of crediarios) {
    const g = mapa.get(c.clienteId) ?? { clienteId: c.clienteId, cliente: c.cliente, telefone: c.telefone, comprou: 0, saldo: 0, saldoAtualizado: 0, atrasado: false, proximoVencimento: null, eventos: [] };
    g.comprou += c.totalVenda;
    g.saldo += c.saldoCentavos;
    g.saldoAtualizado += c.saldoAtualizadoCentavos;
    g.atrasado ||= c.atrasado && c.saldoCentavos > 0;
    if (c.proximoVencimento && c.saldoCentavos > 0 && (!g.proximoVencimento || c.proximoVencimento < g.proximoVencimento)) g.proximoVencimento = c.proximoVencimento;
    g.eventos.push({ chave: `c-${c.id}`, tipo: "compra", data: c.dataVenda, valor: c.totalVenda, texto: c.itens ?? "Compra", ordem: `${c.dataVenda}-${c.criadoEmVenda}-0` });
    if (c.entradaCentavos > 0) g.eventos.push({ chave: `e-${c.id}`, tipo: "entrada", data: c.dataVenda, valor: c.entradaCentavos, texto: "Entrada", ordem: `${c.dataVenda}-${c.criadoEmVenda}-1` });
    // um pagamento recebido no cliente pode ter sido dividido entre compras: na tela aparece como um só
    for (const p of c.historico) {
      const chave = `p-${p.criadoEm}-${p.data}-${p.forma}`;
      const ja = g.eventos.find((e) => e.chave === chave);
      if (ja) ja.valor += p.valorCentavos;
      else g.eventos.push({ chave, tipo: "pagamento", data: p.data, valor: p.valorCentavos, texto: `Pagou (${FORMAS[p.forma] ?? p.forma})`, obs: p.observacao, idPagamento: p.id, ordem: `${p.data}-${p.criadoEm}-2` }); // mesma data: na ordem em que aconteceu
    }
    mapa.set(c.clienteId, g);
  }
  for (const g of mapa.values()) g.eventos.sort((a, b) => a.ordem.localeCompare(b.ordem));
  return [...mapa.values()].sort((a, b) => b.saldo - a.saldo || a.cliente.localeCompare(b.cliente));
}

/** Histórico do cliente: comprou (+) e pagou (−), com o saldo depois de cada linha. */
function Linhas({ g, aoDesfazer }: { g: ClienteFiado; aoDesfazer?: (e: Evento) => void }) {
  let corrente = 0;
  return (
    <ul className="divide-y divide-borda rounded-xl border border-borda text-sm">
      {g.eventos.map((e) => {
        corrente += e.tipo === "compra" ? e.valor : -e.valor;
        return (
          <li key={e.chave} className="flex items-start justify-between gap-3 px-3 py-2">
            <span className="min-w-0">
              <span className="text-suave">{dataBR(e.data)}</span> · {e.tipo === "compra" ? <>Comprou: <span className="text-suave">{e.texto}</span></> : e.texto}
              {e.obs && <span className="block text-xs text-suave">{e.obs}</span>}
              <span className="block text-xs text-suave">saldo: {reais(Math.max(corrente, 0))}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-0.5">
              <b className={e.tipo === "compra" ? "text-red-700" : "text-green-700"}>{e.tipo === "compra" ? "+" : "−"} {reais(e.valor)}</b>
              {aoDesfazer && e.tipo === "pagamento" && <button type="button" onClick={() => aoDesfazer(e)} className="text-xs font-semibold text-red-700 hover:underline">Desfazer</button>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** A receber de um cliente: quanto deve, receber qualquer valor e o extrato. Usado em "A receber" e na ficha do cliente. */
export function FiadoDoCliente({ g, aoMudar }: { g: ClienteFiado; aoMudar: () => void }) {
  const funcionario = useFuncionario();
  const [valor, setValor] = useState(0);
  const [data, setData] = useState(hoje());
  const [forma, setForma] = useState("dinheiro");
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [lancando, setLancando] = useState(false);
  async function receber(e: FormEvent) {
    e.preventDefault();
    const r = await chamar<{ saldoCentavos: number }>("/api/pagamentos-cliente", { clienteId: g.clienteId, valorCentavos: valor, data, forma, ...(obs.trim() ? { observacao: obs.trim() } : {}) });
    if (!r.ok) { setOk(""); return setErro(r.erro); }
    setErro(""); setValor(0); setObs("");
    setOk(r.dados.saldoCentavos ? `Recebido. Ficou devendo ${reais(r.dados.saldoCentavos)}.` : "Recebido. Não deve mais nada!");
    aoMudar();
  }
  async function desfazer(ev: Evento) {
    if (!ev.idPagamento || !confirm(`Desfazer o pagamento de ${reais(ev.valor)} de ${dataBR(ev.data)}?`)) return;
    const r = await chamar(`/api/pagamentos-fiado?id=${ev.idPagamento}`, undefined, "DELETE");
    if (!r.ok) return setErro(r.erro);
    setOk("");
    aoMudar();
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-xl bg-cinza p-2"><p className="text-xs text-suave">Comprou</p><b>{reais(g.comprou)}</b></div>
        <div className="rounded-xl bg-cinza p-2"><p className="text-xs text-suave">Já pagou</p><b>{reais(g.comprou - g.saldo)}</b></div>
        <div className="rounded-xl bg-escuro p-2 text-white"><p className="text-xs text-white/70">Saldo devedor</p><b>{reais(g.saldo)}</b></div>
      </div>
      {(g.proximoVencimento || g.saldoAtualizado > g.saldo) && (
        <p className="text-xs text-suave">{g.proximoVencimento ? `Próximo vencimento ${dataBR(g.proximoVencimento)}` : ""}{g.saldoAtualizado > g.saldo ? ` · com multa e juros do atraso: ${reais(g.saldoAtualizado)}` : ""}</p>
      )}
      {g.saldo > 0 && (
        <form onSubmit={receber} className="space-y-3 rounded-xl border border-borda p-3">
          <h3 className="text-sm font-bold">Receber pagamento</h3>
          <div className="grid grid-cols-2 gap-2">
            <Campo rotulo="Valor pago" id="fvalor"><InputDinheiro id="fvalor" required valor={valor} aoMudar={setValor} /></Campo>
            <Campo rotulo="Data" id="fdata"><input id="fdata" type="date" max={hoje()} value={data} onChange={(e) => setData(e.target.value)} required /></Campo>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Campo rotulo="Pagou com" id="fforma">
              <select id="fforma" value={forma} onChange={(e) => setForma(e.target.value)}><option value="dinheiro">Dinheiro</option><option value="pix">Pix</option><option value="cartao">Cartão</option></select>
            </Campo>
            <Campo rotulo="Observação" id="fobs"><input id="fobs" value={obs} maxLength={300} onChange={(e) => setObs(e.target.value)} /></Campo>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-contorno min-h-10 flex-1 text-sm" onClick={() => setValor(g.saldo)}>Tudo ({reais(g.saldo)})</button>
            <button type="submit" className="btn btn-escuro min-h-10 flex-1" disabled={!valor}>Confirmar</button>
          </div>
        </form>
      )}
      <Aviso msg={erro} />
      <Aviso msg={ok} tipo="ok" />
      {lancando ? (
        <div className="rounded-xl border border-borda p-3">
          <h3 className="mb-2 text-sm font-bold">Nova venda a prazo para {g.cliente}</h3>
          <NovoFiado clienteInicial={{ id: g.clienteId, nome: g.cliente }} aoSalvar={() => { setLancando(false); setOk("Venda a prazo lançada."); aoMudar(); }} />
          <button type="button" onClick={() => setLancando(false)} className="mt-2 w-full text-center text-sm font-semibold text-suave">Cancelar</button>
        </div>
      ) : (
        <button type="button" onClick={() => { setOk(""); setLancando(true); }} className="btn btn-contorno w-full">+ Nova venda a prazo para {g.cliente}</button>
      )}
      <div>
        <h3 className="mb-2 text-sm font-bold">Histórico</h3>
        <Linhas g={g} aoDesfazer={funcionario ? undefined : desfazer} />
      </div>
    </div>
  );
}

/** Venda a prazo rápida: cliente, o que levou e quanto ficou devendo. Não precisa escolher produto do estoque. */
export function NovoFiado({ aoSalvar, clienteInicial }: { aoSalvar: () => void; clienteInicial?: { id: string; nome: string } }) {
  const [cliente, setCliente] = useState(clienteInicial ?? { id: "", nome: "" });
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState(0);
  const [entrada, setEntrada] = useState(0);
  const [pagarAte, setPagarAte] = useState(somarMeses(hoje(), 1));
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const fica = Math.max(valor - entrada, 0);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!cliente.id) return setErro("Escolha o cliente.");
    if (!valor) return setErro("Digite o valor.");
    if (entrada >= valor) return setErro("A entrada cobre o valor todo: não sobra nada a receber.");
    setEnviando(true);
    const r = await chamar("/api/fiados", { clienteId: cliente.id, descricao: descricao.trim(), valorCentavos: valor, entradaCentavos: entrada, pagarAte });
    setEnviando(false);
    if (!r.ok) return setErro(r.erro);
    aoSalvar();
  }
  return (
    <form onSubmit={salvar} className="space-y-4">
      <div>
        <p className="mb-1 text-sm font-bold">Cliente</p>
        {cliente.id
          ? <p className="flex justify-between rounded-lg bg-green-50 px-3 py-2 text-sm"><b>{cliente.nome}</b><button type="button" onClick={() => setCliente({ id: "", nome: "" })} className="font-semibold text-suave">trocar</button></p>
          : <EscolherCliente clienteId="" aoEscolher={(id, nome) => { setErro(""); setCliente({ id, nome }); }} />}
      </div>
      <Campo rotulo="O que levou" id="fdesc"><input id="fdesc" required maxLength={200} value={descricao} placeholder="Ex.: Troca de tela + película" onChange={(e) => { setErro(""); setDescricao(e.target.value); }} /></Campo>
      <div className="grid grid-cols-2 gap-2">
        <Campo rotulo="Valor" id="fval"><InputDinheiro id="fval" required valor={valor} aoMudar={(v) => { setErro(""); setValor(v); }} /></Campo>
        <Campo rotulo="Já pagou agora" id="fent" dica="Opcional"><InputDinheiro id="fent" valor={entrada} aoMudar={(v) => { setErro(""); setEntrada(v); }} /></Campo>
      </div>
      <Campo rotulo="Pagar até" id="fate"><input id="fate" type="date" min={hoje()} value={pagarAte} onChange={(e) => setPagarAte(e.target.value)} required /></Campo>
      <div className="rounded-xl bg-escuro p-3 text-white">
        <p className="flex justify-between text-lg font-extrabold"><span>Fica devendo</span><span>{reais(fica)}</span></p>
      </div>
      <Aviso msg={erro} />
      <button type="submit" className="btn btn-primario w-full" disabled={enviando}>{enviando ? "Registrando…" : "Registrar venda a prazo"}</button>
    </form>
  );
}

const FILTROS = { devendo: "Devendo", atrasados: "Atrasados", quitados: "Quitados", todos: "Todos" } as const;

export default function Fiado() {
  const [filtro, setFiltro] = useState<keyof typeof FILTROS>("devendo");
  const { dados, erro, recarregar } = useDados<Crediario[]>("/api/crediarios?status=todos");
  const [aberto, setAberto] = useState<string | null>(null);
  const [janela, setJanela] = useState<"fiado" | "cliente" | "receber" | null>(null);
  const grupos = agruparPorCliente(dados ?? []);
  const devendo = grupos.filter((g) => g.saldo > 0);
  const lista = grupos.filter((g) => filtro === "todos" || (filtro === "devendo" ? g.saldo > 0 : filtro === "atrasados" ? g.atrasado : g.saldo === 0));
  const atual = grupos.find((g) => g.clienteId === aberto) ?? null;
  const fechar = () => { setJanela(null); void recarregar(); };
  return (
    <>
      <Cabecalho titulo="A receber">
        <button type="button" className="btn btn-primario" onClick={() => setJanela("receber")} disabled={!devendo.length}>Receber pagamento</button>
        <button type="button" className="btn btn-primario" onClick={() => setJanela("fiado")}>+ Venda a prazo</button>
        <button type="button" className="btn btn-contorno" onClick={() => setJanela("cliente")}>+ Novo cliente</button>
      </Cabecalho>
      <div className="mb-3 flex flex-wrap gap-2" role="tablist">
        {Object.entries(FILTROS).map(([k, v]) => (
          <button key={k} type="button" role="tab" aria-selected={filtro === k} onClick={() => setFiltro(k as keyof typeof FILTROS)} className={`btn min-h-9 px-4 py-1.5 text-sm ${filtro === k ? "btn-escuro" : "btn-contorno"}`}>{v}</button>
        ))}
      </div>
      <Resumo itens={[
        { rotulo: "Total a receber", valor: reais(devendo.reduce((t, g) => t + g.saldo, 0)), destaque: true },
        { rotulo: "De clientes atrasados", valor: reais(devendo.filter((g) => g.atrasado).reduce((t, g) => t + g.saldo, 0)) },
        { rotulo: "Atrasado com juros", valor: reais(devendo.filter((g) => g.atrasado).reduce((t, g) => t + g.saldoAtualizado, 0)) },
        { rotulo: "Clientes devendo", valor: String(devendo.length) },
      ]} />
      <Aviso msg={erro} />
      {!dados ? <p className="py-8 text-center text-sm text-suave">Carregando…</p> : !lista.length ? (
        <p className="py-8 text-center text-sm text-suave">{filtro === "devendo" ? "Ninguém devendo. Para lançar uma venda a prazo, toque em \"+ Venda a prazo\"." : "Ninguém aqui."}</p>
      ) : (
        <div className="space-y-3">
          {lista.map((g) => (
            <button key={g.clienteId} type="button" onClick={() => setAberto(g.clienteId)} className="block w-full rounded-xl border border-borda bg-white p-3 text-left hover:border-escuro">
              <div className="mb-2 flex items-start justify-between gap-3">
                <span><b className="text-base underline">{g.cliente}</b>{g.telefone && <span className="block text-xs text-suave">{telefoneBR(g.telefone)}</span>}</span>
                <span className="text-right">
                  <b className={g.saldo > 0 ? "text-lg text-red-700" : "text-lg"}>{reais(g.saldo)}</b>
                  <span className="block">{g.saldo === 0 ? <Etiqueta valor="pago" /> : g.atrasado ? <Etiqueta valor="atrasado" /> : <span className="text-xs text-suave">saldo devedor</span>}</span>
                </span>
              </div>
              <Linhas g={g} />
            </button>
          ))}
        </div>
      )}
      <Modal titulo={atual ? `A receber · ${atual.cliente}` : "A receber"} largo aberto={!!atual} aoFechar={() => setAberto(null)}>
        {atual && <FiadoDoCliente key={atual.clienteId} g={atual} aoMudar={() => void recarregar()} />}
      </Modal>
      <Modal titulo="Nova venda a prazo" aberto={janela === "fiado"} aoFechar={fechar}>{janela === "fiado" && <NovoFiado aoSalvar={fechar} />}</Modal>
      <Modal titulo="Novo cliente" aberto={janela === "cliente"} aoFechar={fechar}>{janela === "cliente" && <FormCliente aoSalvar={fechar} />}</Modal>
      <Modal titulo="Receber pagamento" aberto={janela === "receber"} aoFechar={fechar}>
        {janela === "receber" && (
          <div className="space-y-2">
            <p className="text-sm text-suave">Escolha o cliente que veio pagar:</p>
            <Tabela linhas={devendo} chave={(g) => g.clienteId} vazio="Ninguém devendo." aoClicar={(g) => { setJanela(null); setAberto(g.clienteId); }} colunas={[
              { titulo: "Cliente", valor: (g) => <b>{g.cliente}</b> },
              { titulo: "Deve", valor: (g) => reais(g.saldo), alinhar: "direita" },
            ]} />
          </div>
        )}
      </Modal>
    </>
  );
}
