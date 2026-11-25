// Tema claro/escuro/sistema. O index.html aplica o tema salvo antes da página aparecer (sem piscar);
// aqui fica a troca em tempo de execução e a cor de destaque do cliente.
import { EMPRESA } from "./config/empresa";

export type Tema = "claro" | "escuro" | "sistema";
const CHAVE = "mf-tema";
const midia = () => window.matchMedia("(prefers-color-scheme: dark)");

export const temaSalvo = (): Tema => {
  try { const t = localStorage.getItem(CHAVE); return t === "claro" || t === "escuro" ? t : "sistema"; } catch { return "sistema"; }
};

function aplicarCor(resolvido: "claro" | "escuro") {
  const cor = EMPRESA.corDestaque[resolvido];
  const raiz = document.documentElement.style;
  if (cor) { raiz.setProperty("--acento", cor); raiz.setProperty("--acento-hover", cor); }
  else { raiz.removeProperty("--acento"); raiz.removeProperty("--acento-hover"); }
}

/** Aplica o tema na página e guarda a escolha neste navegador (fallback local; o perfil no banco é a fonte principal). */
export function aplicarTema(t: Tema) {
  try { localStorage.setItem(CHAVE, t); } catch { /* sem armazenamento: vale só nesta aba */ }
  const resolvido = t === "sistema" ? (midia().matches ? "escuro" : "claro") : t;
  document.documentElement.dataset.tema = resolvido;
  aplicarCor(resolvido);
}

/** Quando o tema é "sistema", acompanha a troca do sistema operacional sem recarregar. */
export function acompanharSistema() {
  const m = midia();
  const mudou = () => { if (temaSalvo() === "sistema") aplicarTema("sistema"); };
  m.addEventListener("change", mudou);
  aplicarCor(document.documentElement.dataset.tema === "escuro" ? "escuro" : "claro");
  return () => m.removeEventListener("change", mudou);
}
