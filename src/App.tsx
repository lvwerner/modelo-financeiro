// Estrutura do painel: menu lateral (computador) ou topo com abas (celular), faixa de demonstração, perfil e tema.
import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { BarChart3, Boxes, CircleDollarSign, FileText, HandCoins, Info, ShoppingCart, UserRound, Users, type LucideIcon } from "lucide-react";
import { chamar, papelAtual, trocarPapel } from "./api";
import { EMPRESA, iniciais, type Modulo } from "./config/empresa";
import { banco, restaurarDemonstracao } from "./servidor/banco";
import { acompanharSistema, aplicarTema, temaSalvo, type Tema } from "./tema";
import { Esqueleto, PapelContexto, ProvedorAvisos, Segmentos, type Papel } from "./ui";

type NomeTela = Modulo | "perfil";
const TELAS: Record<NomeTela, { nome: string; icone: LucideIcon; Tela: ComponentType }> = {
  resumo: { nome: "Resumo", icone: BarChart3, Tela: lazy(() => import("./telas/Dashboard")) },
  vendas: { nome: "Vendas", icone: ShoppingCart, Tela: lazy(() => import("./telas/Vendas")) },
  receber: { nome: "A receber", icone: HandCoins, Tela: lazy(() => import("./telas/Fiado")) },
  estoque: { nome: "Estoque", icone: Boxes, Tela: lazy(() => import("./telas/Estoque")) },
  contas: { nome: "Contas a pagar", icone: FileText, Tela: lazy(() => import("./telas/Contas")) },
  gastos: { nome: "Gastos", icone: CircleDollarSign, Tela: lazy(() => import("./telas/Gastos")) },
  clientes: { nome: "Clientes", icone: Users, Tela: lazy(() => import("./telas/Clientes")) },
  perfil: { nome: "Meu perfil", icone: UserRound, Tela: lazy(() => import("./telas/Perfil")) },
};
const DA_EQUIPE: Modulo[] = ["vendas", "estoque", "clientes"]; // o que o funcionário enxerga
const menuDo = (papel: Papel) => EMPRESA.modulos.filter((m) => papel === "dono" || DA_EQUIPE.includes(m));
const telaDaUrl = (papel: Papel): NomeTela => {
  const t = window.location.hash.replace(/^#\/?/, "").split(/[/?]/)[0] as NomeTela;
  return t === "perfil" || menuDo(papel).includes(t as Modulo) ? t : menuDo(papel)[0];
};

function Marca() {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {EMPRESA.logo
        ? <img src={EMPRESA.logo} alt="" className="h-8 w-8 shrink-0 rounded-md object-contain" />
        : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-borda-forte bg-cinza text-xs font-semibold" aria-hidden>{iniciais(EMPRESA.nome)}</span>}
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-semibold">{EMPRESA.nome}</span>
        <span className="block truncate text-xs text-suave">{EMPRESA.descricao}</span>
      </span>
    </div>
  );
}

function Carregando() {
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="w-64 space-y-3 text-center">
        <div className="mx-auto w-fit"><Marca /></div>
        <div className="esqueleto h-1 w-full" />
        <p className="text-sm text-suave">Preparando os dados…</p>
      </div>
    </div>
  );
}

export default function App() {
  const [pronto, setPronto] = useState(false);
  const papel = papelAtual();
  const [tela, setTela] = useState<NomeTela>(() => telaDaUrl(papel));
  const [usuario, setUsuario] = useState<{ nome: string; tema: Tema } | null>(null);

  useEffect(() => acompanharSistema(), []);
  useEffect(() => {
    banco().then(async () => {
      // o tema salvo no perfil (banco) vale em qualquer dispositivo; o do navegador é só o fallback inicial
      const r = await chamar<{ nome: string; tema: Tema }>("/api/perfil");
      if (r.ok) { setUsuario(r.dados); if (r.dados.tema !== temaSalvo()) aplicarTema(r.dados.tema); }
      setPronto(true);
    });
  }, []);
  useEffect(() => {
    const voltar = () => setTela(telaDaUrl(papel));
    window.addEventListener("hashchange", voltar);
    return () => window.removeEventListener("hashchange", voltar);
  }, [papel]);
  useEffect(() => { document.title = `${TELAS[tela].nome} · ${EMPRESA.nome}`; window.scrollTo(0, 0); }, [tela]);

  async function restaurar() {
    if (confirm("Apagar tudo o que você lançou e voltar aos dados de exemplo?")) await restaurarDemonstracao();
  }

  if (!pronto) return <Carregando />;
  const { Tela } = TELAS[tela];
  const link = (t: NomeTela, compacto = false) => {
    const { nome, icone: Icone } = TELAS[t];
    const ativo = tela === t;
    return (
      <a key={t} href={`#/${t}`} aria-current={ativo ? "page" : undefined}
        className={`flex items-center gap-2.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm ${ativo ? "bg-cinza font-semibold text-texto" : "text-suave hover:bg-cinza hover:text-texto"} ${compacto ? "" : "relative"}`}>
        {ativo && !compacto && <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-acento" />}
        <Icone size={16} strokeWidth={1.75} aria-hidden className={ativo ? "text-acento" : ""} />
        {nome}
      </a>
    );
  };

  return (
    <ProvedorAvisos>
      <div className="min-h-dvh lg:pl-60">
        {/* menu lateral */}
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-borda bg-superficie px-3 py-4 lg:flex">
          <div className="px-1.5"><Marca /></div>
          <nav aria-label="Seções" className="mt-6 flex flex-col gap-0.5">{menuDo(papel).map((t) => link(t))}</nav>
          <div className="mt-auto space-y-3 border-t border-borda pt-3">
            {link("perfil")}
            {usuario && <p className="px-2.5 text-xs text-suave">{usuario.nome} · {papel === "dono" ? "Dono" : "Funcionário"}</p>}
            {EMPRESA.demonstracao && (
              <div className="space-y-2 px-1">
                <p className="sobretitulo">Ver como</p>
                <Segmentos rotulo="Ver o painel como" valor={papel} aoMudar={(p) => p !== papel && trocarPapel(p)} opcoes={[["dono", "Dono"], ["funcionario", "Funcionário"]]} />
                <button type="button" onClick={restaurar} className="block text-xs text-suave hover:text-texto hover:underline">Restaurar dados de exemplo</button>
              </div>
            )}
          </div>
        </aside>

        {/* topo no celular */}
        <header className="sticky top-0 z-30 border-b border-borda bg-superficie lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <Marca />
            {EMPRESA.demonstracao && <Segmentos rotulo="Ver o painel como" valor={papel} aoMudar={(p) => p !== papel && trocarPapel(p)} opcoes={[["dono", "Dono"], ["funcionario", "Func."]]} />}
          </div>
          <nav aria-label="Seções" className="flex gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none]">
            {menuDo(papel).map((t) => link(t, true))}{link("perfil", true)}
          </nav>
        </header>

        {EMPRESA.demonstracao && (
          <div className="border-b border-borda bg-superficie">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-xs text-suave md:px-6">
              <Info size={14} aria-hidden />
              <span><b className="font-semibold text-texto">Demonstração.</b> Dados fictícios, salvos só neste navegador.</span>
              <button type="button" onClick={restaurar} className="link lg:hidden">Restaurar exemplo</button>
            </div>
          </div>
        )}

        <main className="mx-auto max-w-7xl p-4 pb-16 md:p-6">
          <PapelContexto.Provider value={papel}>
            <Suspense fallback={<Esqueleto />}><Tela /></Suspense>
          </PapelContexto.Provider>
        </main>
      </div>
    </ProvedorAvisos>
  );
}
