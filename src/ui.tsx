// Componentes de interface do painel (um lugar só): formatação, campos, botões, Modal, Tabela, Etiqueta, Cartão,
// indicadores, esqueleto de carregamento, estado vazio e avisos (toast). Cores só pelos tokens de src/index.css.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Inbox, X, XCircle } from "lucide-react";
import { chamar } from "./api";

// ---------- formatação ----------
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
export const telefoneBR = (t: string | null | undefined) => (t ? t.replace(/^(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3") : "—");

/** Quem está usando: o funcionário vê só vender, estoque (sem custo) e clientes. O servidor confere de novo cada pedido. */
export type Papel = "dono" | "funcionario";
export const PapelContexto = createContext<Papel>("funcionario");
export const useFuncionario = () => useContext(PapelContexto) === "funcionario";
export const FORMAS: Record<string, string> = { pix: "Pix", cartao: "Cartão", dinheiro: "Dinheiro", prazo: "A prazo" };

// ---------- dados ----------
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

// ---------- avisos (toast) ----------
type Toast = { id: number; msg: string; tipo: "ok" | "erro" };
const ToastContexto = createContext<(msg: string, tipo?: Toast["tipo"]) => void>(() => {});
/** avisar("Venda registrada.") — mensagem discreta no canto, some sozinha. */
export const useAvisar = () => useContext(ToastContexto);

export function ProvedorAvisos({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Toast[]>([]);
  const avisar = useCallback((msg: string, tipo: Toast["tipo"] = "ok") => {
    const id = Date.now() + Math.random();
    setLista((l) => [...l.slice(-2), { id, msg, tipo }]);
    setTimeout(() => setLista((l) => l.filter((t) => t.id !== id)), 3500);
  }, []);
  return (
    <ToastContexto.Provider value={avisar}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end" aria-live="polite">
        {lista.map((t) => (
          <div key={t.id} role="status" className="cartao pointer-events-auto flex max-w-sm items-center gap-2 px-3 py-2.5 text-sm shadow-[var(--sombra-modal)]">
            {t.tipo === "ok" ? <CheckCircle2 size={16} className="shrink-0 text-sucesso" aria-hidden /> : <XCircle size={16} className="shrink-0 text-perigo" aria-hidden />}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastContexto.Provider>
  );
}

// ---------- campos e botões ----------
/** Campo de dinheiro tipo "caixa registradora": digita os números e ele forma R$ 1.234,56. Guarda centavos. */
export function InputDinheiro({ id, valor, aoMudar, required, disabled, className, rotulo }: { id: string; valor: number; aoMudar: (c: number) => void; required?: boolean; disabled?: boolean; className?: string; rotulo?: string }) {
  return (
    <input id={id} inputMode="numeric" value={valor ? reais(valor) : ""} placeholder="R$ 0,00" required={required} disabled={disabled}
      className={`tabular ${className ?? ""}`} aria-label={rotulo}
      onChange={(e) => aoMudar(Math.min(Number(e.target.value.replace(/\D/g, "") || 0), 100_000_000))} />
  );
}

export function Campo({ rotulo, id, children, dica }: { rotulo: string; id: string; children: ReactNode; dica?: string }) {
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      {children}
      {dica && <p className="text-xs text-suave">{dica}</p>}
    </div>
  );
}

type Variante = "primario" | "contorno" | "perigo";
export function Botao({ variante = "contorno", pequeno, icone, className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; pequeno?: boolean; icone?: ReactNode }) {
  return (
    <button type="button" {...props} className={`btn btn-${variante} ${pequeno ? "btn-sm" : ""} ${className}`}>
      {icone}{children}
    </button>
  );
}

/** Mensagem dentro de formulário (erro de validação). Sucesso vai por toast (useAvisar). */
export function Aviso({ msg, tipo = "erro" }: { msg: string; tipo?: "erro" | "ok" }) {
  if (!msg) return null;
  return (
    <p role={tipo === "erro" ? "alert" : "status"}
      className={`rounded-md border px-3 py-2 text-sm ${tipo === "erro" ? "border-perigo/30 bg-perigo-fundo text-perigo" : "border-sucesso/30 bg-sucesso-fundo text-sucesso"}`}>
      {msg}
    </p>
  );
}

// ---------- etiquetas de situação (cor só com significado) ----------
const TOM: Record<string, "sucesso" | "alerta" | "perigo" | "neutro"> = {
  pago: "sucesso", concluida: "sucesso", quitada: "sucesso", "paga no mês": "sucesso",
  pendente: "alerta", "a pagar": "alerta",
  atrasado: "perigo", vencida: "perigo",
  cancelada: "neutro", empresa: "neutro", pessoal: "neutro",
};
const NOMES: Record<string, string> = {
  pago: "Pago", pendente: "Pendente", atrasado: "Atrasado", concluida: "Concluída", cancelada: "Cancelada", empresa: "Empresa", pessoal: "Pessoal",
  quitada: "Quitada", "paga no mês": "Paga no mês", vencida: "Vencida", "a pagar": "A pagar",
};
const CLASSE_TOM = {
  sucesso: "bg-sucesso-fundo text-sucesso", alerta: "bg-alerta-fundo text-alerta", perigo: "bg-perigo-fundo text-perigo", neutro: "bg-cinza text-suave",
};
export const Etiqueta = ({ valor }: { valor: string }) => (
  <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-xs font-medium ${CLASSE_TOM[TOM[valor] ?? "neutro"]}`}>
    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />{NOMES[valor] ?? valor}
  </span>
);

// ---------- Modal ----------
/**
 * Modal único do sistema. Cabeçalho fixo, corpo com rolagem própria e, se houver <RodapeModal>, botões sempre visíveis.
 * Celular: tela cheia. Computador: centralizado, até 90vh. Fundo escuro simples (sem blur). Renderizado no <body>
 * (fora de qualquer elemento com transform/overflow, que deslocaria ou cortaria a janela). Esc fecha; o foco começa no
 * primeiro campo e volta para onde estava ao fechar.
 */
export function Modal({ titulo, aberto, aoFechar, children, largo }: { titulo: string; aberto: boolean; aoFechar: () => void; children: ReactNode; largo?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const fechar = useRef(aoFechar);
  fechar.current = aoFechar;
  useEffect(() => {
    if (!aberto) return;
    const anterior = document.activeElement as HTMLElement | null;
    const corpo = ref.current;
    (corpo?.querySelector<HTMLElement>("[data-corpo] input:not([disabled]), [data-corpo] select, [data-corpo] textarea") ?? corpo?.querySelector<HTMLElement>("button"))?.focus();
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") fechar.current(); };
    document.addEventListener("keydown", tecla);
    const rolagem = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // a página de trás não rola junto
    return () => { document.removeEventListener("keydown", tecla); document.body.style.overflow = rolagem; anterior?.focus(); };
  }, [aberto]);
  if (!aberto) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-[var(--overlay)] sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={titulo}
        className={`flex h-dvh w-full flex-col bg-superficie shadow-[var(--sombra-modal)] sm:h-auto sm:max-h-[90vh] sm:rounded-md sm:border sm:border-borda ${largo ? "sm:max-w-2xl" : "sm:max-w-lg"}`}>
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-borda px-5 py-3">
          <h2 className="titulo text-base">{titulo}</h2>
          <button type="button" onClick={aoFechar} className="-mr-2 grid h-8 w-8 place-items-center rounded-md text-suave hover:bg-cinza hover:text-texto" aria-label="Fechar">
            <X size={18} aria-hidden />
          </button>
        </header>
        <div data-corpo className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-4 [&>form]:flex [&>form]:flex-1 [&>form]:flex-col">
          {children}
          <div className="espacador h-4 shrink-0" aria-hidden />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Botões do formulário do modal: ficam presos embaixo enquanto o corpo rola. Use como último filho do <form>. */
export function RodapeModal({ children }: { children: ReactNode }) {
  return <div className="rodape-modal sticky bottom-0 -mx-5 mt-auto space-y-2 border-t border-borda bg-superficie px-5 py-3">{children}</div>;
}

// ---------- Tabela ----------
export type Coluna<T> = { titulo: string; valor: (l: T) => ReactNode; alinhar?: "direita"; esconderNoCelular?: boolean };

export function Esqueleto({ linhas = 6 }: { linhas?: number }) {
  return (
    <div className="cartao divide-y divide-borda" aria-busy="true" aria-label="Carregando">
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <div className="esqueleto h-3.5 w-24" /><div className="esqueleto h-3.5 flex-1" /><div className="esqueleto h-3.5 w-20" />
        </div>
      ))}
    </div>
  );
}

export function Vazio({ texto, acao }: { texto: string; acao?: ReactNode }) {
  return (
    <div className="cartao flex flex-col items-center gap-2 px-4 py-10 text-center">
      <Inbox size={22} className="text-suave" aria-hidden />
      <p className="text-sm text-suave">{texto}</p>
      {acao}
    </div>
  );
}

/** Tabela do sistema: cabeçalho fixo ao rolar, zebra sutil, números alinhados à direita. No celular, cada linha vira um cartão. */
export function Tabela<T>({ linhas, colunas, vazio, chave, aoClicar, alturaMaxima = true }: {
  linhas: T[] | null; colunas: Coluna<T>[]; vazio: string; chave: (l: T) => string; aoClicar?: (l: T) => void; alturaMaxima?: boolean;
}) {
  if (!linhas) return <Esqueleto />;
  if (!linhas.length) return <Vazio texto={vazio} />;
  return (
    <div className={`cartao overflow-auto ${alturaMaxima ? "md:max-h-[calc(100dvh-260px)]" : ""}`}>
      <table className="w-full border-collapse text-sm">
        <thead className="hidden md:table-header-group">
          <tr>
            {colunas.map((c) => (
              <th key={c.titulo} scope="col" className={`sticky top-0 z-10 border-b border-borda bg-cinza px-3 py-2 text-xs font-semibold text-suave ${c.alinhar === "direita" ? "text-right" : "text-left"}`}>{c.titulo}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={chave(l)} onClick={aoClicar ? () => aoClicar(l) : undefined}
              className={`block border-b border-borda p-3 last:border-b-0 md:table-row md:p-0 md:even:bg-zebra ${aoClicar ? "cursor-pointer hover:bg-cinza md:even:hover:bg-cinza" : ""}`}>
              {colunas.map((c) => (
                <td key={c.titulo} className={`flex justify-between gap-3 py-0.5 md:table-cell md:px-3 md:py-2 ${c.alinhar === "direita" ? "md:text-right" : ""} ${c.esconderNoCelular ? "hidden md:table-cell" : ""}`}>
                  <span className="text-xs text-suave md:hidden">{c.titulo}</span>
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

// ---------- estrutura das telas ----------
export function Cabecalho({ titulo, descricao, children }: { titulo: string; descricao?: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-borda pb-4">
      <div>
        <h1 className="titulo text-xl">{titulo}</h1>
        {descricao && <p className="mt-0.5 text-sm text-suave">{descricao}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export function Cartao({ titulo, descricao, acoes, children, className = "" }: { titulo?: string; descricao?: string; acoes?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`cartao ${className}`}>
      {titulo && (
        <header className="flex items-start justify-between gap-3 border-b border-borda px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">{titulo}</h2>
            {descricao && <p className="text-xs text-suave">{descricao}</p>}
          </div>
          {acoes}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Faixa de indicadores (KPIs). */
export function Resumo({ itens }: { itens: { rotulo: string; valor: string; detalhe?: ReactNode; tom?: "perigo" | "sucesso" }[] }) {
  return (
    <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2">
      {itens.map((i) => (
        <div key={i.rotulo} className="cartao px-3 py-2.5">
          <p className="text-xs text-suave">{i.rotulo}</p>
          <p className={`valor mt-1 text-lg font-semibold ${i.tom === "perigo" ? "text-perigo" : i.tom === "sucesso" ? "text-sucesso" : ""}`}>{i.valor}</p>
          {i.detalhe && <p className="mt-0.5 text-xs text-suave">{i.detalhe}</p>}
        </div>
      ))}
    </div>
  );
}

/** Seletor segmentado (abas, filtros, períodos). */
export function Segmentos<K extends string>({ opcoes, valor, aoMudar, rotulo }: { opcoes: [K, string][]; valor: K | undefined; aoMudar: (k: K) => void; rotulo: string }) {
  return (
    <div className="segmentos max-w-full overflow-x-auto" role="group" aria-label={rotulo}>
      {opcoes.map(([k, nome]) => (
        <button key={k} type="button" aria-pressed={valor === k} onClick={() => aoMudar(k)}>{nome}</button>
      ))}
    </div>
  );
}

/** Telefone para listagens: (11) 9••••-4501. O número completo só aparece na ficha do cliente. */
export const telefoneMascarado = (t: string | null | undefined) =>
  t ? telefoneBR(t).replace(/(\) \d)(\d+)(?=-)/, (_, ini: string, meio: string) => ini + "•".repeat(meio.length)) : "—";
