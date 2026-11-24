// Peças de interface do painel: dinheiro, datas, campos, janela modal, avisos e etiquetas de status.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { chamar } from "./api";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const reais = (centavos: number | null | undefined) => (centavos == null ? "—" : brl.format(centavos / 100));
export const dataBR = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
export const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
export const somarMeses = (iso: string, n: number) => {
  const [a, m, d] = iso.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + n, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
};
export const primeiroDiaDoMes = () => `${hoje().slice(0, 8)}01`;
/** Quem está usando: o funcionário vê só vender, estoque (sem custo) e clientes. O servidor confere de novo cada pedido. */
export type Papel = "dono" | "funcionario";
export const PapelContexto = createContext<Papel>("funcionario");
export const useFuncionario = () => useContext(PapelContexto) === "funcionario";
export const FORMAS: Record<string, string> = { pix: "Pix", cartao: "Cartão", dinheiro: "Dinheiro", prazo: "A prazo" };

/** Valor que só muda depois que a pessoa para de digitar (evita uma busca por tecla). */
export function useAtrasado<T>(valor: T, ms = 300) {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

/** Carrega dados da API e recarrega quando a URL muda. */
export function useDados<T>(url: string | null) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const recarregar = useCallback(async () => {
    if (!url) return;
    setCarregando(true);
    const r = await chamar<T>(url);
    setCarregando(false);
    if (r.ok) { setDados(r.dados); setErro(""); } else setErro(r.erro);
  }, [url]);
  useEffect(() => { void recarregar(); }, [recarregar]);
  return { dados, erro, carregando, recarregar };
}

/** Campo de dinheiro tipo "caixa registradora": digita os números e ele forma R$ 1.234,56. Guarda centavos. */
export function InputDinheiro({ id, valor, aoMudar, required, disabled, className, rotulo }: { id: string; valor: number; aoMudar: (c: number) => void; required?: boolean; disabled?: boolean; className?: string; rotulo?: string }) {
  return (
    <input
      id={id}
      inputMode="numeric"
      value={valor ? reais(valor) : ""}
      placeholder="R$ 0,00"
      required={required}
      disabled={disabled}
      className={className}
      aria-label={rotulo}
      onChange={(e) => aoMudar(Math.min(Number(e.target.value.replace(/\D/g, "") || 0), 100_000_000))}
    />
  );
}

export function Campo({ rotulo, id, children, dica }: { rotulo: string; id: string; children: ReactNode; dica?: string }) {
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      {children}
      {dica && <p className="mt-1 text-xs text-suave">{dica}</p>}
    </div>
  );
}

export function Aviso({ msg, tipo = "erro" }: { msg: string; tipo?: "erro" | "ok" }) {
  if (!msg) return null;
  return <p role={tipo === "erro" ? "alert" : "status"} className={`rounded-xl px-3 py-2 text-sm font-medium ${tipo === "erro" ? "bg-red-50 text-red-700 ring-1 ring-red-200" : "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"}`}>{msg}</p>;
}

const CORES: Record<string, string> = {
  pago: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200", concluida: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  pendente: "bg-amber-50 text-amber-800 ring-1 ring-amber-200", atrasado: "bg-red-50 text-red-700 ring-1 ring-red-200", cancelada: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  empresa: "bg-sky-50 text-sky-800 ring-1 ring-sky-200", pessoal: "bg-violet-50 text-violet-800 ring-1 ring-violet-200",
};
const NOMES: Record<string, string> = { pago: "Pago", pendente: "Pendente", atrasado: "Atrasado", concluida: "Concluída", cancelada: "Cancelada", empresa: "Empresa", pessoal: "Pessoal" };
export const Etiqueta = ({ valor }: { valor: string }) => (
  <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${CORES[valor] ?? "bg-gray-100 text-gray-800"}`}>{NOMES[valor] ?? valor}</span>
);

/** Janela modal acessível (Esc fecha, foco começa dentro). */
export function Modal({ titulo, aberto, aoFechar, children, largo }: { titulo: string; aberto: boolean; aoFechar: () => void; children: ReactNode; largo?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const anterior = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("keydown", tecla); anterior?.focus(); };
  }, [aberto, aoFechar]);
  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0e1324]/50 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={aoFechar}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={titulo} onClick={(e) => e.stopPropagation()}
        className={`max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl ${largo ? "sm:max-w-2xl" : "sm:max-w-md"}`}>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="titulo text-xl">{titulo}</h2>
          <button type="button" onClick={aoFechar} className="grid h-10 w-10 place-items-center rounded-full text-suave hover:bg-cinza" aria-label="Fechar">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Tabela que vira cartões no celular (cada linha mostra rótulo: valor). */
export function Tabela<T>({ linhas, colunas, vazio, chave, aoClicar }: {
  linhas: T[] | null; colunas: { titulo: string; valor: (l: T) => ReactNode; alinhar?: "direita"; esconderNoCelular?: boolean }[];
  vazio: string; chave: (l: T) => string; aoClicar?: (l: T) => void;
}) {
  if (!linhas) return <p className="py-8 text-center text-sm text-suave">Carregando…</p>;
  if (!linhas.length) return <p className="py-8 text-center text-sm text-suave">{vazio}</p>;
  return (
    <div className="cartao overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="hidden border-b border-borda bg-[#fafbfe] text-left text-[11px] uppercase tracking-wider text-suave md:table-header-group">
          <tr>{colunas.map((c) => <th key={c.titulo} className={`px-4 py-3 font-semibold ${c.alinhar === "direita" ? "text-right" : ""}`}>{c.titulo}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-borda">
          {linhas.map((l) => (
            <tr key={chave(l)} onClick={aoClicar ? () => aoClicar(l) : undefined} className={`block p-3 md:table-row md:p-0 ${aoClicar ? "cursor-pointer hover:bg-[#f8f9ff]" : ""}`}>
              {colunas.map((c) => (
                <td key={c.titulo} className={`flex justify-between gap-3 py-0.5 md:table-cell md:px-4 md:py-3 ${c.alinhar === "direita" ? "md:text-right" : ""} ${c.esconderNoCelular ? "hidden md:table-cell" : ""}`}>
                  <span className="text-xs font-semibold text-suave md:hidden">{c.titulo}</span>
                  <span>{c.valor(l)}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Cabecalho({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <h1 className="titulo text-2xl md:text-[2rem]">{titulo}</h1>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export function Resumo({ itens }: { itens: { rotulo: string; valor: string; destaque?: boolean }[] }) {
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
      {itens.map((i) => (
        <div key={i.rotulo} className={`rounded-2xl border p-4 ${i.destaque ? "border-transparent bg-gradient-to-br from-escuro to-[#262d55] text-white shadow-[0_10px_30px_-15px_rgba(14,19,36,.7)]" : "border-borda bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)]"}`}>
          <p className={`text-xs font-medium ${i.destaque ? "text-white/60" : "text-suave"}`}>{i.rotulo}</p>
          <p className="titulo valor mt-1.5 text-lg sm:text-xl">{i.valor}</p>
        </div>
      ))}
    </div>
  );
}
