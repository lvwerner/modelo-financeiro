// Clientes (CRM básico): busca, cadastro, edição, histórico de compras e débitos em aberto.
import { useState, type FormEvent } from "react";
import { chamar, comFiltros } from "../api";
import { Aviso, Cabecalho, Campo, dataBR, Etiqueta, FORMAS, Modal, reais, Tabela, useAtrasado, useDados } from "../ui";
import { agruparPorCliente, FiadoDoCliente, type Crediario } from "./Fiado";

export type ClienteLista = { id: string; nome: string; telefone: string | null; cidade: string | null; bairro: string | null; empresa: string | null; debitoCentavos: number; compras: number };
type Cliente = { id: string; nome: string; telefone: string | null; email: string | null; documento: string | null; cidade: string | null; bairro: string | null; empresa: string | null; observacoes: string | null };
type Detalhe = {
  cliente: Cliente; debitoCentavos: number; debitoAtualizadoCentavos: number;
  compras: { id: string; data: string; totalCentavos: number; formaPagamento: string; status: string; itens: string | null }[];
  crediarios: Crediario[];
};

const telefoneBR = (t: string | null) => (t ? t.replace(/^(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3") : "—");

export function FormCliente({ cliente, aoSalvar }: { cliente?: Cliente; aoSalvar: (id: string) => void }) {
  const [f, setF] = useState({
    nome: cliente?.nome ?? "", telefone: cliente?.telefone ?? "", email: cliente?.email ?? "", documento: cliente?.documento ?? "",
    cidade: cliente?.cidade ?? "", bairro: cliente?.bairro ?? "", empresa: cliente?.empresa ?? "", observacoes: cliente?.observacoes ?? "",
  });
  const [erro, setErro] = useState("");
  const muda = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function salvar(e: FormEvent) {
    e.preventDefault();
    const r = cliente
      ? await chamar<{ id: string }>("/api/clientes", { id: cliente.id, ...f }, "PATCH")
      : await chamar<{ id: string }>("/api/clientes", f);
    if (!r.ok) return setErro(r.erro);
    aoSalvar(r.dados.id);
  }
  return (
    <form onSubmit={salvar} className="space-y-3">
      <Campo rotulo="Nome" id="cnome"><input id="cnome" required minLength={2} value={f.nome} onChange={muda("nome")} /></Campo>
      <div className="grid grid-cols-2 gap-2">
        <Campo rotulo="WhatsApp" id="ctel"><input id="ctel" inputMode="tel" value={f.telefone} placeholder="(47) 99999-0000" onChange={muda("telefone")} /></Campo>
        <Campo rotulo="Empresa" id="cempresa"><input id="cempresa" value={f.empresa} placeholder="Opcional" onChange={muda("empresa")} /></Campo>
        <Campo rotulo="Cidade" id="ccidade"><input id="ccidade" value={f.cidade} onChange={muda("cidade")} /></Campo>
        <Campo rotulo="Bairro" id="cbairro"><input id="cbairro" value={f.bairro} onChange={muda("bairro")} /></Campo>
        <Campo rotulo="E-mail" id="cemail"><input id="cemail" type="email" value={f.email} onChange={muda("email")} /></Campo>
        <Campo rotulo="CPF/CNPJ" id="cdoc"><input id="cdoc" value={f.documento} onChange={muda("documento")} /></Campo>
      </div>
      <Campo rotulo="Observações" id="cobs"><textarea id="cobs" rows={2} value={f.observacoes} onChange={muda("observacoes")} /></Campo>
      <Aviso msg={erro} />
      <button type="submit" className="btn btn-escuro w-full">{cliente ? "Salvar" : "Cadastrar cliente"}</button>
    </form>
  );
}

function DetalheCliente({ id, aoMudar }: { id: string; aoMudar: () => void }) {
  const { dados, erro, recarregar } = useDados<Detalhe>(`/api/clientes?id=${id}`);
  const [editando, setEditando] = useState(false);
  if (erro) return <Aviso msg={erro} />;
  if (!dados) return <p className="text-sm text-suave">Carregando…</p>;
  if (editando) return <FormCliente cliente={dados.cliente} aoSalvar={() => { setEditando(false); void recarregar(); aoMudar(); }} />;
  const c = dados.cliente;
  const [fiado] = agruparPorCliente(dados.crediarios);
  const mudou = () => { void recarregar(); aoMudar(); };
  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-xl bg-cinza p-3">
        <p className="font-bold">{c.nome}</p>
        <p className="text-suave">{telefoneBR(c.telefone)} · {c.empresa ?? c.cidade ?? ""}</p>
        <p className="text-suave">{[c.bairro, c.cidade].filter(Boolean).join(" · ") || "endereço não informado"}</p>
        {c.observacoes && <p className="mt-1">{c.observacoes}</p>}
        <div className="mt-2 flex gap-3">
          <button type="button" className="font-semibold text-marca-escuro hover:underline" onClick={() => setEditando(true)}>Editar dados</button>
          {c.telefone && <a className="font-semibold text-marca-escuro hover:underline" href={`https://wa.me/${c.telefone.length >= 12 ? c.telefone : `55${c.telefone}`}`} target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a>}
        </div>
      </div>
      <div>
        <p className="mb-1 font-bold">Débito em aberto: {reais(dados.debitoCentavos)}{dados.debitoAtualizadoCentavos > dados.debitoCentavos && <span className="text-red-700"> ({reais(dados.debitoAtualizadoCentavos)} com juros)</span>}</p>
        {fiado && <div className="mt-2 rounded-xl border border-borda p-3"><FiadoDoCliente g={fiado} aoMudar={mudou} /></div>}
      </div>
      <div>
        <p className="mb-1 font-bold">Compras ({dados.compras.length})</p>
        {dados.compras.length === 0 && <p className="text-suave">Nenhuma compra ainda.</p>}
        {dados.compras.map((v) => (
          <div key={v.id} className="border-b border-borda py-1.5">
            <p className="flex justify-between"><span>{dataBR(v.data)} · {FORMAS[v.formaPagamento]}</span><span className="flex items-center gap-2 font-semibold">{reais(v.totalCentavos)} <Etiqueta valor={v.status} /></span></p>
            <p className="text-suave">{v.itens}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Clientes() {
  const [busca, setBusca] = useState("");
  const termo = useAtrasado(busca.trim());
  const { dados, erro, recarregar } = useDados<ClienteLista[]>(comFiltros("/api/clientes", { busca: termo || undefined }));
  const [aberto, setAberto] = useState<string | "novo" | null>(null);
  return (
    <>
      <Cabecalho titulo="Clientes"><button type="button" className="btn btn-escuro" onClick={() => setAberto("novo")}>+ Novo cliente</button></Cabecalho>
      <input aria-label="Buscar cliente" placeholder="Buscar por nome, telefone ou empresa…" value={busca} onChange={(e) => setBusca(e.target.value)} className="mb-3 w-full rounded-xl border border-borda bg-white px-3 py-2.5" />
      <Aviso msg={erro} />
      <Tabela linhas={dados} chave={(c) => c.id} vazio="Nenhum cliente encontrado." aoClicar={(c) => setAberto(c.id)} colunas={[
        { titulo: "Nome", valor: (c) => <b>{c.nome}</b> },
        { titulo: "WhatsApp", valor: (c) => telefoneBR(c.telefone) },
        { titulo: "Cidade", valor: (c) => c.cidade ?? "—", esconderNoCelular: true },
        { titulo: "Compras", valor: (c) => c.compras, alinhar: "direita", esconderNoCelular: true },
        { titulo: "Em aberto", valor: (c) => <span className={c.debitoCentavos ? "font-bold text-red-700" : ""}>{reais(c.debitoCentavos)}</span>, alinhar: "direita" },
      ]} />
      <Modal titulo={aberto === "novo" ? "Novo cliente" : "Cliente"} aberto={!!aberto} aoFechar={() => { setAberto(null); void recarregar(); }} largo={aberto !== "novo"}>
        {aberto === "novo" ? <FormCliente aoSalvar={() => { setAberto(null); void recarregar(); }} /> : aberto && <DetalheCliente id={aberto} aoMudar={recarregar} />}
      </Modal>
    </>
  );
}
