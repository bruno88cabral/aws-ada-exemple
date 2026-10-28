import { respostaDeErro } from "@/lib/http";
import { uploadUrlSchema } from "@/lib/schemas";
import { urlParaUpload } from "@/lib/s3";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return Response.json({ erro: "JSON inválido" }, { status: 400 });
  }
  const r = uploadUrlSchema.safeParse(corpo);
  if (!r.success) {
    return Response.json(
      { erro: "dados inválidos", detalhes: r.error.issues.map((i) => ({ campo: i.path.join("."), mensagem: i.message })) },
      { status: 400 },
    );
  }
  try {
    return Response.json(await urlParaUpload(r.data.contentType, r.data.tamanho));
  } catch (err) {
    return respostaDeErro(err);
  }
}
