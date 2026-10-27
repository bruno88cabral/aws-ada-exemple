import { z } from "zod";
import { TAMANHO_MAX_FOTO, TIPOS_FOTO, type TipoFoto } from "@/lib/s3";
import { reaisParaCentavos, ValorInvalidoError } from "@/lib/dinheiro";

// Entrada de POST /api/itens. O valor vem em `valorCents` (inteiro) ou em
// `valor` (reais como texto, ex. "12,50"); a conversão é feita aqui, no servidor.
export const criarItemSchema = z
  .object({
    nome: z.string().trim().min(1, "nome obrigatório").max(120),
    descricao: z.string().trim().max(1000).nullish(),
    valorCents: z.number().int().min(0).max(2_147_483_647).optional(),
    valor: z.string().optional(),
    fotoKey: z.string().trim().min(1).nullish(),
  })
  .transform((d, ctx) => {
    let valorCents = d.valorCents;
    if (valorCents === undefined) {
      if (d.valor === undefined) {
        ctx.addIssue({ code: "custom", path: ["valor"], message: "valor obrigatório" });
        return z.NEVER;
      }
      try {
        valorCents = reaisParaCentavos(d.valor);
      } catch (e) {
        if (!(e instanceof ValorInvalidoError)) throw e;
        ctx.addIssue({ code: "custom", path: ["valor"], message: "valor inválido (use ex. 12,50)" });
        return z.NEVER;
      }
    }
    return {
      nome: d.nome,
      descricao: d.descricao ? d.descricao : null,
      valorCents,
      fotoKey: d.fotoKey ?? null,
    };
  });

export type NovoItem = z.output<typeof criarItemSchema>;

export const idSchema = z.uuid();

// Entrada de POST /api/upload-url.
export const uploadUrlSchema = z.object({
  contentType: z.enum(Object.keys(TIPOS_FOTO) as [TipoFoto], {
    error: "tipo não permitido (use image/jpeg, image/png ou image/webp)",
  }),
  tamanho: z
    .number("tamanho obrigatório")
    .int()
    .min(1, "arquivo vazio")
    .max(TAMANHO_MAX_FOTO, "foto acima de 5 MB"),
});
