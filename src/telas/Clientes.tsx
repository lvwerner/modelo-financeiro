// Clientes (CRM básico): busca, cadastro, edição, histórico de compras e débitos em aberto.
import { useState, type FormEvent } from "react";
import { chamar, comFiltros } from "../api";
import { ExternalLink, Pencil } from "lucide-react";
import { Aviso, Botao, Cabecalho, Campo, dataBR, Esqueleto, Etiqueta, FORMAS, Modal, reais, RodapeModal, Tabela, telefoneBR, telefoneMascarado, useAtrasado, useAvisar, useDados } from "../ui";
import { agruparPorCliente, FiadoDoCliente, type Crediario } from "./Fiado";

export type ClienteLista = { id: string; nome: string; telefone: string | null; cidade: string | null; bairro: string | null; empresa: string | null; debitoCentavos: number; compras: number };
type Cliente = { id: string; nome: string; telefone: string | null; email: string | null; documento: string | null; cidade: string | null; bairro: string | null; empresa: string | null; observacoes: string | null };
type Detalhe = {
  cliente: Cliente; debitoCentavos: number; debitoAtualizadoCentavos: number;
  compras: { id: string; data: string; totalCentavos: number; formaPagamento: string; status: string; itens: string | null }[];
  crediarios: Crediario[];
};


/** embutido: dentro de outro formulário (ex.: escolher cliente na venda). Vira um bloco comum (formulário dentro de formulário não é HTML válido). */
export function FormCliente({ cliente, aoSalvar, embutido }: { cliente?: Cliente; aoSalvar: (id: string, nome: string) => void; embutido?: boolean }) {
  const [f, setF] = useState({
    nome: cliente?.nome ?? "", telefone: cliente?.telefone ?? "", email: cliente?.email ?? "", documento: cliente?.documento ?? "",
    cidade: cliente?.cidade ?? "", bairro: cliente?.bairro ?? "", empresa: cliente?.empresa ?? "", observacoes: cliente?.observacoes ?? "",
  });
  const [erro, setErro] = useState("");
  const muda = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function salvar(e?: FormEvent) {
    e?.preventDefault();
    if (!f.nome.trim() || f.nome.trim().length < 2) return setErro("Digite o nome do cliente.");
    const r = cliente
      ? await chamar<{ id: string }>("/api/clientes", { id: cliente.id, ...f }, "PATCH")
      : await chamar<{ id: string }>("/api/clientes", f);
    if (!r.ok) return setErro(r.erro);
    aoSalvar(r.dados.id, f.nome.trim());
  }
  const Envolve = embutido ? "div" : "form";
  return (
    <Envolve className="space-y-3" {...(embutido
      // Enter num campo cadastra o cliente (e não envia o formulário da venda, que está por fora)
      ? { onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); void salvar(); } } }
      : { onSubmit: salvar })}>
      <Campo rotulo="Nome" id="cnome"><input id="cnome" required minLength={2} value={f.nome} onChange={muda("nome")} /></Campo>
      <div className="grid grid-cols-2 gap-2">
        <Campo rotulo="WhatsApp" id="ctel"><input id="ctel" inputMode="tel" value={f.telefone} placeholder="(11) 99999-0000" onChange={muda("telefone")} /></Campo>
        <Campo rotulo="Empresa" id="cempresa"><input id="cempresa" value={f.empresa} placeholder="Opcional" onChange={muda("empresa")} /></Campo>
        <Campo rotulo="Cidade" id="ccidade"><input id="ccidade" value={f.cidade} onChange={muda("cidade")} /></Campo>
        <Campo rotulo="Bairro" id="cbairro"><input id="cbairro" value={f.bairro} onChange={muda("bairro")} /></Campo>
        <Campo rotulo="E-mail" id="cemail"><input id="cemail" type="email" value={f.email} onChange={muda("email")} /></Campo>
        <Campo rotulo="CPF/CNPJ" id="cdoc"><input id="cdoc" value={f.documento} onChange={muda("documento")} /></Campo>
      </div>
      <Campo rotulo="Observações" id="cobs"><textarea id="cobs" rows={2} value={f.observacoes} onChange={muda("observacoes")} /></Campo>
      {embutido ? (
        <><Aviso msg={erro} /><button type="button" onClick={() => salvar()} className="btn btn-primario w-full">Cadastrar cliente</button></>
      ) : (
        <RodapeModal><Aviso msg={erro} /><button type="submit" className="btn btn-primario w-full">{cliente ? "Salvar alterações" : "Cadastrar cliente"}</button></RodapeModal>
      )}
    </Envolve>
  );
}

