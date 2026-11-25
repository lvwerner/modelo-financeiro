# Modelo Financeiro · Demonstração

Painel de gestão financeira para pequenas empresas (comércio e serviços), pronto para mostrar a clientes.
Tudo funciona de verdade: dá para lançar vendas, receber pagamentos, pagar contas e mexer no estoque — e os números do Resumo acompanham.

**Sem servidor e sem cadastro:** o banco de dados (Postgres, via [PGlite](https://pglite.dev)) roda dentro do navegador e fica salvo só no computador de quem está testando. Cada visitante começa com os mesmos dados de exemplo (6 meses de movimento fictício) e pode voltar ao início pelo botão **Restaurar exemplo**.

## O que tem

| Tela | O que faz |
|---|---|
| **Resumo** | Faturamento do período com comparação ao período anterior, ticket médio, lucro bruto e margem, caixa (o que de fato entrou), gráfico por dia/mês, formas de pagamento, resultado da empresa, gastos por categoria, contas a receber com maiores devedores e alerta de estoque baixo |
| **Vendas** | Venda com vários itens, preço sugerido pelo estoque (pode negociar na hora), desconto, Pix/cartão (com parcelas)/dinheiro/a prazo, baixa automática no estoque e cancelamento com devolução ao estoque |
| **A receber** | Crediário: parcelas com multa e juros opcionais, extrato por cliente ("comprou + / pagou −"), recebimento de qualquer valor (quita da parcela mais antiga para a mais nova) e estorno |
| **Estoque** | Produtos e serviços por categoria, código (SKU), custo e margem, estoque mínimo com alerta de reposição, entradas e ajustes com histórico |
| **Contas a pagar** | Contas fixas mensais (aluguel, energia…) e dívidas parceladas, com situação do mês, vencidas e saldo devedor. Cada pagamento vira um gasto |
| **Gastos** | Gastos da **empresa** e **pessoais** sempre separados, por categoria e período |
| **Clientes** | Cadastro, histórico de compras, saldo devedor e atalho para o WhatsApp |

Também: dois perfis de acesso (**Dono** vê tudo; **Funcionário** só vende, consulta estoque sem custo e cuida de clientes — troque no canto da tela), **Meu perfil** com tema Claro/Escuro/Seguir o sistema (salvo no banco), backup em JSON, auditoria de todas as operações, layout para celular e computador.

## Personalizar para um cliente

- **Nome, logo, cor de destaque e módulos ativos:** `src/config/empresa.ts` (único arquivo por cliente).
- **Cores e estilo:** só por tokens em `src/index.css` (tema claro e escuro, contraste AA conferido).
- **Componentes:** `src/ui.tsx` (Modal, Botão, Tabela, Etiqueta, Cartão, Toast, Esqueleto).
- **Antes de usar com dados reais:** siga [`docs/PRODUCAO.md`](docs/PRODUCAO.md) — auditoria, banco, hospedagem, segurança e checklist de entrega.

## Rodar no computador

Precisa do [Node.js](https://nodejs.org) 20 ou mais novo.

```bash
npm install
npm run dev          # abre em http://localhost:5173
```

## Publicar (Vercel)

1. Suba o repositório no GitHub.
2. Em [vercel.com/new](https://vercel.com/new), importe o repositório e clique em **Deploy** (as configurações vêm do `vercel.json`).

O build (`npm run build`) gera os dados de exemplo em `public/demo-dados.json`. Na primeira visita o navegador carrega esse arquivo e ajusta todas as datas para o dia de hoje, então a demonstração nunca fica "velha".

## Como está organizado

```
src/
  App.tsx, ui.tsx, index.css   estrutura, componentes e identidade visual
  telas/                       uma tela por arquivo (Resumo, Vendas, A receber…)
  api.ts                       a "API" do painel (aqui chama o servidor local; trocar por fetch() é mudar só este arquivo)
  servidor/
    schema.ts                  tabelas (Drizzle ORM) — dinheiro sempre em centavos
    migracoes/                 SQL gerado a partir do schema (npm run db:gerar)
    rotas.ts                   validação (Zod), permissões por perfil e roteamento
    vendas.ts, fiado.ts, …     regras de negócio, cada escrita numa transação
    banco.ts                   PGlite no navegador + carga dos dados de exemplo
    demo.ts                    gerador dos dados de exemplo
scripts/gerar-demo.ts          gera public/demo-dados.json
```

Para virar produto de um cliente: as regras de negócio (`src/servidor`) já são as mesmas de uma API real. Basta colocá-las atrás de funções serverless com um Postgres gerenciado (Neon, Supabase…), adicionar login e trocar `api.ts` por chamadas `fetch()`.

## Comandos

| comando | o que faz |
|---|---|
| `npm run dev` | ambiente de desenvolvimento |
| `npm run build` | gera os dados de exemplo e o site em `dist/` |
| `npm run preview` | confere o build em http://localhost:4173 |
| `npm run demo:gerar` | só refaz `public/demo-dados.json` |
| `npm run db:gerar` | gera a migração SQL depois de mudar `schema.ts` |

> Depois de alterar o esquema ou os dados de exemplo, aumente `VERSAO_DADOS` em `src/servidor/versao.ts` para que quem já abriu a demonstração receba o banco novo.
