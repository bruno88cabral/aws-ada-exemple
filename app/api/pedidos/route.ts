import { listarPedidos } from "@/lib/pedidos";
import { respostaDeErro } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json({ pedidos: await listarPedidos() });
  } catch (err) {
    return respostaDeErro(err);
  }
}
