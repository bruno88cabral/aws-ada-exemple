import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { urlParaLeitura, urlParaUpload } from "@/lib/s3";

// Presigner REAL (sem mock, sem rede): confere o que de fato vai na URL.
beforeEach(() => {
  globalThis.__padariaS3 = undefined;
  vi.stubEnv("AWS_REGION", "us-east-1");
  vi.stubEnv("S3_BUCKET", "padaria-fotos-bruno");
  vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIAFAKEFAKEFAKEFAKE");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "fakefakefakefakefakefakefakefakefakefake");
});
afterEach(() => {
  vi.unstubAllEnvs();
  globalThis.__padariaS3 = undefined;
});

describe("URL assinada real", () => {
  it("PUT: sem checksum, assina content-type e content-length, expira em 300 s", async () => {
    const { uploadUrl, fotoKey } = await urlParaUpload("image/png", 4321);
    const u = new URL(uploadUrl);
    expect(u.pathname).toContain(fotoKey);
    expect(uploadUrl.toLowerCase()).not.toContain("x-amz-checksum");
    expect(uploadUrl.toLowerCase()).not.toContain("x-amz-sdk-checksum-algorithm");
    const assinados = (u.searchParams.get("X-Amz-SignedHeaders") ?? "").split(";");
    expect(assinados).toEqual(expect.arrayContaining(["content-type", "content-length", "host"]));
    expect(u.searchParams.get("X-Amz-Expires")).toBe("300");
  });

  it("GET: expira em 3600 s e não carrega checksum de corpo", async () => {
    const url = new URL(await urlParaLeitura("itens/a.png"));
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
    // x-amz-checksum-mode=ENABLED é inofensivo no GET (só pede o checksum na resposta).
    expect(url.toString().toLowerCase()).not.toContain("x-amz-checksum-crc32");
    expect(url.toString().toLowerCase()).not.toContain("x-amz-sdk-checksum-algorithm");
  });
});
