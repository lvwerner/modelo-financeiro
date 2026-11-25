// A receber por cliente: saldo devedor de cada um e o extrato "comprou + / pagou −".
// O pagamento é recebido no cliente e abate as compras mais antigas primeiro.
import { useState, type FormEvent } from "react";
import { chamar } from "../api";
import { Aviso, Botao, Cabecalho, Campo, dataBR, Etiqueta, FORMAS, hoje, InputDinheiro, Modal, reais, Resumo, RodapeModal, Segmentos, somarMeses, Tabela, telefoneMascarado, useAvisar, useDados, useFuncionario } from "../ui";
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
    <ul className="divide-y divide-borda rounded-md border border-borda text-sm">
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
              <span className={`valor font-medium ${e.tipo === "compra" ? "" : "text-sucesso"}`}>{e.tipo === "compra" ? "+" : "−"} {reais(e.valor)}</span>
              {aoDesfazer && e.tipo === "pagamento" && <button type="button" onClick={() => aoDesfazer(e)} className="link-perigo">Desfazer</button>}
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
  const avisar = useAvisar();
  const [lancando, setLancando] = useState(false);
  async function receber(e: FormEvent) {
    e.preventDefault();
    const r = await chamar<{ saldoCentavos: number }>("/api/pagamentos-cliente", { clienteId: g.clienteId, valorCentavos: valor, data, forma, ...(obs.trim() ? { observacao: obs.trim() } : {}) });
    if (!r.ok) return setErro(r.erro);
    setErro(""); setValor(0); setObs("");
    avisar(r.dados.saldoCentavos ? `Recebido. Saldo devedor: ${reais(r.dados.saldoCentavos)}.` : "Recebido. Saldo quitado.");
    aoMudar();
  }
  async function desfazer(ev: Evento) {
    if (!ev.idPagamento || !confirm(`Desfazer o pagamento de ${reais(ev.valor)} de ${dataBR(ev.data)}?`)) return;
    const r = await chamar(`/api/pagamentos-fiado?id=${ev.idPagamento}`, undefined, "DELETE");
    if (!r.ok) return setErro(r.erro);
    avisar("Pagamento desfeito.");
    aoMudar();
  }
  return (
    <div className="space-y-4">
      <Resumo itens={[{ rotulo: "Comprou", valor: reais(g.comprou) }, { rotulo: "Já pagou", valor: reais(g.comprou - g.saldo) }, { rotulo: "Saldo devedor", valor: reais(g.saldo), tom: g.atrasado ? "perigo" : undefined }]} />
      {(g.proximoVencimento || g.saldoAtualizado > g.saldo) && (
        <p className="text-xs text-suave">{g.proximoVencimento ? `Próximo vencimento ${dataBR(g.proximoVencimento)}` : ""}{g.saldoAtualizado > g.saldo ? ` · com multa e juros do atraso: ${reais(g.saldoAtualizado)}` : ""}</p>
      )}
      {g.saldo > 0 && (
        <form onSubmit={receber} className="cartao space-y-3 p-3">
          <h3 className="text-sm font-semibold">Receber pagamento</h3>
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
            <button type="button" className="btn btn-contorno flex-1" onClick={() => setValor(g.saldo)}>Valor total ({reais(g.saldo)})</button>
            <button type="submit" className="btn btn-primario flex-1" disabled={!valor}>Confirmar recebimento</button>
          </div>
        </form>
      )}
      <Aviso msg={erro} />
      {lancando ? (
        <div className="cartao p-3">
          <h3 className="mb-2 text-sm font-semibold">Nova venda a prazo para {g.cliente}</h3>
          <NovoFiado clienteInicial={{ id: g.clienteId, nome: g.cliente }} aoSalvar={() => { setLancando(false); avisar("Venda a prazo registrada."); aoMudar(); }} semRodape />
          <button type="button" onClick={() => setLancando(false)} className="btn btn-contorno mt-2 w-full">Cancelar</button>
        </div>
      ) : (
        <button type="button" onClick={() => setLancando(true)} className="btn btn-contorno w-full">Nova venda a prazo para {g.cliente}</button>
      )}
      <div>
        <h3 className="mb-2 text-sm font-semibold">Histórico</h3>
        <Linhas g={g} aoDesfazer={funcionario ? undefined : desfazer} />
      </div>
    </div>
  );
}

