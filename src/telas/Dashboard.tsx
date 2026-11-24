// Dashboard: números do período, gráficos e o resumo financeiro com empresa e pessoal separados.
// Gráficos em SVG próprio (sem biblioteca): colunas com dica ao passar o mouse, barra dividida e barras horizontais.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { comFiltros } from "../api";
import { Aviso, Campo, dataBR, FORMAS, hoje, reais, useDados } from "../ui";

type Resumo = {
  periodo: { de: string; ate: string };
  anterior: { de: string; ate: string; faturamento: number };
  faturamento: number; vendas: number; ticketMedio: number;
  porForma: Record<"pix" | "cartao" | "dinheiro" | "prazo", number>;
  lucro: { valor: number; vendasComCusto: number; faturamentoComCusto: number; margem: number | null };
  caixa: { vendasAVista: number; entradasFiado: number; parcelasRecebidas: number; total: number };
  empresa: { entrou: number; gastos: number; resultado: number; porCategoria: { categoria: string; valor: number }[] };
  pessoal: { gastos: number; porCategoria: { categoria: string; valor: number }[] };
  receber: { total: number; atrasado: number; atrasadoComJuros: number; proximos30Dias: number; parcelasAtrasadas: number;
    devedores: { clienteId: string; nome: string; telefone: string | null; valor: number; atrasado: number }[] };
  estoque: { itens: number; repor: number; valorVenda: number; valorCusto: number; semCusto: number };
  serie: { agrupamento: "dia" | "mes"; pontos: { chave: string; valor: number }[] };
};

// Cores dos dados (paleta validada para daltonismo); textos usam sempre as cores de texto do site, nunca a do dado.
const COR = { serie: "#5b5bf0", pix: "#5b5bf0", cartao: "#e8665a", dinheiro: "#12a37a", prazo: "#f0a72b", grade: "#edf0f6", base: "#d3d8e6", mudo: "#8a91a8" };
const ORDEM_FORMAS = ["pix", "cartao", "dinheiro", "prazo"] as const;
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloChave = (chave: string, ag: "dia" | "mes") =>
  ag === "mes" ? `${MESES[Number(chave.slice(5, 7)) - 1]}/${chave.slice(2, 4)}` : `${chave.slice(8, 10)}/${chave.slice(5, 7)}`;
