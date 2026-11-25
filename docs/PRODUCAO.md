# Roteiro para transformar a base em sistema de um cliente

Este documento guarda a auditoria feita em 24/11/2026 e o passo a passo para quando um cliente fechar negócio.
A versão atual do repositório é a **demonstração** (portfólio): roda inteira no navegador, sem login e sem servidor.
Para um cliente real, siga as etapas abaixo **na ordem**.

---

## 1. Estado atual da base (o que já existe)

| Camada | Hoje (demo) | Para produção |
|---|---|---|
| Front | React 18 + Vite + Tailwind 4, navegação por `#/tela` | Mantém |
| Regras de negócio | `src/servidor/*` (Zod + Drizzle), **rodando no navegador** | Mesmo código, rodando em funções serverless |
| Banco | Postgres via PGlite, salvo no IndexedDB do navegador | Postgres gerenciado, **um banco por cliente** |
| Login | Não existe. Papel Dono/Funcionário no `localStorage` (`src/api.ts`) | Sessão em cookie httpOnly (portar do projeto Luan Pneus) |
| Deploy | Site estático (`vercel.json`) | Vercel Pro + funções `/api` |
| Personalização | `src/config/empresa.ts` (nome, logo, cor de destaque, módulos) | Mantém, um arquivo por cliente |

**Já está correto e serve para produção:**
- Atomicidade: venda + baixa de estoque + parcelas, cancelamento, recebimentos e pagamentos de contas usam uma transação só (`lote()`), e o estoque tem `CHECK (quantidade >= 0)` no banco.
- SQL injection: o Drizzle usa parâmetros e a busca escapa os curingas do `LIKE`.
- XSS: o React escapa a saída e não há `dangerouslySetInnerHTML`.
- Validação de entrada com Zod em todas as rotas (`src/servidor/rotas.ts`), com permissões por papel já declaradas (`equipe`).

**Reaproveitar do projeto Luan Pneus (`mvp-luan-pneus/server`):**
- `server/auth/*`: login com Argon2id, sessão com token aleatório (só o hash fica no banco), cookie `__Host-`, `HttpOnly`, `Secure`, `SameSite=Strict`, 8 h de duração, logout que apaga a sessão.
- Rate limit por IP e por e-mail (20 e 10 tentativas a cada 15 min) e bloqueio da conta por 15 min após 5 senhas erradas.
- `server/http.ts`: CSRF (exige `Origin` do próprio site e `Content-Type: application/json`), leitura do corpo com limite de tamanho e validação.
- `middleware.ts`: bloqueia `/admin` e `/api/admin` sem cookie válido, falhando fechado.
- `vercel.json`: headers de segurança (CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy, `no-store` no painel).

---

## 2. Auditoria (24/11/2026)

### 2.1 Fluxo de dados
Formulário → `src/api.ts` → `rotear()` em `src/servidor/rotas.ts` (Zod + papel) → serviço → banco.
Na demo isso acontece no navegador: o front fala direto com o banco e dá para passar por cima de tudo pelo console.

| Entidade | Cria | Lê | Edita | Exclui | Validação |
|---|---|---|---|---|---|
| Vendas | Dono, Funcionário | Dono (funcionário só as de hoje) | Cancelar: só Dono | Não exclui, cancela | Zod + regras + `CHECK` |
| A prazo / parcelas | Dono, Funcionário | Dono (funcionário pela ficha do cliente) | Receber: ambos | Estorno: Dono | Zod + regras |
| Produtos / estoque | Dono, Funcionário (sem custo) | Ambos (custo só Dono) | Ambos | Não exclui, desativa | Zod + `CHECK` |
| Clientes | Ambos | Ambos, dados completos | Ambos | Não é possível | Zod |
| Contas, gastos, resumo, backup | Dono | Dono | Dono | Gasto: Dono | Zod |
| Usuários | Só dados de exemplo | — | — | — | Não há gestão |

Respostas maiores que o necessário: lista de produtos devolve todas as colunas; "A receber" devolve o histórico completo de todos (85 KB na demo); ficha do cliente devolve CPF, e-mail e telefone completos também ao funcionário.

### 2.2 Problemas encontrados

**CRÍTICO**
1. **Sem login, papel no `localStorage`** (`src/api.ts`). Risco: com dados reais, qualquer pessoa vê e altera tudo. Correção: backend com sessão em cookie (etapa A).
2. **Regras e banco rodando no navegador.** Risco: validação e permissões podem ser ignoradas pelo console. Correção: mover `src/servidor` para funções serverless; o front só chama `fetch()`.
3. **Dados só no IndexedDB, sem backup.** Risco: limpar o navegador apaga a empresa. Correção: Postgres gerenciado com backup automático.

