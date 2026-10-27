import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";

const getSignedUrl = vi.fn();
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: (...a: unknown[]) => getSignedUrl(...a) }));

import { POST } from "@/app/api/upload-url/route";
import { urlDaFoto } from "@/lib/itens";
import { urlParaLeitura, urlParaUpload } from "@/lib/s3";

const s3Mock = mockClient(S3Client);

function post(corpo: unknown, bruto?: string) {
  return new Request("http://x/api/upload-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: bruto ?? JSON.stringify(corpo),
  });
}

beforeEach(() => {
  s3Mock.reset();
  getSignedUrl.mockReset().mockResolvedValue("https://s3.example/assinada");
  globalThis.__padariaS3 = undefined;
  vi.stubEnv("AWS_REGION", "us-east-1");
  vi.stubEnv("S3_BUCKET", "padaria-fotos-bruno");
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/upload-url", () => {
  it("assina PutObject por 5 min e devolve uploadUrl + fotoKey itens/<uuid>.<ext>", async () => {
    const res = await POST(post({ contentType: "image/png", tamanho: 1234 }));
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.uploadUrl).toBe("https://s3.example/assinada");
    expect(corpo.fotoKey).toMatch(/^itens\/[0-9a-f-]{36}\.png$/);

    const [, cmd, opts] = getSignedUrl.mock.calls[0];
    expect(cmd).toBeInstanceOf(PutObjectCommand);
    expect(cmd.input).toEqual({
      Bucket: "padaria-fotos-bruno",
      Key: corpo.fotoKey,
      ContentType: "image/png",
      ContentLength: 1234,
    });
    expect(opts).toEqual({ expiresIn: 300 });
  });

  it.each([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
  ])("extensão de %s é .%s", async (contentType, ext) => {
    const { fotoKey } = await urlParaUpload(contentType as "image/jpeg", 10);
    expect(fotoKey).toMatch(new RegExp(`^itens/[0-9a-f-]{36}\\.${ext}$`));
  });

  it("rejeita tipo não permitido (400) sem assinar", async () => {
    const res = await POST(post({ contentType: "image/gif", tamanho: 10 }));
    expect(res.status).toBe(400);
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it("rejeita acima de 5 MB, vazio e tamanho ausente; aceita exatamente 5 MB", async () => {
    expect((await POST(post({ contentType: "image/png", tamanho: 5 * 1024 * 1024 + 1 }))).status).toBe(400);
    expect((await POST(post({ contentType: "image/png", tamanho: 0 }))).status).toBe(400);
    expect((await POST(post({ contentType: "image/png" }))).status).toBe(400);
    expect((await POST(post({ contentType: "image/png", tamanho: 5 * 1024 * 1024 }))).status).toBe(200);
  });

  it("JSON inválido -> 400", async () => {
    expect((await POST(post(null, "{"))).status).toBe(400);
  });

  it("503 sem S3_BUCKET", async () => {
    vi.stubEnv("S3_BUCKET", "");
    const res = await POST(post({ contentType: "image/png", tamanho: 10 }));
    expect(res.status).toBe(503);
    expect((await res.json()).erro).toBe("S3_BUCKET não configurada");
  });

  it("503 sem AWS_REGION", async () => {
    vi.stubEnv("AWS_REGION", "");
    const res = await POST(post({ contentType: "image/png", tamanho: 10 }));
    expect(res.status).toBe(503);
    expect((await res.json()).erro).toBe("AWS_REGION não configurada");
  });
});

describe("leitura", () => {
  it("assina GetObject por 1 h", async () => {
    expect(await urlParaLeitura("itens/a.png")).toBe("https://s3.example/assinada");
    const [, cmd, opts] = getSignedUrl.mock.calls[0];
    expect(cmd).toBeInstanceOf(GetObjectCommand);
    expect(cmd.input).toEqual({ Bucket: "padaria-fotos-bruno", Key: "itens/a.png" });
    expect(opts).toEqual({ expiresIn: 3600 });
  });

  it("urlDaFoto: null sem fotoKey", async () => {
    expect(await urlDaFoto(null)).toBeNull();
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it("urlDaFoto: URL assinada com fotoKey", async () => {
    expect(await urlDaFoto("itens/a.png")).toBe("https://s3.example/assinada");
  });

  it("urlDaFoto: null (não lança) sem S3 configurado", async () => {
    vi.stubEnv("S3_BUCKET", "");
    expect(await urlDaFoto("itens/a.png")).toBeNull();
  });

  it("urlDaFoto: propaga erro que não é de config", async () => {
    getSignedUrl.mockRejectedValue(new Error("boom"));
    await expect(urlDaFoto("itens/a.png")).rejects.toThrow("boom");
  });
});
