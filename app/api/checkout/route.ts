import { criarPedido, PedidoInvalidoError } from "@/lib/pedidos";
import { respostaDeErro } from "@/lib/http";
import { checkoutSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return Response.json({ erro: "JSON inválido" }, { status: 400 });
  }
  const r = checkoutSchema.safeParse(corpo);
  if (!r.success) {
    return Response.json(
      { erro: "dados inválidos", detalhes: r.error.issues.map((i) => ({ campo: i.path.join("."), mensagem: i.message })) },
      { status: 400 },
    );
  }
  try {
    const pedidoId = await criarPedido(r.data);
    // MYK-974: aqui, já com o COMMIT feito, enviar SendMessage { pedidoId }.
    return Response.json({ pedidoId }, { status: 202 });
  } catch (err) {
    if (err instanceof PedidoInvalidoError) {
      return Response.json({ erro: err.message }, { status: 400 });
    }
    return respostaDeErro(err);
  }
}
