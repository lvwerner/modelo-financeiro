// Resumo: números do período, gráfico de faturamento e o resultado com empresa e pessoal separados.
// Gráficos em SVG próprio (sem biblioteca), numa cor só (a de destaque); cores semânticas só para atraso e estoque baixo.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { comFiltros } from "../api";
import { Aviso, Campo, Cartao, dataBR, Esqueleto, FORMAS, hoje, reais, Segmentos, telefoneBR, useDados } from "../ui";

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

/** Variação contra o período anterior: seta + texto (nunca só a cor). */
function Variacao({ atual, anterior }: { atual: number; anterior: number }) {
  if (!anterior) return <>sem vendas no período anterior</>;
  const d = (atual - anterior) / anterior;
  const Seta = d >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-0.5">
      <Seta size={14} aria-hidden className={d >= 0 ? "text-sucesso" : "text-perigo"} />
      <span className={d >= 0 ? "text-sucesso" : "text-perigo"}>{pct(Math.abs(d))}</span>&nbsp;vs. período anterior
    </span>
  );
}

/** Colunas do faturamento por dia (ou mês). */
function Colunas({ serie }: { serie: Resumo["serie"] }) {
  const [ref, largura] = usarLargura<HTMLDivElement>();
  const [foco, setFoco] = useState<number | null>(null);
  const altura = 220, margem = { topo: 10, dir: 4, base: 24, esq: 60 };
  const pts = serie.pontos;
  const max = Math.max(...pts.map((p) => p.valor), 1);
  const passoBruto = max / 3;
  const ordem = 10 ** Math.floor(Math.log10(passoBruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * ordem).find((p) => p >= passoBruto) ?? passoBruto;
  const topo = Math.ceil(max / passo) * passo;
  const ticks = Array.from({ length: Math.round(topo / passo) + 1 }, (_, i) => i * passo);
  const areaW = Math.max(largura - margem.esq - margem.dir, 0);
  const areaH = altura - margem.topo - margem.base;
  const banda = pts.length ? areaW / pts.length : 0;
  const barra = Math.min(22, Math.max(banda - 2, 1));
  const y = (v: number) => margem.topo + areaH - (v / topo) * areaH;
  const cadaRotulo = Math.max(1, Math.ceil(pts.length / Math.max(Math.floor(areaW / 46), 1)));
  const p = foco != null ? pts[foco] : null;

  return (
    <div ref={ref} className="relative">
      {largura > 0 && (
        <svg width={largura} height={altura} role="img" aria-label={`Faturamento por ${serie.agrupamento === "mes" ? "mês" : "dia"}, máximo de ${reais(max)}`} onMouseLeave={() => setFoco(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={margem.esq} x2={largura - margem.dir} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--borda-forte)" : "var(--borda)"} strokeWidth={1} />
              <text x={margem.esq - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--suave)" style={{ fontVariantNumeric: "tabular-nums" }}>{curto(t)}</text>
            </g>
          ))}
          {pts.map((pt, i) => {
            const x = margem.esq + i * banda + (banda - barra) / 2;
            const h = Math.max(y(0) - y(pt.valor), pt.valor > 0 ? 1 : 0);
            return (
              <g key={pt.chave}>
                <rect x={margem.esq + i * banda} y={margem.topo} width={banda} height={areaH} fill="transparent" onMouseEnter={() => setFoco(i)} onClick={() => setFoco(i)} />
                {h > 0 && <rect pointerEvents="none" x={x} y={y(0) - h} width={barra} height={h} rx={1.5} fill="var(--acento)" opacity={foco == null || foco === i ? 1 : 0.45} />}
                {i % cadaRotulo === 0 && (
                  <text x={margem.esq + i * banda + banda / 2} y={altura - 6} textAnchor="middle" fontSize={11} fill="var(--suave)">{rotuloChave(pt.chave, serie.agrupamento)}</text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {p && foco != null && (
        <div className="cartao pointer-events-none absolute -translate-x-1/2 px-2.5 py-1.5 text-xs shadow-[var(--sombra-modal)]"
          style={{ left: Math.min(Math.max(margem.esq + foco * banda + banda / 2, 70), largura - 70), top: Math.max(y(p.valor) - 52, 0) }}>
          <p className="text-suave">{serie.agrupamento === "mes" ? rotuloChave(p.chave, "mes") : dataBR(p.chave)}</p>
          <p className="valor font-semibold">{reais(p.valor)}</p>
        </div>
      )}
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-xs text-suave">Ver em tabela</summary>
        <table className="mt-2 w-full text-xs">
          <tbody>{pts.filter((x) => x.valor > 0).map((x) => <tr key={x.chave} className="border-b border-borda"><td className="py-1">{serie.agrupamento === "mes" ? rotuloChave(x.chave, "mes") : dataBR(x.chave)}</td><td className="py-1 text-right">{reais(x.valor)}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}

/** Lista com barra proporcional (formas de pagamento, gastos por categoria): rótulo, barra, % e valor, numa cor só. */
function Barras({ itens, total, vazio }: { itens: { rotulo: string; valor: number }[]; total?: number; vazio: string }) {
  const lista = itens.filter((i) => i.valor > 0);
  if (!lista.length) return <p className="text-sm text-suave">{vazio}</p>;
  const top = lista.slice(0, 6);
  const resto = lista.slice(6).reduce((t, i) => t + i.valor, 0);
  const linhas = resto ? [...top, { rotulo: "Outras", valor: resto }] : top;
  const soma = total ?? linhas.reduce((t, i) => t + i.valor, 0);
  const max = Math.max(...linhas.map((i) => i.valor));
  return (
    <table className="w-full text-sm">
      <tbody>
        {linhas.map((i) => (
          <tr key={i.rotulo}>
            <td className="w-[38%] py-1.5 pr-3 text-suave">{i.rotulo}</td>
            <td className="py-1.5 pr-3">
              <div className="h-1.5 rounded-sm bg-cinza"><div className="h-full rounded-sm bg-acento" style={{ width: `${Math.max((i.valor / max) * 100, 1)}%` }} /></div>
            </td>
            <td className="w-[1%] whitespace-nowrap py-1.5 pr-3 text-right text-xs text-suave">{soma ? pct(i.valor / soma) : ""}</td>
            <td className="w-[1%] whitespace-nowrap py-1.5 text-right font-medium">{reais(i.valor)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Linha({ rotulo, valor, forte, sinal }: { rotulo: string; valor: number; forte?: boolean; sinal?: "+" | "−" }) {
  return (
    <p className={`flex justify-between gap-3 py-1 text-sm ${forte ? "mt-1 border-t border-borda pt-2 font-semibold" : ""}`}>
      <span className={forte ? "" : "text-suave"}>{rotulo}</span>
      <span className={`valor ${forte && valor < 0 ? "text-perigo" : ""}`}>{sinal ? `${sinal} ` : ""}{reais(Math.abs(valor))}{forte && valor < 0 ? " (negativo)" : ""}</span>
    </p>
  );
}

function Indicador({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: ReactNode }) {
  return (
    <div className="bg-superficie px-4 py-3">
      <p className="text-xs text-suave">{rotulo}</p>
      <p className="valor mt-1 text-xl font-semibold">{valor}</p>
      {detalhe && <p className="mt-0.5 text-xs text-suave">{detalhe}</p>}
    </div>
  );
}

const PRESETS = {
  hoje: { nome: "Hoje", periodo: () => ({ de: hoje(), ate: hoje() }) },
  semana: { nome: "Semana", periodo: () => {
    const dia = new Date(`${hoje()}T12:00:00Z`).getUTCDay();
    return { de: new Date(Date.parse(hoje()) - ((dia + 6) % 7) * 86_400_000).toISOString().slice(0, 10), ate: hoje() };
  } },
  mes: { nome: "Este mês", periodo: () => ({ de: `${hoje().slice(0, 8)}01`, ate: hoje() }) },
  passado: { nome: "Mês passado", periodo: () => {
    const [a, m] = hoje().split("-").map(Number);
    const ini = new Date(Date.UTC(a, m - 2, 1)), fim = new Date(Date.UTC(a, m - 1, 0));
    return { de: ini.toISOString().slice(0, 10), ate: fim.toISOString().slice(0, 10) };
  } },
  d30: { nome: "30 dias", periodo: () => ({ de: new Date(Date.parse(hoje()) - 29 * 86_400_000).toISOString().slice(0, 10), ate: hoje() }) },
  ano: { nome: "Este ano", periodo: () => ({ de: `${hoje().slice(0, 4)}-01-01`, ate: hoje() }) },
};
type Preset = keyof typeof PRESETS;

export default function Dashboard() {
  const [periodo, setPeriodo] = useState(PRESETS.d30.periodo());
  const { dados: r, erro } = useDados<Resumo>(comFiltros("/api/dashboard", periodo));
  const presetAtivo = (Object.keys(PRESETS) as Preset[]).find((k) => { const x = PRESETS[k].periodo(); return x.de === periodo.de && x.ate === periodo.ate; });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-borda pb-4">
        <div>
          <h1 className="titulo text-xl">Resumo</h1>
          <p className="mt-0.5 text-sm text-suave">{r ? `${dataBR(r.periodo.de)} a ${dataBR(r.periodo.ate)}` : "Carregando período…"}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Segmentos rotulo="Período" valor={presetAtivo} aoMudar={(k) => setPeriodo(PRESETS[k].periodo())} opcoes={(Object.keys(PRESETS) as Preset[]).map((k) => [k, PRESETS[k].nome])} />
          <Campo rotulo="De" id="dde"><input id="dde" type="date" value={periodo.de} max={periodo.ate} onChange={(e) => e.target.value && setPeriodo((x) => ({ ...x, de: e.target.value }))} /></Campo>
          <Campo rotulo="Até" id="date"><input id="date" type="date" value={periodo.ate} min={periodo.de} onChange={(e) => e.target.value && setPeriodo((x) => ({ ...x, ate: e.target.value }))} /></Campo>
        </div>
      </div>
      <Aviso msg={erro} />
      {!r ? <Esqueleto linhas={8} /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-borda bg-borda md:grid-cols-3 xl:grid-cols-5">
            <Indicador rotulo="Faturamento" valor={reais(r.faturamento)} detalhe={<Variacao atual={r.faturamento} anterior={r.anterior.faturamento} />} />
            <Indicador rotulo="Vendas" valor={String(r.vendas)} detalhe={`Ticket médio ${reais(r.ticketMedio)}`} />
            <Indicador rotulo="Lucro bruto" valor={reais(r.lucro.valor)}
              detalhe={r.lucro.vendasComCusto === r.vendas ? (r.lucro.margem != null ? `Margem de ${pct(r.lucro.margem)}` : "—") : `De ${r.lucro.vendasComCusto} das ${r.vendas} vendas`} />
            <Indicador rotulo="Entrou no caixa" valor={reais(r.caixa.total)} detalhe="À vista + recebimentos" />
            <Indicador rotulo="A receber" valor={reais(r.receber.total)}
              detalhe={r.receber.atrasado ? <span className="text-perigo">{reais(r.receber.atrasado)} atrasado</span> : "Nada atrasado"} />
          </div>

          <Cartao titulo={`Faturamento por ${r.serie.agrupamento === "mes" ? "mês" : "dia"}`} descricao="Vendas concluídas, pela data da venda">
            <Colunas serie={r.serie} />
          </Cartao>

          <div className="grid gap-4 lg:grid-cols-2">
            <Cartao titulo="Resultado da empresa" descricao="O que entrou no caixa menos os gastos da empresa">
              <Linha rotulo="Vendas à vista (Pix, cartão, dinheiro)" valor={r.caixa.vendasAVista} sinal="+" />
              <Linha rotulo="Entradas de vendas a prazo" valor={r.caixa.entradasFiado} sinal="+" />
              <Linha rotulo="Recebimentos a prazo" valor={r.caixa.parcelasRecebidas} sinal="+" />
              <Linha rotulo="Gastos da empresa" valor={r.empresa.gastos} sinal="−" />
              <Linha rotulo="Resultado" valor={r.empresa.resultado} forte />
            </Cartao>
            <Cartao titulo="Formas de pagamento" descricao="Quanto do faturamento veio de cada forma">
              <Barras total={r.faturamento} vazio="Sem vendas no período." itens={(["pix", "cartao", "dinheiro", "prazo"] as const).map((f) => ({ rotulo: FORMAS[f], valor: r.porForma[f] }))} />
            </Cartao>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Cartao titulo="Gastos da empresa por categoria">
              <Barras vazio="Nenhum gasto no período." itens={r.empresa.porCategoria.map((g) => ({ rotulo: g.categoria, valor: g.valor }))} />
            </Cartao>
            <Cartao titulo="Gastos pessoais" descricao={`Total no período: ${reais(r.pessoal.gastos)} (separado da empresa)`}>
              <Barras vazio="Nenhum gasto pessoal no período." itens={r.pessoal.porCategoria.map((g) => ({ rotulo: g.categoria, valor: g.valor }))} />
            </Cartao>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Cartao titulo="Contas a receber" descricao="Vendas a prazo em aberto hoje (não depende do período)">
              <Linha rotulo="Vence nos próximos 30 dias" valor={r.receber.proximos30Dias} />
              <Linha rotulo={`Atrasado (${r.receber.parcelasAtrasadas} parcelas)`} valor={r.receber.atrasado} />
              <Linha rotulo="Atrasado com multa e juros" valor={r.receber.atrasadoComJuros} />
              <Linha rotulo="Total em aberto" valor={r.receber.total} forte />
              {r.receber.devedores.length > 0 && (
                <table className="mt-3 w-full text-sm">
                  <thead><tr className="border-b border-borda text-left text-xs text-suave"><th className="py-1.5 font-medium">Maiores saldos</th><th className="py-1.5 text-right font-medium">Atrasado</th><th className="py-1.5 text-right font-medium">Em aberto</th></tr></thead>
                  <tbody>
                    {r.receber.devedores.map((d) => (
                      <tr key={d.clienteId} className="border-b border-borda last:border-0">
                        <td className="py-1.5"><span className="font-medium">{d.nome}</span>{d.telefone && <span className="block text-xs text-suave">{telefoneBR(d.telefone)}</span>}</td>
                        <td className={`py-1.5 text-right ${d.atrasado ? "text-perigo" : "text-suave"}`}>{d.atrasado ? reais(d.atrasado) : "—"}</td>
                        <td className="py-1.5 text-right">{reais(d.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Cartao>
            <Cartao titulo="Estoque agora" descricao="Produtos ativos">
              <p className="flex justify-between gap-3 py-1 text-sm"><span className="text-suave">Itens em estoque</span><span className="valor">{r.estoque.itens}</span></p>
              <Linha rotulo="Valor de venda do estoque" valor={r.estoque.valorVenda} />
              <Linha rotulo="Custo do estoque" valor={r.estoque.valorCusto} />
              {r.estoque.repor > 0 && (
                <a href="#/estoque" className="mt-3 flex items-center gap-2 rounded-md border border-perigo/30 bg-perigo-fundo px-3 py-2 text-sm text-perigo hover:underline">
                  <AlertTriangle size={16} aria-hidden />{r.estoque.repor} {r.estoque.repor === 1 ? "produto está" : "produtos estão"} no estoque mínimo ou abaixo
                </a>
              )}
              {r.estoque.semCusto > 0 && (
                <p className="mt-3 flex items-center gap-2 rounded-md border border-alerta/30 bg-alerta-fundo px-3 py-2 text-sm text-alerta">
                  <AlertTriangle size={16} aria-hidden />{r.estoque.semCusto} produtos sem custo cadastrado: o lucro fica incompleto.
                </p>
              )}
            </Cartao>
          </div>
        </div>
      )}
    </>
  );
}