/** Venda a prazo rápida: cliente, o que levou e quanto ficou devendo. Não precisa escolher produto do estoque. */
export function NovoFiado({ aoSalvar, clienteInicial, semRodape }: { aoSalvar: () => void; clienteInicial?: { id: string; nome: string }; semRodape?: boolean }) {
  const [cliente, setCliente] = useState(clienteInicial ?? { id: "", nome: "" });
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState(0);
  const [entrada, setEntrada] = useState(0);
  const [pagarAte, setPagarAte] = useState(somarMeses(hoje(), 1));
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const fica = Math.max(valor - entrada, 0);
  const fim = (
    <>
      <p className="flex justify-between text-sm"><span className="text-suave">Fica devendo</span><span className="valor text-base font-semibold">{reais(fica)}</span></p>
      <Aviso msg={erro} />
      <button type="submit" className="btn btn-primario w-full" disabled={enviando}>{enviando ? "Registrando…" : "Registrar venda a prazo"}</button>
    </>
  );
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
        <p className="mb-1 text-sm font-medium">Cliente</p>
        {cliente.id
          ? <p className="flex items-center justify-between rounded-md border border-borda bg-cinza px-3 py-2 text-sm"><span className="font-medium">{cliente.nome}</span><button type="button" onClick={() => setCliente({ id: "", nome: "" })} className="link">Trocar</button></p>
          : <EscolherCliente clienteId="" aoEscolher={(id, nome) => { setErro(""); setCliente({ id, nome }); }} />}
      </div>
      <Campo rotulo="O que levou" id="fdesc"><input id="fdesc" required maxLength={200} value={descricao} placeholder="Ex.: Troca de tela + película" onChange={(e) => { setErro(""); setDescricao(e.target.value); }} /></Campo>
      <div className="grid grid-cols-2 gap-2">
        <Campo rotulo="Valor" id="fval"><InputDinheiro id="fval" required valor={valor} aoMudar={(v) => { setErro(""); setValor(v); }} /></Campo>
        <Campo rotulo="Já pagou agora" id="fent" dica="Opcional"><InputDinheiro id="fent" valor={entrada} aoMudar={(v) => { setErro(""); setEntrada(v); }} /></Campo>
      </div>
      <Campo rotulo="Pagar até" id="fate"><input id="fate" type="date" min={hoje()} value={pagarAte} onChange={(e) => setPagarAte(e.target.value)} required /></Campo>
      {semRodape ? <div className="space-y-2 border-t border-borda pt-3">{fim}</div> : <RodapeModal>{fim}</RodapeModal>}
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
  const avisar = useAvisar();
  const fechar = () => { setJanela(null); void recarregar(); };
  return (
    <>
      <Cabecalho titulo="A receber" descricao="Vendas a prazo por cliente. Clique num cliente para ver o extrato e receber.">
        <Botao onClick={() => setJanela("cliente")}>Novo cliente</Botao>
        <Botao onClick={() => setJanela("fiado")}>Nova venda a prazo</Botao>
        <Botao variante="primario" onClick={() => setJanela("receber")} disabled={!devendo.length}>Receber pagamento</Botao>
      </Cabecalho>
      <Resumo itens={[
        { rotulo: "Total a receber", valor: reais(devendo.reduce((t, g) => t + g.saldo, 0)) },
        { rotulo: "De clientes atrasados", valor: reais(devendo.filter((g) => g.atrasado).reduce((t, g) => t + g.saldo, 0)), tom: devendo.some((g) => g.atrasado) ? "perigo" : undefined },
        { rotulo: "Atrasado com juros", valor: reais(devendo.filter((g) => g.atrasado).reduce((t, g) => t + g.saldoAtualizado, 0)) },
        { rotulo: "Clientes devendo", valor: String(devendo.length) },
      ]} />
      <div className="mb-3"><Segmentos rotulo="Filtrar" valor={filtro} aoMudar={setFiltro} opcoes={Object.entries(FILTROS) as [keyof typeof FILTROS, string][]} /></div>
      <Aviso msg={erro} />
      <Tabela linhas={dados ? lista : null} chave={(g) => g.clienteId} aoClicar={(g) => setAberto(g.clienteId)}
        vazio={filtro === "devendo" ? "Nenhum cliente devendo." : "Nenhum cliente nesta situação."} colunas={[
          { titulo: "Cliente", valor: (g) => <span className="font-medium">{g.cliente}</span> },
          { titulo: "Telefone", valor: (g) => telefoneMascarado(g.telefone), esconderNoCelular: true },
          { titulo: "Comprou", valor: (g) => reais(g.comprou), alinhar: "direita", esconderNoCelular: true },
          { titulo: "Pago", valor: (g) => reais(g.comprou - g.saldo), alinhar: "direita", esconderNoCelular: true },
          { titulo: "Saldo", valor: (g) => <span className="font-medium">{reais(g.saldo)}</span>, alinhar: "direita" },
          { titulo: "Próx. vencimento", valor: (g) => (g.saldo ? dataBR(g.proximoVencimento) : "—"), esconderNoCelular: true },
          { titulo: "Situação", valor: (g) => <Etiqueta valor={g.saldo === 0 ? "pago" : g.atrasado ? "atrasado" : "pendente"} /> },
        ]} />
      <Modal titulo={atual ? `A receber · ${atual.cliente}` : "A receber"} largo aberto={!!atual} aoFechar={() => setAberto(null)}>
        {atual && <FiadoDoCliente key={atual.clienteId} g={atual} aoMudar={() => void recarregar()} />}
      </Modal>
      <Modal titulo="Nova venda a prazo" aberto={janela === "fiado"} aoFechar={fechar}>{janela === "fiado" && <NovoFiado aoSalvar={() => { avisar("Venda a prazo registrada."); fechar(); }} />}</Modal>
      <Modal titulo="Novo cliente" aberto={janela === "cliente"} aoFechar={fechar}>{janela === "cliente" && <FormCliente aoSalvar={() => { avisar("Cliente cadastrado."); fechar(); }} />}</Modal>
      <Modal titulo="Receber pagamento" aberto={janela === "receber"} aoFechar={fechar}>
        {janela === "receber" && (
          <div className="space-y-2">
            <p className="text-sm text-suave">Escolha o cliente que veio pagar:</p>
            <Tabela linhas={devendo} chave={(g) => g.clienteId} vazio="Ninguém devendo." aoClicar={(g) => { setJanela(null); setAberto(g.clienteId); }} colunas={[
              { titulo: "Cliente", valor: (g) => <span className="font-medium">{g.cliente}</span> },
              { titulo: "Deve", valor: (g) => reais(g.saldo), alinhar: "direita" },
            ]} />
          </div>
        )}
      </Modal>
    </>
  );
}
