import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { ConfigAusenteError, lerEnv } from "@/lib/config";

export const TIPOS_FOTO = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;
export type TipoFoto = keyof typeof TIPOS_FOTO;
export const TAMANHO_MAX_FOTO = 5 * 1024 * 1024;
export const VALIDADE_PUT_S = 5 * 60;
export const VALIDADE_GET_S = 60 * 60;

declare global {
  var __padariaS3: S3Client | undefined;
}

// Client lazy (nunca no import). Credenciais: cadeia padrão do SDK.
export function getS3(): S3Client {
  if (!globalThis.__padariaS3) {
    globalThis.__padariaS3 = new S3Client({ region: lerEnv("AWS_REGION") });
  }
  return globalThis.__padariaS3;
}

// Assina PutObject (5 min) com ContentType e ContentLength; a key é itens/<uuid>.<ext>.
// Valide contentType/tamanho antes (uploadUrlSchema).
export async function urlParaUpload(
  contentType: TipoFoto,
  tamanho: number,
): Promise<{ uploadUrl: string; fotoKey: string }> {
  const bucket = lerEnv("S3_BUCKET");
  const fotoKey = `itens/${randomUUID()}.${TIPOS_FOTO[contentType]}`;
  const uploadUrl = await getSignedUrl(
    getS3(),
    new PutObjectCommand({ Bucket: bucket, Key: fotoKey, ContentType: contentType, ContentLength: tamanho }),
    { expiresIn: VALIDADE_PUT_S },
  );
  return { uploadUrl, fotoKey };
}

// Assina GetObject (1 h).
export async function urlParaLeitura(fotoKey: string): Promise<string> {
  const bucket = lerEnv("S3_BUCKET");
  return getSignedUrl(getS3(), new GetObjectCommand({ Bucket: bucket, Key: fotoKey }), {
    expiresIn: VALIDADE_GET_S,
  });
}

// Sem S3 configurado devolve null (o catálogo funciona sem foto).
export async function urlParaLeituraOuNull(fotoKey: string): Promise<string | null> {
  try {
    return await urlParaLeitura(fotoKey);
  } catch (err) {
    if (err instanceof ConfigAusenteError) return null;
    throw err;
  }
}
