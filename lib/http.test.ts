import { describe, expect, it, vi } from "vitest";
import { ConfigAusenteError } from "@/lib/config";
import { respostaDeErro } from "@/lib/http";

describe("respostaDeErro", () => {
  it("ConfigAusenteError vira 503 com mensagem clara", async () => {
    const res = respostaDeErro(new ConfigAusenteError("DATABASE_URL"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ erro: "DATABASE_URL não configurada" });
  });

  it("outros erros viram 500 genérico", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = respostaDeErro(new Error("boom"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ erro: "erro interno" });
    spy.mockRestore();
  });
});