**ALTO**
4. **Auditoria manual e incompleta** (`auditar()` em cada serviço): sem antes/depois na maioria, sem nome do usuário, sem LOGIN/LOGOUT, apagável. Correção: `audit_log` por trigger, somente-leitura (etapa B).
5. **Funcionário vê CPF e telefone completos.** Correção: mascarar no servidor por papel (`***.456.789-**`, `(11) *****-4501`).
6. **Recebimento sem trava de concorrência** (`receberFiado`, `receberFiadoCliente` em `src/servidor/fiado.ts`; `pagarConta` em `contas.ts`): lê o saldo e depois grava; dois cliques simultâneos podem receber além do devido. Correção: `SELECT … FOR UPDATE` do crediário/conta dentro da transação, ou conferir o saldo no próprio `INSERT`.
7. **LGPD:** não há exclusão/anonimização nem exportação dos dados de um cliente. Correção: rota "Anonimizar cliente" (mantém as vendas, apaga nome/telefone/CPF/e-mail) e "Exportar dados do cliente" (JSON).
8. **Backup sem restauração:** só há o download manual de JSON e nenhuma importação. Correção: backup automático do provedor + roteiro de restauração testado (seção 5).

**MÉDIO**
9. **Listas sem paginação**, com limites fixos (vendas 500, crediários 500, parcelas 1000, gastos 1000, clientes 300, produtos 500).
10. **Bug:** em "A receber" o filtro de situação é aplicado depois do `limit(500)` (`listarCrediarios` em `fiado.ts`). Com mais de 500 vendas a prazo, clientes devendo somem. Correção: filtrar no SQL e paginar.
11. **Busca sem índice:** `ilike '%termo%'` em clientes e produtos faz varredura completa. Correção: `pg_trgm` + índices GIN.
12. **Respostas grandes:** "A receber" e vendas de 6 meses (140 KB). Correção: paginação + histórico só no detalhe.
13. **Headers de segurança ausentes** no `vercel.json` da demo. Correção: copiar os do Luan (seção 1).

**BAIXO**
14. 4 vulnerabilidades moderadas só em desenvolvimento (`esbuild` antigo dentro do `drizzle-kit`). Afeta só o servidor de dev.
15. Migração com nome aleatório (`0000_wealthy_zaran.sql`) e nomes internos ainda "fiado".

**Segredos:** nenhum no código, no histórico do git nem no bundle. `.env*` está no `.gitignore`.

### 2.3 Desempenho medido (demo, banco local, mediana de 5)

| Operação | Tempo |
|---|---|
| Resumo 30 dias / 6 meses | 39 / 49 ms |
| Vendas do mês / 6 meses | 6 / 26 ms (resposta 140 KB) |
| A receber | 28 ms (85 KB) |
| Clientes / Estoque | 7 / 5 ms |
| Gravar nova venda | 11 ms |
| Primeira visita (só demo) | ~5,5 MB comprimidos (PGlite 3,3 MB + dados 1,9 MB + JS 250 KB + exemplo 88 KB) |

Sem N+1: "A receber" busca parcelas e pagamentos em 2 consultas agrupadas. Em produção o banco fica na rede: medir de novo antes e depois de cada etapa.

---

## 3. Banco de dados

- **Um banco (projeto) por cliente.** Isolamento total: um vazamento ou erro de um cliente não atinge outro, e cada um pode ser exportado ou apagado inteiro.
- **Dois usuários no banco:** `app` (só `SELECT/INSERT/UPDATE/DELETE` nas tabelas de negócio) para as funções e `migracao` (dono do schema) só para rodar migrações. A `DATABASE_URL` da Vercel usa o `app`.
- **Auditoria somente-leitura:** `REVOKE UPDATE, DELETE ON audit_log FROM app;` + trigger que grava. Como todo acesso passa pela API, isso substitui o RLS com mais simplicidade. (Se um dia o front falar direto com o banco, como no Supabase, aí o RLS vira obrigatório em todas as tabelas.)
- **Índices a criar:**
  ```sql
  create extension if not exists pg_trgm;
  create index clientes_nome_trgm on clientes using gin (nome gin_trgm_ops);
  create index clientes_telefone_trgm on clientes using gin (telefone gin_trgm_ops);
  create index produtos_nome_trgm on produtos using gin (nome gin_trgm_ops);
  create index vendas_cliente_data_idx on vendas (cliente_id, data desc);
  create index parcelas_abertas_idx on parcelas (vencimento) where pago_em is null;
  create index audit_log_data_idx on audit_log (data_hora desc);
  create index audit_log_entidade_idx on audit_log (entidade, entidade_id, data_hora desc);
  create index audit_log_usuario_idx on audit_log (usuario_id, data_hora desc);
  ```
