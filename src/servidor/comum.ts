// Base das operações do painel: contexto (banco + quem está fazendo), erros com status HTTP, datas e dinheiro.
import { auditoria } from "./schema";
import type { Db } from "./banco";

/**
 * Executa várias escritas numa transação só: ou tudo grava, ou nada grava.
 * No PGlite (navegador) vira uma transação local; num Postgres gerenciado, uma transação no servidor.
 */
export type Lote = (consultas: unknown[]) => Promise<unknown>;

/** papel: "funcionario" só alcança as rotas liberadas para a equipe e recebe os dados sem custo nem totais da empresa. */
export type Ctx = { db: Db; lote: Lote; usuarioId: string; ip: string; papel?: "dono" | "funcionario" };
export const ehFuncionario = (ctx: Ctx) => ctx.papel === "funcionario";

/** Erro esperado (regra de negócio): vira resposta com o status e a mensagem, sem detalhes internos. */
export class ErroPainel extends Error {
  constructor(public status: number, mensagem: string) {
    super(mensagem);
  }
}

/** Registro de auditoria (devolve a consulta, para entrar no mesmo lote da operação). */
export const auditar = (ctx: Ctx, acao: string, entidade: string, entidadeId: string | null, dados?: Record<string, unknown>) =>
  ctx.db.insert(auditoria).values({ acao, entidade, entidadeId, usuarioId: ctx.usuarioId, ip: ctx.ip, dados: dados ?? null });

/** Data de hoje no fuso de Brasília, no formato do banco: AAAA-MM-DD. */
export const hojeSP = (agora = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);

/** Soma meses a uma data AAAA-MM-DD sem pular mês (31/01 + 1 mês = 28 ou 29/02). */
export function somarMeses(data: string, meses: number) {
  const [a, m, d] = data.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimoDia));
  return alvo.toISOString().slice(0, 10);
}

export const diasEntre = (de: string, ate: string) => Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000);

/** Divide um valor em parcelas iguais, em centavos; a diferença de arredondamento vai na primeira. */
export function dividirEmParcelas(totalCentavos: number, n: number) {
  const base = Math.floor(totalCentavos / n);
  return Array.from({ length: n }, (_, i) => base + (i === 0 ? totalCentavos - base * n : 0));
}

/** Erro de "estoque negativo" ou outra trava do banco, vindo de dentro do lote. */
export const violouTrava = (e: unknown, nome: string) => String((e as { message?: string })?.message ?? e).includes(nome)
  || String((e as { cause?: { message?: string } })?.cause?.message ?? "").includes(nome);

/** Identificador novo (UUID v4) — usa a API do navegador, sem depender do Node. */
export const novoId = () => crypto.randomUUID();
