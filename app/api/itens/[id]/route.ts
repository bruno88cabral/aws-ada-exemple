import { buscarItem } from "@/lib/itens";
import { respostaDeErro } from "@/lib/http";
import { idSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: RouteContext<"/api/itens/[id]">) {
  const { id } = await ctx.params;
  if (!idSchema.safeParse(id).success) {
    return Response.json({ erro: "item não encontrado" }, { status: 404 });
  }
  try {
    const item = await buscarItem(id);
    if (!item) return Response.json({ erro: "item não encontrado" }, { status: 404 });
    return Response.json({ item });
  } catch (err) {
    return respostaDeErro(err);
  }
}