- **Volume:** uma loja com ~50 vendas/dia gera uns 30–60 MB por ano, já com auditoria. O limite grátis do Neon (0,5 GB por projeto) dura uns 5 anos por cliente.
- **Pausa por inatividade:** Neon grátis desliga após ~5 min sem uso (a primeira consulta depois leva ~1 s). Supabase grátis pausa após 7 dias sem uso e não tem backup. **Confirmar os limites atuais nos painéis**, eles mudam.
- **Conexões:** o driver HTTP do Neon (`@neondatabase/serverless`) não esgota conexões em serverless.

---

## 4. Hospedagem (3 a 5 clientes, cada um com sua instância)

Valores aproximados em US$/mês, conferir antes de fechar.

| | Gerenciado (recomendado) | VPS própria |
|---|---|---|
| Stack | Vercel Pro + Neon (um projeto por cliente) | Hetzner/DigitalOcean + Coolify/Docker + Postgres |
| Custo | Vercel ~US$20 (um assento serve todos os projetos) + Neon de grátis a ~US$20 por cliente → **~US$20–120** | **~US$10–20** no total |
| Você administra | Só o app e as variáveis de ambiente | Sistema operacional, firewall, TLS, atualizações do Postgres, monitoramento, backups e testes de restauração |
| Isolamento | Projeto e banco separados por cliente | Mesma máquina, bancos separados; ponto único de falha |
| Backup | Automático, restauração pelo painel | Você monta (`pg_dump` diário + armazenamento externo) |

- **Atenção:** o plano Hobby (grátis) da Vercel **proíbe uso comercial**. Cliente pagando exige o Pro.
- **Recomendação:** gerenciado. Nessa escala, o tempo gasto cuidando de uma VPS custa mais que a diferença de preço. Reavaliar acima de ~10 clientes.

---

## 5. Checklist para um cliente novo

**Etapa A — Backend e segurança (obrigatória antes de qualquer dado real)**
- [ ] Criar o repositório do cliente a partir desta base (fork/template) e preencher `src/config/empresa.ts` (nome, logo, cor, módulos).
- [ ] Mover `src/servidor` para funções serverless (`api/[recurso].ts`), trocando `chamar()` em `src/api.ts` por `fetch()`. Manter um modo `demo` por variável de build.
- [ ] Portar login/sessão/rate limit/CSRF/middleware do Luan; tabela `usuarios` com `senha_hash`, `papel`, `tema`; tabela `sessoes`; script `admin:criar`.
- [ ] Mascarar CPF/telefone/e-mail para Funcionário no servidor; remover campos desnecessários das respostas.
- [ ] Trava de concorrência em recebimentos e pagamentos de dívidas.
- [ ] Paginação no servidor (vendas, a receber, gastos, clientes, produtos) e corrigir o filtro de "A receber".
- [ ] Headers de segurança no `vercel.json`; fontes já são locais (sem domínios externos na CSP).
- [ ] Testar como Funcionário: trocar URL, IDs e chamar a API direto (IDOR) em todas as rotas de Dono.

**Etapa B — Auditoria**
- [ ] Tabela `audit_log` (id, usuario_id, usuario_nome, acao CRIAR/EDITAR/EXCLUIR/LOGIN/LOGOUT, entidade, entidade_id, dados_antes, dados_depois, ip, data_hora).
- [ ] Trigger genérico `AFTER INSERT/UPDATE/DELETE` nas tabelas de negócio, lendo usuário e IP de `set_config('app.usuario_id', …, true)` feito no início de cada transação.
- [ ] `REVOKE UPDATE, DELETE` no `audit_log` para o usuário `app`.
- [ ] Tela "Histórico de alterações" (só Dono), paginada, com filtros e diff campo a campo.
- [ ] "Última alteração por Fulano em dd/mm/aaaa hh:mm" em venda, produto e cliente, com link para o histórico do item.

**Etapa C — Banco e hospedagem**
- [ ] Projeto Neon do cliente (região São Paulo, `sa-east-1`), usuários `app` e `migracao`, índices da seção 3.
- [ ] Projeto Vercel (Pro) com `DATABASE_URL`, `SESSION_SECRET` (32+ bytes aleatórios) — nunca no git.
- [ ] Domínio do cliente + HTTPS.
- [ ] Backup: confirmar a retenção do plano, agendar exportação semanal (`pg_dump`) para armazenamento externo e **fazer um teste de restauração** num projeto separado antes de entregar.

**Etapa D — LGPD e entrega**
- [ ] Anonimizar e exportar dados de um cliente final; política de privacidade com o que é guardado e por quê.
- [ ] Remover os dados de exemplo; criar os usuários reais.
- [ ] Medir as telas principais (Resumo, Vendas, Nova venda) e registrar os números.

---

## 6. O que fica por conta de configuração manual (fora do código)
- Criar contas/projetos na Vercel e no Neon, cadastrar variáveis de ambiente, apontar o domínio.
- Confirmar limites e preços atuais dos planos.
- Ativar alertas de uso e de erro (Vercel) e de armazenamento (Neon).
- Guardar as credenciais de administrador do cliente num gerenciador de senhas.
