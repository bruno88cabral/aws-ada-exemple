import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("@/lib/db", () => ({ getPool: () => ({ query }) }));

import { GET, POST } from "@/app/api/itens/route";
import { GET as GET_ID } from "@/app/api/itens/[id]/route";
import { ConfigAusenteError } from "@/lib/config";

const ID = "7b0d4a4e-2c3b-4f0e-9a52-1a2b3c4d5e6f";
const linha = {
  id: ID,
  nome: "Pão francês",
  descricao: null,
  valor_cents: 150,
  foto_key: null,
  criado_em: new Date("2026-01-02T03:04:05.000Z"),
};
const itemJson = {
  id: ID,
  nome: "Pão francês",
  descricao: null,
  valorCents: 150,
  fotoKey: null,
  fotoUrl: null,
  criadoEm: "2026-01-02T03:04:05.000Z",
};

function post(corpo: unknown) {
  return new Request("http://x/api/itens", {
    method: "POST",
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as Parameters<typeof GET_ID>[1];

beforeEach(() => {
  query.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/itens", () => {
  it("201 com valorCents", async () => {
    query.mockResolvedValue({ rows: [linha] });
    const res = await POST(post({ nome: " Pão francês ", valorCents: 150 }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ item: itemJson });
    expect(query.mock.calls[0][1]).toEqual(["Pão francês", null, 150, null]);
  });

  it("converte reais em centavos no servidor", async () => {
    query.mockResolvedValue({ rows: [linha] });
    const res = await POST(post({ nome: "Bolo", descricao: "x", valor: "12,50" }));
    expect(res.status).toBe(201);
    expect(query.mock.calls[0][1]).toEqual(["Bolo", "x", 1250, null]);
  });

  it.each([
    ["nome vazio", { nome: " ", valorCents: 1 }],
    ["sem valor", { nome: "a" }],
    ["valor negativo", { nome: "a", valor: "-1" }],
    ["3 casas", { nome: "a", valor: "1,234" }],
    ["valorCents float", { nome: "a", valorCents: 1.5 }],
    ["valorCents negativo", { nome: "a", valorCents: -1 }],
    ["JSON inválido", "{oops"],
  ])("400: %s", async (_n, corpo) => {
    const res = await POST(post(corpo));
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("503 sem DATABASE_URL", async () => {
    query.mockRejectedValue(new ConfigAusenteError("DATABASE_URL"));
    const res = await POST(post({ nome: "a", valorCents: 1 }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ erro: "DATABASE_URL não configurada" });
  });

  it("500 em erro inesperado", async () => {
    query.mockRejectedValue(new Error("boom"));
    expect((await POST(post({ nome: "a", valorCents: 1 }))).status).toBe(500);
  });
});

describe("GET /api/itens", () => {
  it("200 com lista", async () => {
    query.mockResolvedValue({ rows: [linha] });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ itens: [itemJson] });
  });

  it("503 sem config", async () => {
    query.mockRejectedValue(new ConfigAusenteError("DATABASE_URL"));
    expect((await GET()).status).toBe(503);
  });
});

describe("GET /api/itens/[id]", () => {
  it("200", async () => {
    query.mockResolvedValue({ rows: [linha] });
    const res = await GET_ID(new Request("http://x"), ctx(ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ item: itemJson });
  });

  it("404 se id não é uuid (sem consultar o banco)", async () => {
    const res = await GET_ID(new Request("http://x"), ctx("abc"));
    expect(res.status).toBe(404);
    expect(query).not.toHaveBeenCalled();
  });

  it("404 se não existe", async () => {
    query.mockResolvedValue({ rows: [] });
    expect((await GET_ID(new Request("http://x"), ctx(ID))).status).toBe(404);
  });

  it("503 sem config", async () => {
    query.mockRejectedValue(new ConfigAusenteError("DATABASE_URL"));
    expect((await GET_ID(new Request("http://x"), ctx(ID))).status).toBe(503);
  });
});
