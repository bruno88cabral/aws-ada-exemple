import { criarItem, listarItens } from "@/lib/itens";
import { respostaDeErro } from "@/lib/http";
import { criarItemSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json({ itens: await listarItens() });
  } catch (err) {
    return respostaDeErro(err);
  }
}

export async function POST(req: Request) {
  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return Response.json({ erro: "JSON inválido" }, { status: 400 });
  }
  const r = criarItemSchema.safeParse(corpo);
  if (!r.success) {
    return Response.json(
      { erro: "dados inválidos", detalhes: r.error.issues.map((i) => ({ campo: i.path.join("."), mensagem: i.message })) },
      { status: 400 },
    );
  }
  try {
    return Response.json({ item: await criarItem(r.data) }, { status: 201 });
  } catch (err) {
    return respostaDeErro(err);
  }
}