/** Valor curto para eixo: R$ 950 · R$ 12 mil · R$ 1,2 mi */
const curto = (c: number) => {
  const r = c / 100;
  if (r >= 1_000_000) return `R$ ${(r / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (r >= 1000) return `R$ ${(r / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `R$ ${Math.round(r)}`;
};
const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

function usarLargura<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function Cartao({ titulo, subtitulo, children, className = "" }: { titulo: string; subtitulo?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`cartao p-5 md:p-6 ${className}`}>
      <h2 className="titulo text-base">{titulo}</h2>
      {subtitulo && <p className="mb-4 mt-0.5 text-xs text-suave">{subtitulo}</p>}
      {!subtitulo && <div className="mb-3" />}
      {children}
    </section>
  );
}

/** Variação contra o período anterior: seta + texto (nunca só a cor). */
function Variacao({ atual, anterior }: { atual: number; anterior: number }) {
  if (!anterior) return <span className="text-sm text-white/70">sem vendas no período anterior</span>;
  const d = (atual - anterior) / anterior;
  const sobe = d >= 0;
  return (
    <span className={`text-sm font-bold ${sobe ? "text-green-300" : "text-red-300"}`}>
      {sobe ? "▲" : "▼"} {pct(Math.abs(d))} <span className="font-semibold text-white/70">vs. período anterior ({reais(anterior)})</span>
    </span>
  );
}

function Indicador({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: ReactNode }) {
  return (
    <div className="cartao p-4">
      <p className="text-xs font-medium text-suave">{rotulo}</p>
      <p className="titulo valor mt-1.5 text-xl sm:text-2xl">{valor}</p>
      {detalhe && <p className="mt-1 text-xs text-suave">{detalhe}</p>}
    </div>
  );
}

/** Colunas do faturamento por dia (ou mês). Uma série: sem legenda; o título diz o que é. */
function Colunas({ serie }: { serie: Resumo["serie"] }) {
  const [ref, largura] = usarLargura<HTMLDivElement>();
  const [foco, setFoco] = useState<number | null>(null);
  const altura = 220, margem = { topo: 12, dir: 8, base: 26, esq: 64 };
  const pts = serie.pontos;
  const max = Math.max(...pts.map((p) => p.valor), 1);
  // eixo com números redondos
  const passoBruto = max / 3;
  const ordem = 10 ** Math.floor(Math.log10(passoBruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * ordem).find((p) => p >= passoBruto) ?? passoBruto;
  const topo = Math.ceil(max / passo) * passo;
  const ticks = Array.from({ length: Math.round(topo / passo) + 1 }, (_, i) => i * passo);
  const areaW = Math.max(largura - margem.esq - margem.dir, 0);
  const areaH = altura - margem.topo - margem.base;
  const banda = pts.length ? areaW / pts.length : 0;
  const barra = Math.min(24, Math.max(banda - 2, 1)); // no máximo 24px, sempre com 2px de respiro
  const y = (v: number) => margem.topo + areaH - (v / topo) * areaH;
  const cadaRotulo = Math.max(1, Math.ceil(pts.length / Math.max(Math.floor(areaW / 46), 1)));
  const p = foco != null ? pts[foco] : null;

  return (
    <div ref={ref} className="relative">
      {largura > 0 && (
        <svg width={largura} height={altura} role="img" aria-label={`Faturamento por ${serie.agrupamento === "mes" ? "mês" : "dia"}, máximo de ${reais(max)}`} onMouseLeave={() => setFoco(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={margem.esq} x2={largura - margem.dir} y1={y(t)} y2={y(t)} stroke={t === 0 ? COR.base : COR.grade} strokeWidth={1} />
              <text x={margem.esq - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={COR.mudo} style={{ fontVariantNumeric: "tabular-nums" }}>{curto(t)}</text>
            </g>
          ))}
          {pts.map((pt, i) => {
            const x = margem.esq + i * banda + (banda - barra) / 2;
            const h = Math.max(y(0) - y(pt.valor), pt.valor > 0 ? 2 : 0);
            const r = Math.min(4, barra / 2, h);
            return (
              <g key={pt.chave}>
                {/* área de toque maior que a barra */}
                <rect x={margem.esq + i * banda} y={margem.topo} width={banda} height={areaH} fill="transparent" onMouseEnter={() => setFoco(i)} onClick={() => setFoco(i)} />
                {h > 0 && (
                  <path pointerEvents="none" opacity={foco == null || foco === i ? 1 : 0.45} fill={COR.serie}
                    d={`M${x},${y(0)} V${y(0) - h + r} Q${x},${y(0) - h} ${x + r},${y(0) - h} H${x + barra - r} Q${x + barra},${y(0) - h} ${x + barra},${y(0) - h + r} V${y(0)} Z`} />
                )}
                {i % cadaRotulo === 0 && (
                  <text x={margem.esq + i * banda + banda / 2} y={altura - 8} textAnchor="middle" fontSize={11} fill={COR.mudo}>{rotuloChave(pt.chave, serie.agrupamento)}</text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {p && foco != null && (
        <div className="pointer-events-none absolute -translate-x-1/2 rounded-xl bg-escuro px-3 py-2 text-xs text-white shadow-xl"
          style={{ left: Math.min(Math.max(margem.esq + foco * banda + banda / 2, 70), largura - 70), top: Math.max(y(p.valor) - 56, 0) }}>
          <p className="text-white/60">{serie.agrupamento === "mes" ? rotuloChave(p.chave, "mes") : dataBR(p.chave)}</p>
          <p className="font-bold">{reais(p.valor)}</p>
        </div>
      )}
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-suave">Ver em tabela</summary>
        <table className="mt-2 w-full text-xs" style={{ fontVariantNumeric: "tabular-nums" }}>
          <tbody>{pts.filter((x) => x.valor > 0).map((x) => <tr key={x.chave} className="border-b border-borda"><td className="py-1">{serie.agrupamento === "mes" ? rotuloChave(x.chave, "mes") : dataBR(x.chave)}</td><td className="py-1 text-right">{reais(x.valor)}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}

/** Formas de pagamento: um todo dividido em partes. Legenda com nome, valor e % (o amarelo e o verde-água têm pouco contraste). */
function BarraFormas({ porForma, total }: { porForma: Resumo["porForma"]; total: number }) {
  if (!total) return <p className="text-sm text-suave">Sem vendas no período.</p>;
  const partes = ORDEM_FORMAS.filter((f) => porForma[f] > 0);
  return (
    <div>
      <div className="flex h-8 gap-[3px]" role="img" aria-label={partes.map((f) => `${FORMAS[f]} ${reais(porForma[f])} (${pct(porForma[f] / total)})`).join(", ")}>
        {partes.map((f) => {
          const parte = porForma[f] / total;
          return (
            <div key={f} className="flex items-center overflow-hidden rounded-md px-2 text-xs font-bold" style={{ width: `${parte * 100}%`, background: COR[f], color: f === "prazo" ? "#0b0b0b" : "#ffffff" }}>
              {parte >= 0.12 && <span className="whitespace-nowrap">{Math.round(parte * 100)}%</span>}
            </div>
          );
        })}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {ORDEM_FORMAS.map((f) => (
          <li key={f} className="flex items-center gap-2">
            <span aria-hidden className="h-3 w-3 shrink-0 rounded-sm" style={{ background: COR[f] }} />
            <span className="flex-1 text-suave">{FORMAS[f]}</span>
            <span className="font-semibold">{reais(porForma[f])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Barras horizontais (categorias de gasto). Uma série: valor na ponta de cada barra. */
function Barras({ itens }: { itens: { categoria: string; valor: number }[] }) {
  if (!itens.length) return <p className="text-sm text-suave">Nenhum gasto no período.</p>;
  const top = itens.slice(0, 6);
  const resto = itens.slice(6).reduce((t, i) => t + i.valor, 0);
  const lista = resto ? [...top, { categoria: "Outras", valor: resto }] : top;
  const max = Math.max(...lista.map((i) => i.valor));
  return (
    <ul className="space-y-2.5">
      {lista.map((i) => (
        <li key={i.categoria}>
          <div className="mb-1 flex justify-between gap-2 text-sm"><span className="text-suave">{i.categoria}</span><span className="font-semibold">{reais(i.valor)}</span></div>
          <div className="h-2.5 rounded-full bg-[#eef0f7]"><div className="h-full rounded-full bg-gradient-to-r from-[#8b8bff] to-[#5b5bf0]" style={{ width: `${Math.max((i.valor / max) * 100, 1)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

function Linha({ rotulo, valor, forte, sinal }: { rotulo: string; valor: number; forte?: boolean; sinal?: "+" | "−" }) {
  return (
    <p className={`flex justify-between gap-3 py-1.5 ${forte ? "mt-1 border-t border-borda pt-3 text-base font-bold" : "text-sm"}`}>
      <span className={forte ? "" : "text-suave"}>{rotulo}</span>
      <span className={`valor ${forte && valor < 0 ? "text-red-700" : forte && valor > 0 ? "text-positivo" : ""}`}>{sinal ? `${sinal} ` : ""}{reais(Math.abs(valor))}{forte && valor < 0 ? " (negativo)" : ""}</span>
    </p>
  );
}

const PRESETS = [
  { nome: "Hoje", periodo: () => ({ de: hoje(), ate: hoje() }) },
  { nome: "Esta semana", periodo: () => { // de segunda até hoje
    const dia = new Date(`${hoje()}T12:00:00Z`).getUTCDay();
    return { de: new Date(Date.parse(hoje()) - ((dia + 6) % 7) * 86_400_000).toISOString().slice(0, 10), ate: hoje() };
  } },
  { nome: "Este mês", periodo: () => ({ de: `${hoje().slice(0, 8)}01`, ate: hoje() }) },
  { nome: "Mês passado", periodo: () => {
    const [a, m] = hoje().split("-").map(Number);
    const ini = new Date(Date.UTC(a, m - 2, 1)), fim = new Date(Date.UTC(a, m - 1, 0));
    return { de: ini.toISOString().slice(0, 10), ate: fim.toISOString().slice(0, 10) };
  } },
  { nome: "Últimos 30 dias", periodo: () => ({ de: new Date(Date.parse(hoje()) - 29 * 86_400_000).toISOString().slice(0, 10), ate: hoje() }) },
  { nome: "Este ano", periodo: () => ({ de: `${hoje().slice(0, 4)}-01-01`, ate: hoje() }) },
];

export default function Dashboard() {
  const [periodo, setPeriodo] = useState(PRESETS[4].periodo()); // começa em "Últimos 30 dias"
  const { dados: r, erro } = useDados<Resumo>(comFiltros("/api/dashboard", periodo));
  const presetAtivo = PRESETS.find((p) => { const x = p.periodo(); return x.de === periodo.de && x.ate === periodo.ate; })?.nome;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div><p className="sobretitulo">Visão geral</p><h1 className="titulo mt-1 text-2xl md:text-[2rem]">Resumo financeiro</h1></div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Período">
            {PRESETS.map((p) => (
              <button key={p.nome} type="button" aria-pressed={presetAtivo === p.nome} onClick={() => setPeriodo(p.periodo())}
                className="chip">{p.nome}</button>
            ))}
          </div>
          <Campo rotulo="De" id="dde"><input id="dde" type="date" value={periodo.de} max={periodo.ate} onChange={(e) => e.target.value && setPeriodo((x) => ({ ...x, de: e.target.value }))} /></Campo>
          <Campo rotulo="Até" id="date"><input id="date" type="date" value={periodo.ate} min={periodo.de} onChange={(e) => e.target.value && setPeriodo((x) => ({ ...x, ate: e.target.value }))} /></Campo>
        </div>
      </div>
      <Aviso msg={erro} />
      {!r ? <p className="py-10 text-center text-sm text-suave">Carregando…</p> : (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[1.3fr_2fr]">
            <section className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-escuro via-[#1b2147] to-[#3730a3] p-6 text-white shadow-[0_20px_50px_-25px_rgba(55,48,163,.8)]"><div aria-hidden className="pointer-events-none absolute -right-16 -top-16 -z-10 h-56 w-56 rounded-full bg-[#7c7cff]/25 blur-3xl" />
              <p className="text-sm font-semibold text-white/70">Faturamento · {dataBR(r.periodo.de)} a {dataBR(r.periodo.ate)}</p>
              <p className="titulo valor mt-3 text-4xl md:text-5xl">{reais(r.faturamento)}</p>
              <p className="mt-2"><Variacao atual={r.faturamento} anterior={r.anterior.faturamento} /></p>
            </section>
            <div className="grid grid-cols-2 gap-3">
              <Indicador rotulo="Vendas" valor={String(r.vendas)} detalhe={`Ticket médio ${reais(r.ticketMedio)}`} />
              <Indicador rotulo="Lucro bruto" valor={reais(r.lucro.valor)}
                detalhe={r.lucro.vendasComCusto === r.vendas
                  ? (r.lucro.margem != null ? `Margem de ${pct(r.lucro.margem)}` : "—")
                  : `De ${r.lucro.vendasComCusto} das ${r.vendas} vendas: as outras têm produto sem custo`} />
              <Indicador rotulo="Entrou no caixa" valor={reais(r.caixa.total)} detalhe="À vista, entradas e recebimentos a prazo" />
              <Indicador rotulo="A receber (a prazo)" valor={reais(r.receber.total)}
                detalhe={r.receber.atrasado ? <span className="font-semibold text-red-700">⚠ {reais(r.receber.atrasado)} atrasado</span> : "Nada atrasado"} />
            </div>
          </div>

          <Cartao titulo={`Faturamento por ${r.serie.agrupamento === "mes" ? "mês" : "dia"}`} subtitulo="Vendas concluídas, pela data da venda. Passe o mouse ou toque numa coluna para ver o valor.">
            <Colunas serie={r.serie} />
          </Cartao>

          <div className="grid gap-4 lg:grid-cols-2">
            <Cartao titulo="Resultado da empresa" subtitulo="O que entrou no caixa menos os gastos da empresa no período">
              <Linha rotulo="Vendas à vista (Pix, cartão, dinheiro)" valor={r.caixa.vendasAVista} sinal="+" />
              <Linha rotulo="Entradas de vendas a prazo" valor={r.caixa.entradasFiado} sinal="+" />
              <Linha rotulo="Recebimentos a prazo" valor={r.caixa.parcelasRecebidas} sinal="+" />
              <Linha rotulo="Gastos da empresa" valor={r.empresa.gastos} sinal="−" />
              <Linha rotulo="Resultado" valor={r.empresa.resultado} forte />
            </Cartao>
            <Cartao titulo="Pessoal" subtitulo="Gastos pessoais no período, separados da empresa">
              <Linha rotulo="Total de gastos pessoais" valor={r.pessoal.gastos} forte />
              <div className="mt-3"><Barras itens={r.pessoal.porCategoria} /></div>
            </Cartao>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Cartao titulo="Formas de pagamento" subtitulo="Quanto do faturamento veio de cada forma"><BarraFormas porForma={r.porForma} total={r.faturamento} /></Cartao>
            <Cartao titulo="Gastos da empresa por categoria"><Barras itens={r.empresa.porCategoria} /></Cartao>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Cartao titulo="Contas a receber" subtitulo="Vendas a prazo em aberto hoje (não depende do período)">
              <Linha rotulo="Vence nos próximos 30 dias" valor={r.receber.proximos30Dias} />
              <Linha rotulo={`Atrasado (${r.receber.parcelasAtrasadas} parcelas)`} valor={r.receber.atrasado} />
              <Linha rotulo="Atrasado com multa e juros" valor={r.receber.atrasadoComJuros} />
              <Linha rotulo="Total em aberto" valor={r.receber.total} forte />
              {r.receber.devedores.length > 0 && (
                <table className="mt-3 w-full text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
                  <thead><tr className="text-left text-xs text-suave"><th className="py-1 font-semibold">Cliente</th><th className="py-1 text-right font-semibold">Atrasado</th><th className="py-1 text-right font-semibold">Em aberto</th></tr></thead>
                  <tbody>
                    {r.receber.devedores.map((d) => (
                      <tr key={d.clienteId} className="border-t border-borda">
                        <td className="py-1.5">
                          {d.telefone
                            ? <a className="font-semibold hover:underline" href={`https://wa.me/${d.telefone.length >= 12 ? d.telefone : `55${d.telefone}`}`} target="_blank" rel="noopener noreferrer">{d.nome}</a>
                            : <span className="font-semibold">{d.nome}</span>}
                        </td>
                        <td className={`py-1.5 text-right ${d.atrasado ? "font-semibold text-red-700" : "text-suave"}`}>{d.atrasado ? reais(d.atrasado) : "—"}</td>
                        <td className="py-1.5 text-right">{reais(d.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Cartao>
            <Cartao titulo="Estoque agora" subtitulo="Produtos ativos">
              <p className="flex justify-between gap-3 py-1.5 text-sm"><span className="text-suave">Itens em estoque</span><span className="valor">{r.estoque.itens}</span></p>
              <Linha rotulo="Valor de venda do estoque" valor={r.estoque.valorVenda} />
              <Linha rotulo="Custo do estoque (com custo cadastrado)" valor={r.estoque.valorCusto} />
              {r.estoque.repor > 0 && <a href="#/estoque" className="mt-3 block rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-800 ring-1 ring-red-200 hover:bg-red-100">⚠ {r.estoque.repor} {r.estoque.repor === 1 ? "produto está" : "produtos estão"} no estoque mínimo ou abaixo — ver no Estoque →</a>}
              {r.estoque.semCusto > 0 && (
                <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">⚠ {r.estoque.semCusto} produtos em estoque estão sem custo: cadastre em Estoque para o lucro ficar completo.</p>
              )}
            </Cartao>
          </div>
        </div>
      )}
    </>
  );
}
