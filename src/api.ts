// Chamadas do painel à "API". Na demonstração, a API roda no próprio navegador (src/servidor), com a mesma
// interface de uma API HTTP: trocar por fetch() para um servidor de verdade é mudar só esta função.
import { banco } from "./servidor/banco";
import { rotear, type Metodo } from "./servidor/rotas";
import type { Papel } from "./ui";

export type Resposta<T> = { ok: true; dados: T } | { ok: false; status: number; erro: string };

const CHAVE_PAPEL = "mf-papel";
export const papelAtual = (): Papel => {
  try { return localStorage.getItem(CHAVE_PAPEL) === "funcionario" ? "funcionario" : "dono"; } catch { return "dono"; }
};
export const trocarPapel = (p: Papel) => {
  try { localStorage.setItem(CHAVE_PAPEL, p); } catch { /* sem armazenamento: vale só nesta aba */ }
  window.location.reload();
};

export async function chamar<T>(caminho: string, corpo?: unknown, metodo?: Metodo): Promise<Resposta<T>> {
  const m: Metodo = metodo ?? (corpo === undefined ? "GET" : "POST");
  try {
    const b = await banco();
    const papel = papelAtual();
    const r = await rotear({ db: b.db, lote: b.lote, usuarioId: papel === "dono" ? b.donoId : b.funcionarioId, ip: "navegador" }, papel, m, caminho, m === "POST" || m === "PATCH" ? (corpo ?? {}) : undefined);
    // dados passam por JSON como numa API de verdade (datas viram texto etc.)
    const dados = JSON.parse(JSON.stringify(r.corpo ?? {}));
    if (r.status >= 400) return { ok: false, status: r.status, erro: dados.erro ?? "Algo deu errado. Tente de novo." };
    return { ok: true, dados };
  } catch (e) {
    console.error(e);
    return { ok: false, status: 0, erro: "Não foi possível acessar os dados." };
  }
}

/** Monta a URL com filtros (só os preenchidos). */
export const comFiltros = (caminho: string, f: Record<string, string | undefined>) => {
  const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  return q ? `${caminho}?${q}` : caminho;
};
