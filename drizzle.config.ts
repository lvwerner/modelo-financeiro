// Gera o SQL das tabelas a partir de src/servidor/schema.ts (npm run db:gerar). Não precisa de banco.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/servidor/schema.ts",
  out: "./src/servidor/migracoes",
  dialect: "postgresql",
  strict: true,
});
