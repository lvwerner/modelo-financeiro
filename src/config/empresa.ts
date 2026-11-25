// Tudo o que muda de um cliente para outro fica AQUI. O resto do código é o núcleo e não deve ser editado por cliente.
// Para um cliente novo: copie este arquivo, preencha e coloque o logo em public/ (ver docs/PRODUCAO.md).

export type Modulo = "resumo" | "vendas" | "receber" | "estoque" | "contas" | "gastos" | "clientes";

export const EMPRESA = {
  /** Nome que aparece no menu e na aba do navegador. */
  nome: "Sua Empresa",
  /** Linha abaixo do nome (segmento, cidade…). */
  descricao: "Gestão financeira",
  /** Caminho do logo em public/ (ex.: "/logo.svg"). Vazio = mostra as iniciais do nome. */
  logo: "",
  /**
   * Cor de destaque (botões principais, item ativo). Vazio = a cor padrão dos tokens.
   * Informe as duas versões para manter o contraste AA: texto branco sobre a clara e texto escuro sobre a do tema escuro.
   */
  corDestaque: { claro: "", escuro: "" },
  /** Módulos ativos no menu. Tirar daqui esconde a tela (a API continua protegendo por papel). */
  modulos: ["resumo", "vendas", "receber", "estoque", "contas", "gastos", "clientes"] as Modulo[],
  /** Demonstração: mostra a faixa "dados fictícios", o seletor Dono/Funcionário e "Restaurar exemplo". */
  demonstracao: true,
};

export const iniciais = (nome: string) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
