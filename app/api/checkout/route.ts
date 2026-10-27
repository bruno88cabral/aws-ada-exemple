import { criarPedido, PedidoInvalidoError } from "@/lib/pedidos";
import { ConfigAusenteError } from "@/lib/config";
import { respostaDeErro } from "@/lib/http";
import { checkoutSchema } from "@/lib/schemas";
import { enviarPedido } from "@/lib/sqs";

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
    // O pedido já está commitado como 'recebido'. Falha ao enfileirar não pode virar
    // 5xx: o client tentaria de novo e criaria um pedido duplicado.
    try {
      await enviarPedido(pedidoId);
    } catch (err) {
      if (err instanceof ConfigAusenteError) {
        console.warn(`pedido ${pedidoId} gravado, mas não enfileirado: ${err.message}`);
      } else {
        console.error(`pedido ${pedidoId} gravado, mas falhou ao enfileirar`, err);
      }
    }
    return Response.json({ pedidoId }, { status: 202 });
  } catch (err) {
    if (err instanceof PedidoInvalidoError) {
      return Response.json({ erro: err.message }, { status: 400 });
    }
    return respostaDeErro(err);
  }
}