function DetalheCliente({ id, aoMudar }: { id: string; aoMudar: () => void }) {
  const { dados, erro, recarregar } = useDados<Detalhe>(`/api/clientes?id=${id}`);
  const avisar = useAvisar();
  const [editando, setEditando] = useState(false);
  if (erro) return <Aviso msg={erro} />;
  if (!dados) return <Esqueleto linhas={4} />;
  if (editando) return <FormCliente cliente={dados.cliente} aoSalvar={() => { setEditando(false); avisar("Dados do cliente salvos."); void recarregar(); aoMudar(); }} />;
  const c = dados.cliente;
  const [fiado] = agruparPorCliente(dados.crediarios);
  const mudou = () => { void recarregar(); aoMudar(); };
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <dl className="grid flex-1 grid-cols-[6.5rem_1fr] gap-y-1">
          <dt className="text-suave">Nome</dt><dd className="font-medium">{c.nome}</dd>
          <dt className="text-suave">WhatsApp</dt><dd>{telefoneBR(c.telefone)}</dd>
          <dt className="text-suave">E-mail</dt><dd>{c.email ?? "—"}</dd>
          <dt className="text-suave">CPF/CNPJ</dt><dd>{c.documento ?? "—"}</dd>
          <dt className="text-suave">Endereço</dt><dd>{[c.bairro, c.cidade].filter(Boolean).join(", ") || "—"}</dd>
          {c.empresa && <><dt className="text-suave">Empresa</dt><dd>{c.empresa}</dd></>}
          {c.observacoes && <><dt className="text-suave">Observações</dt><dd>{c.observacoes}</dd></>}
        </dl>
        <div className="flex gap-2">
          <Botao pequeno icone={<Pencil size={14} aria-hidden />} onClick={() => setEditando(true)}>Editar</Botao>
          {c.telefone && <a className="btn btn-contorno btn-sm" href={`https://wa.me/${c.telefone.length >= 12 ? c.telefone : `55${c.telefone}`}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden />WhatsApp</a>}
        </div>
      </div>
      <div>
        <h3 className="mb-2 border-t border-borda pt-4 font-semibold">A receber: {reais(dados.debitoCentavos)}{dados.debitoAtualizadoCentavos > dados.debitoCentavos && <span className="font-normal text-perigo"> ({reais(dados.debitoAtualizadoCentavos)} com juros)</span>}</h3>
        {fiado && <FiadoDoCliente g={fiado} aoMudar={mudou} />}
      </div>
      <div>
        <h3 className="mb-2 border-t border-borda pt-4 font-semibold">Compras ({dados.compras.length})</h3>
        <Tabela linhas={dados.compras} chave={(v) => v.id} vazio="Nenhuma compra ainda." alturaMaxima={false} colunas={[
          { titulo: "Data", valor: (v) => dataBR(v.data) },
          { titulo: "Itens", valor: (v) => <span className="line-clamp-1">{v.itens}</span>, esconderNoCelular: true },
          { titulo: "Pagamento", valor: (v) => FORMAS[v.formaPagamento] },
          { titulo: "Total", valor: (v) => reais(v.totalCentavos), alinhar: "direita" },
          { titulo: "Situação", valor: (v) => <Etiqueta valor={v.status} /> },
        ]} />
      </div>
    </div>
  );
}

export default function Clientes() {
  const [busca, setBusca] = useState("");
  const termo = useAtrasado(busca.trim());
  const { dados, erro, recarregar } = useDados<ClienteLista[]>(comFiltros("/api/clientes", { busca: termo || undefined }));
  const [aberto, setAberto] = useState<string | "novo" | null>(null);
  const avisar = useAvisar();
  return (
    <>
      <Cabecalho titulo="Clientes" descricao="Cadastro, histórico de compras e saldo a receber de cada cliente."><Botao variante="primario" onClick={() => setAberto("novo")}>Novo cliente</Botao></Cabecalho>
      <input aria-label="Buscar cliente" placeholder="Buscar por nome, telefone ou empresa…" value={busca} onChange={(e) => setBusca(e.target.value)} className="entrada mb-3 md:max-w-sm" />
      <Aviso msg={erro} />
      <Tabela linhas={dados} chave={(c) => c.id} vazio="Nenhum cliente encontrado." aoClicar={(c) => setAberto(c.id)} colunas={[
        { titulo: "Nome", valor: (c) => <span className="font-medium">{c.nome}</span> },
        { titulo: "WhatsApp", valor: (c) => telefoneMascarado(c.telefone) },
        { titulo: "Cidade", valor: (c) => c.cidade ?? "—", esconderNoCelular: true },
        { titulo: "Compras", valor: (c) => c.compras, alinhar: "direita", esconderNoCelular: true },
        { titulo: "Em aberto", valor: (c) => <span className={c.debitoCentavos ? "font-medium" : "text-suave"}>{reais(c.debitoCentavos)}</span>, alinhar: "direita" },
      ]} />
      <Modal titulo={aberto === "novo" ? "Novo cliente" : "Cliente"} aberto={!!aberto} aoFechar={() => { setAberto(null); void recarregar(); }} largo={aberto !== "novo"}>
        {aberto === "novo" ? <FormCliente aoSalvar={() => { setAberto(null); avisar("Cliente cadastrado."); void recarregar(); }} /> : aberto && <DetalheCliente id={aberto} aoMudar={recarregar} />}
      </Modal>
    </>
  );
}
