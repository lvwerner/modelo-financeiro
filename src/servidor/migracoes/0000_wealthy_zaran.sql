CREATE TYPE "public"."escopo_gasto" AS ENUM('empresa', 'pessoal');--> statement-breakpoint
CREATE TYPE "public"."forma_pagamento" AS ENUM('pix', 'cartao', 'dinheiro', 'prazo');--> statement-breakpoint
CREATE TYPE "public"."motivo_movimento" AS ENUM('entrada', 'venda', 'cancelamento', 'ajuste');--> statement-breakpoint
CREATE TYPE "public"."status_venda" AS ENUM('concluida', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."tipo_conta" AS ENUM('fixa', 'divida');--> statement-breakpoint
CREATE TABLE "auditoria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid,
	"acao" text NOT NULL,
	"entidade" text,
	"entidade_id" uuid,
	"dados" jsonb,
	"ip" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categorias_gasto" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"escopo" "escopo_gasto" NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categorias_produto" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clientes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"telefone" text,
	"email" text,
	"documento" text,
	"cidade" text,
	"bairro" text,
	"empresa" text,
	"observacoes" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contas_pagar" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"tipo" "tipo_conta" NOT NULL,
	"escopo" "escopo_gasto" DEFAULT 'empresa' NOT NULL,
	"categoria_id" uuid NOT NULL,
	"valor_mensal_centavos" integer,
	"valor_total_centavos" integer,
	"numero_parcelas" smallint,
	"dia_vencimento" smallint,
	"observacao" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contas_valor_ck" CHECK (("contas_pagar"."tipo" = 'fixa' and "contas_pagar"."valor_mensal_centavos" > 0) or ("contas_pagar"."tipo" = 'divida' and "contas_pagar"."valor_total_centavos" > 0)),
	CONSTRAINT "contas_dia_ck" CHECK ("contas_pagar"."dia_vencimento" is null or "contas_pagar"."dia_vencimento" between 1 and 31),
	CONSTRAINT "contas_parcelas_ck" CHECK ("contas_pagar"."numero_parcelas" is null or "contas_pagar"."numero_parcelas" between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "crediarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venda_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"valor_centavos" integer NOT NULL,
	"entrada_centavos" integer DEFAULT 0 NOT NULL,
	"numero_parcelas" smallint NOT NULL,
	"cobrar_juros" boolean DEFAULT false NOT NULL,
	"multa_percentual" numeric(5, 2) DEFAULT '0' NOT NULL,
	"juros_mes_percentual" numeric(5, 2) DEFAULT '0' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crediarios_ck" CHECK ("crediarios"."numero_parcelas" between 1 and 48 and "crediarios"."valor_centavos" > 0 and "crediarios"."entrada_centavos" >= 0),
	CONSTRAINT "crediarios_juros_ck" CHECK ("crediarios"."multa_percentual" between 0 and 20 and "crediarios"."juros_mes_percentual" between 0 and 20)
);
--> statement-breakpoint
CREATE TABLE "gastos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"escopo" "escopo_gasto" NOT NULL,
	"categoria_id" uuid NOT NULL,
	"descricao" text,
	"valor_centavos" integer NOT NULL,
	"data" date DEFAULT current_date NOT NULL,
	"forma_pagamento" "forma_pagamento",
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gastos_valor_ck" CHECK ("gastos"."valor_centavos" > 0)
);
--> statement-breakpoint
CREATE TABLE "itens_venda" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venda_id" uuid NOT NULL,
	"produto_id" uuid,
	"descricao" text NOT NULL,
	"quantidade" integer DEFAULT 1 NOT NULL,
	"preco_unitario_centavos" integer NOT NULL,
	"custo_unitario_centavos" integer,
	"total_centavos" integer NOT NULL,
	CONSTRAINT "itens_venda_ck" CHECK ("itens_venda"."quantidade" > 0 and "itens_venda"."preco_unitario_centavos" >= 0 and "itens_venda"."total_centavos" = "itens_venda"."quantidade" * "itens_venda"."preco_unitario_centavos")
);
--> statement-breakpoint
CREATE TABLE "movimentos_estoque" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"produto_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"motivo" "motivo_movimento" NOT NULL,
	"venda_id" uuid,
	"observacao" text,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movimentos_delta_ck" CHECK ("movimentos_estoque"."delta" <> 0)
);
--> statement-breakpoint
CREATE TABLE "pagamentos_conta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conta_id" uuid NOT NULL,
	"gasto_id" uuid NOT NULL,
	"valor_centavos" integer NOT NULL,
	"data" date NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pagamentos_conta_valor_ck" CHECK ("pagamentos_conta"."valor_centavos" > 0)
);
--> statement-breakpoint
CREATE TABLE "pagamentos_fiado" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crediario_id" uuid NOT NULL,
	"valor_centavos" integer NOT NULL,
	"data" date NOT NULL,
	"forma" "forma_pagamento" NOT NULL,
	"observacao" text,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pagamentos_fiado_valor_ck" CHECK ("pagamentos_fiado"."valor_centavos" > 0)
);
--> statement-breakpoint
CREATE TABLE "parcelas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crediario_id" uuid NOT NULL,
	"numero" smallint NOT NULL,
	"valor_centavos" integer NOT NULL,
	"vencimento" date NOT NULL,
	"pago_em" date,
	"valor_pago_centavos" integer,
	"forma_recebimento" "forma_pagamento",
	"observacao" text,
	CONSTRAINT "parcelas_ck" CHECK ("parcelas"."valor_centavos" > 0 and coalesce("parcelas"."valor_pago_centavos", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "produtos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"categoria_id" uuid,
	"controla_estoque" boolean DEFAULT true NOT NULL,
	"codigo" text NOT NULL,
	"nome" text NOT NULL,
	"marca" text,
	"unidade" text DEFAULT 'un' NOT NULL,
	"preco_centavos" integer,
	"custo_centavos" integer,
	"quantidade" integer DEFAULT 0 NOT NULL,
	"estoque_minimo" integer DEFAULT 0 NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "produtos_quantidade_ck" CHECK ("produtos"."quantidade" >= 0),
	CONSTRAINT "produtos_precos_ck" CHECK (coalesce("produtos"."preco_centavos", 0) >= 0 and coalesce("produtos"."custo_centavos", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"email" text NOT NULL,
	"papel" text DEFAULT 'dono' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuarios_papel_ck" CHECK ("usuarios"."papel" in ('dono', 'funcionario'))
);
--> statement-breakpoint
CREATE TABLE "vendas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid,
	"data" date DEFAULT current_date NOT NULL,
	"subtotal_centavos" integer NOT NULL,
	"desconto_centavos" integer DEFAULT 0 NOT NULL,
	"total_centavos" integer NOT NULL,
	"forma_pagamento" "forma_pagamento" NOT NULL,
	"parcelas_cartao" smallint,
	"status" "status_venda" DEFAULT 'concluida' NOT NULL,
	"cancelada_em" timestamp with time zone,
	"motivo_cancelamento" text,
	"observacoes" text,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendas_valores_ck" CHECK ("vendas"."desconto_centavos" >= 0 and "vendas"."desconto_centavos" <= "vendas"."subtotal_centavos" and "vendas"."total_centavos" = "vendas"."subtotal_centavos" - "vendas"."desconto_centavos"),
	CONSTRAINT "vendas_prazo_cliente_ck" CHECK ("vendas"."forma_pagamento" <> 'prazo' or "vendas"."cliente_id" is not null),
	CONSTRAINT "vendas_parcelas_cartao_ck" CHECK ("vendas"."parcelas_cartao" is null or "vendas"."parcelas_cartao" between 1 and 12)
);
--> statement-breakpoint
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contas_pagar" ADD CONSTRAINT "contas_pagar_categoria_id_categorias_gasto_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."categorias_gasto"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crediarios" ADD CONSTRAINT "crediarios_venda_id_vendas_id_fk" FOREIGN KEY ("venda_id") REFERENCES "public"."vendas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crediarios" ADD CONSTRAINT "crediarios_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_categoria_id_categorias_gasto_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."categorias_gasto"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itens_venda" ADD CONSTRAINT "itens_venda_venda_id_vendas_id_fk" FOREIGN KEY ("venda_id") REFERENCES "public"."vendas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itens_venda" ADD CONSTRAINT "itens_venda_produto_id_produtos_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produtos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentos_estoque" ADD CONSTRAINT "movimentos_estoque_produto_id_produtos_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produtos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentos_estoque" ADD CONSTRAINT "movimentos_estoque_venda_id_vendas_id_fk" FOREIGN KEY ("venda_id") REFERENCES "public"."vendas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentos_estoque" ADD CONSTRAINT "movimentos_estoque_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos_conta" ADD CONSTRAINT "pagamentos_conta_conta_id_contas_pagar_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."contas_pagar"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos_conta" ADD CONSTRAINT "pagamentos_conta_gasto_id_gastos_id_fk" FOREIGN KEY ("gasto_id") REFERENCES "public"."gastos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos_fiado" ADD CONSTRAINT "pagamentos_fiado_crediario_id_crediarios_id_fk" FOREIGN KEY ("crediario_id") REFERENCES "public"."crediarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos_fiado" ADD CONSTRAINT "pagamentos_fiado_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcelas" ADD CONSTRAINT "parcelas_crediario_id_crediarios_id_fk" FOREIGN KEY ("crediario_id") REFERENCES "public"."crediarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_categoria_id_categorias_produto_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."categorias_produto"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auditoria_data_idx" ON "auditoria" USING btree ("criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "categorias_nome_uq" ON "categorias_gasto" USING btree ("escopo",lower("nome"));--> statement-breakpoint
CREATE UNIQUE INDEX "categorias_produto_nome_uq" ON "categorias_produto" USING btree (lower("nome"));--> statement-breakpoint
CREATE INDEX "clientes_nome_idx" ON "clientes" USING btree (lower("nome"));--> statement-breakpoint
CREATE INDEX "clientes_telefone_idx" ON "clientes" USING btree ("telefone");--> statement-breakpoint
CREATE UNIQUE INDEX "crediarios_venda_uq" ON "crediarios" USING btree ("venda_id");--> statement-breakpoint
CREATE INDEX "crediarios_cliente_idx" ON "crediarios" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "gastos_data_idx" ON "gastos" USING btree ("escopo","data");--> statement-breakpoint
CREATE INDEX "itens_venda_venda_idx" ON "itens_venda" USING btree ("venda_id");--> statement-breakpoint
CREATE INDEX "movimentos_produto_idx" ON "movimentos_estoque" USING btree ("produto_id");--> statement-breakpoint
CREATE INDEX "pagamentos_conta_conta_idx" ON "pagamentos_conta" USING btree ("conta_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pagamentos_conta_gasto_uq" ON "pagamentos_conta" USING btree ("gasto_id");--> statement-breakpoint
CREATE INDEX "pagamentos_fiado_crediario_idx" ON "pagamentos_fiado" USING btree ("crediario_id");--> statement-breakpoint
CREATE INDEX "pagamentos_fiado_data_idx" ON "pagamentos_fiado" USING btree ("data");--> statement-breakpoint
CREATE UNIQUE INDEX "parcelas_numero_uq" ON "parcelas" USING btree ("crediario_id","numero");--> statement-breakpoint
CREATE INDEX "parcelas_vencimento_idx" ON "parcelas" USING btree ("vencimento");--> statement-breakpoint
CREATE UNIQUE INDEX "produtos_codigo_uq" ON "produtos" USING btree ("codigo");--> statement-breakpoint
CREATE UNIQUE INDEX "usuarios_email_uq" ON "usuarios" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "vendas_data_idx" ON "vendas" USING btree ("data");--> statement-breakpoint
CREATE INDEX "vendas_cliente_idx" ON "vendas" USING btree ("cliente_id");