// Estrutura do painel: barra lateral (computador) ou topo com abas (celular), aviso de demonstração e troca de papel.
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { chamar, papelAtual, trocarPapel } from "./api";
import { banco, restaurarDemonstracao } from "./servidor/banco";
import { PapelContexto, type Papel } from "./ui";

const I = {
  resumo: <path d="M3 13h4v8H3zM10 8h4v13h-4zM17 3h4v18h-4z" />,
  vendas: <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0" />,
  receber: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20M6 15h4" /></>,
  estoque: <><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>,
  contas: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>,
  gastos: <><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>,
  clientes: <><circle cx="9" cy="8" r="4" /><path d="M1 21a8 8 0 0 1 16 0M17 4a4 4 0 0 1 0 8M23 21a8 8 0 0 0-5-7.4" /></>,
};
const Icone = ({ d, className = "h-[18px] w-[18px]" }: { d: ReactNode; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{d}</svg>
);

const TELAS = {
  resumo: { nome: "Resumo", Tela: lazy(() => import("./telas/Dashboard")) },
  vendas: { nome: "Vendas", Tela: lazy(() => import("./telas/Vendas")) },
  receber: { nome: "A receber", Tela: lazy(() => import("./telas/Fiado")) },
  estoque: { nome: "Estoque", Tela: lazy(() => import("./telas/Estoque")) },
  contas: { nome: "Contas a pagar", Tela: lazy(() => import("./telas/Contas")) },
  gastos: { nome: "Gastos", Tela: lazy(() => import("./telas/Gastos")) },
  clientes: { nome: "Clientes", Tela: lazy(() => import("./telas/Clientes")) },
} as const;
type NomeTela = keyof typeof TELAS;
const DA_EQUIPE: NomeTela[] = ["vendas", "estoque", "clientes"]; // o que o funcionário enxerga
const telasDo = (papel: Papel) => (papel === "dono" ? (Object.keys(TELAS) as NomeTela[]) : DA_EQUIPE);
const telaDaUrl = (papel: Papel): NomeTela => {
  const t = window.location.hash.replace(/^#\/?/, "").split(/[/?]/)[0] as NomeTela;
  return telasDo(papel).includes(t) ? t : telasDo(papel)[0];
};

function Marca({ claro }: { claro?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#7c7cff] to-[#4338ca] text-white shadow-[0_6px_16px_-6px_rgba(91,91,240,.8)]">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 17l5-5 4 4 7-8" /><path d="M14 8h6v6" /></svg>
      </span>
      <span className="leading-tight">
        <span className={`titulo block text-[15px] ${claro ? "text-white" : ""}`}>Sua Empresa</span>
        <span className={`block text-[11px] font-medium ${claro ? "text-white/50" : "text-suave"}`}>Gestão financeira</span>
      </span>
    </div>
  );
}

function Carregando() {
  return (
    <div className="grid min-h-dvh place-items-center bg-escuro p-6 text-center text-white">
      <div className="surgir">
        <div className="mx-auto mb-6 w-fit"><Marca claro /></div>
        <div className="mx-auto mb-4 h-1 w-48 overflow-hidden rounded-full bg-white/10"><div className="h-full w-1/3 animate-[barra_1.1s_ease-in-out_infinite] rounded-full bg-marca" /></div>
        <p className="text-sm text-white/70">Preparando os dados de exemplo…</p>
        <p className="mt-1 text-xs text-white/40">Na primeira visita leva alguns segundos.</p>
      </div>
      <style>{"@keyframes barra{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}"}</style>
    </div>
  );
}

function SeletorPapel({ papel, escuro }: { papel: Papel; escuro?: boolean }) {
  return (
    <div className={`flex rounded-xl p-1 text-xs font-semibold ${escuro ? "bg-white/5" : "bg-cinza"}`} role="radiogroup" aria-label="Ver o painel como">
      {(["dono", "funcionario"] as const).map((p) => (
        <button key={p} type="button" role="radio" aria-checked={papel === p} onClick={() => papel !== p && trocarPapel(p)}
          className={`flex-1 rounded-lg px-3 py-1.5 transition ${papel === p ? (escuro ? "bg-white text-escuro" : "bg-white text-texto shadow-sm") : escuro ? "text-white/60 hover:text-white" : "text-suave hover:text-texto"}`}>
          {p === "dono" ? "Dono" : "Funcionário"}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const [pronto, setPronto] = useState(false);
  const papel = papelAtual();
  const [tela, setTela] = useState<NomeTela>(() => telaDaUrl(papel));
  const [baixando, setBaixando] = useState(false);

  useEffect(() => { banco().then(() => setPronto(true)); }, []);
  useEffect(() => {
    const voltar = () => setTela(telaDaUrl(papel));
    window.addEventListener("hashchange", voltar);
    return () => window.removeEventListener("hashchange", voltar);
  }, [papel]);
  useEffect(() => { document.title = `${TELAS[tela].nome} · Gestão financeira`; window.scrollTo(0, 0); }, [tela]);

  async function backup() {
    setBaixando(true);
    const r = await chamar("/api/backup");
    setBaixando(false);
    if (!r.ok) return alert(r.erro);
    const url = URL.createObjectURL(new Blob([JSON.stringify(r.dados, null, 2)], { type: "application/json" }));
    Object.assign(document.createElement("a"), { href: url, download: `backup-${new Date().toISOString().slice(0, 10)}.json` }).click();
    URL.revokeObjectURL(url);
  }
  async function restaurar() {
    if (confirm("Apagar tudo o que você lançou e voltar aos dados de exemplo?")) await restaurarDemonstracao();
  }

  if (!pronto) return <Carregando />;
  const { Tela } = TELAS[tela];
  const links = telasDo(papel).map((t) => (
    <a key={t} href={`#/${t}`} aria-current={tela === t ? "page" : undefined}
      className={`group flex items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-semibold transition ${tela === t ? "bg-white/10 text-white" : "text-white/55 hover:bg-white/5 hover:text-white"}`}>
      <span className={tela === t ? "text-[#a5a8ff]" : ""}><Icone d={I[t]} /></span>
      {TELAS[t].nome}
    </a>
  ));

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* barra lateral */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-escuro px-4 py-5 lg:flex">
        <div className="px-2"><Marca claro /></div>
        <nav aria-label="Seções" className="mt-8 flex flex-col gap-1">
          <p className="sobretitulo mb-1 px-3 !text-white/35">Menu</p>
          {links}
        </nav>
        <div className="mt-auto space-y-3">
          <div className="rounded-2xl border border-white/10 bg-white/[.03] p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">Ver como</p>
            <SeletorPapel papel={papel} escuro />
            <p className="mt-2 text-[11px] leading-snug text-white/40">{papel === "dono" ? "Acesso completo aos números da empresa." : "Só vendas, estoque (sem custo) e clientes."}</p>
          </div>
          <div className="flex gap-2 px-1 text-xs">
            {papel === "dono" && <button type="button" onClick={backup} disabled={baixando} className="font-semibold text-white/50 hover:text-white">{baixando ? "Gerando…" : "Baixar backup"}</button>}
            <span className="text-white/20">·</span>
            <button type="button" onClick={restaurar} className="font-semibold text-white/50 hover:text-white">Restaurar exemplo</button>
          </div>
        </div>
      </aside>

      {/* topo no celular */}
      <header className="sticky top-0 z-30 bg-escuro text-white lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <Marca claro />
          <div className="w-44"><SeletorPapel papel={papel} escuro /></div>
        </div>
        <nav aria-label="Seções" className="flex gap-1 overflow-x-auto px-3 pb-2.5 [scrollbar-width:none]">{links}</nav>
      </header>

      <div className="border-b border-borda bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs md:px-8">
          <p className="flex items-center gap-2 text-suave">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-marca-claro px-2 py-0.5 font-semibold text-marca-escuro"><span className="h-1.5 w-1.5 rounded-full bg-marca" />Demonstração</span>
            Dados fictícios, salvos só neste navegador. Fique à vontade para testar.
          </p>
          <button type="button" onClick={restaurar} className="font-semibold text-marca-escuro hover:underline lg:hidden">Restaurar exemplo</button>
        </div>
      </div>

      <main className="mx-auto max-w-6xl p-4 pb-16 md:p-8">
        <PapelContexto.Provider value={papel}>
          <Suspense fallback={<p className="py-10 text-center text-sm text-suave">Carregando…</p>}>
            <div key={tela} className="surgir"><Tela /></div>
          </Suspense>
        </PapelContexto.Provider>
      </main>
    </div>
  );
}
