# Modelo financeiro (base para clientes)

- Este repositório é a **demonstração** (portfólio) e a base que será personalizada para cada cliente.
- Antes de transformar em sistema de um cliente, siga `docs/PRODUCAO.md` (auditoria, banco, hospedagem, segurança, checklist).
- Personalização por cliente: `src/config/empresa.ts` (nome, logo, cor de destaque, módulos). Não espalhar dados do cliente pelo código.
- Visual: estilo ERP sóbrio. Cores só por tokens em `src/index.css` (claro e escuro); nada de cor solta, gradiente, blur, emoji ou sombra grande. Ícones só do `lucide-react`.
- Componentes de UI ficam em `src/ui.tsx` (Modal, Botão, Tabela, Etiqueta, Cartão, Toast, Skeleton).
- Dinheiro sempre em centavos (integer). Toda escrita passa por `rotas.ts` (Zod + papel) e roda em transação (`lote()`).
- Depois de mudar esquema ou dados de exemplo: `npm run db:gerar`, aumentar `VERSAO_DADOS` em `src/servidor/versao.ts` e `npm run demo:gerar`.
- Não fazer commit nem deploy sem autorização do dono.
