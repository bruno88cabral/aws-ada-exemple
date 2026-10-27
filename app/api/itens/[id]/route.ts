export const runtime = "nodejs";

export async function GET() {
  return Response.json({ erro: "não implementado" }, { status: 501 });
}
