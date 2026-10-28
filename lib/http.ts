import { ConfigAusenteError } from "@/lib/config";

// Converte um erro capturado numa rota em Response JSON.
// ConfigAusenteError -> 503 { erro: "<VAR> não configurada" }; resto -> 500.
export function respostaDeErro(err: unknown): Response {
  if (err instanceof ConfigAusenteError) {
    return Response.json({ erro: err.message }, { status: 503 });
  }
  console.error(err);
  return Response.json({ erro: "erro interno" }, { status: 500 });
}
