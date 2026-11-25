// Meu perfil: dados de quem está usando e a preferência de tema (salva no banco, vale em qualquer dispositivo).
import { eq } from "drizzle-orm";
import { z } from "zod";
import { usuarios } from "./schema";
import { auditar, ErroPainel, type Ctx } from "./comum";

export const esquemaEditarPerfil = z.strictObject({ tema: z.enum(["claro", "escuro", "sistema"]) });

export async function obterPerfil(ctx: Ctx) {
  const [u] = await ctx.db.select({ nome: usuarios.nome, email: usuarios.email, papel: usuarios.papel, tema: usuarios.tema }).from(usuarios).where(eq(usuarios.id, ctx.usuarioId)).limit(1);
  if (!u) throw new ErroPainel(404, "Usuário não encontrado.");
  return u;
}

export async function editarPerfil(ctx: Ctx, d: z.infer<typeof esquemaEditarPerfil>) {
  await ctx.lote([
    ctx.db.update(usuarios).set({ tema: d.tema }).where(eq(usuarios.id, ctx.usuarioId)),
    auditar(ctx, "perfil.tema", "usuario", ctx.usuarioId, d),
  ]);
  return obterPerfil(ctx);
}
