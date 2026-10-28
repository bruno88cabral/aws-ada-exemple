import { beforeEach, describe, expect, it, vi } from "vitest";

const clientQuery = vi.fn();
const release = vi.fn();
const poolQuery = vi.fn();
const falhaPool: { erro: Error | null } = { erro: null };
vi.mock("@/lib/db", () => ({
  getPool: () => {
    if (falhaPool.erro) throw falhaPool.erro;
    return { query: poolQuery, connect: async () => ({ query: clientQuery, release }) };
  },
}));

import { POST } from "@/app/api/checkout/route";
import { GET } from "@/app/api/pedidos/route";
import { ConfigAusenteError } from "@/lib/config";

const A = "7b0d4a4e-2c3b-4f0e-9a52-1a2b3c4d5e6f";
const B = "8c1e5b5f-3d4c-4a1f-8b63-2b3c4d5e6f70";
const valido = { nome: "Ana", email: "ana@ex.com", itens: [{ itemId: A, quantidade: 2 }] };

function post(corpo: unknown) {
  return new Request("http://x/api/checkout", {
    method: "POST",
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}

// Rótulo curto de cada query feita no client da transação.
function sqls() {
  return clientQuery.mock.calls.map((c) => {
    const sql = String(c[0]).trim();
    if (sql.startsWith("insert into pedido_itens")) return "INSERT_ITENS";
    if (sql.startsWith("insert into pedidos")) return "INSERT_PEDIDO";
    if (sql.startsWith("select")) return "SELECT";
    return sql;
  });
}

beforeEach(() => {
  clientQuery.mockReset();
  release.mockReset();
  poolQuery.mockReset();
  falhaPool.erro = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function precos(rows: { id: string; valor_cents: number }[]) {
  clientQuery.mockImplementation(async (sql: string) => (sql.includes("from itens") ? { rows } : { rows: [] }));
}

describe("POST /api/checkout", () => {
  it("202 com transação BEGIN/COMMIT e preço congelado vindo do banco", async () => {
    precos([{ id: A, valor_cents: 350 }]);
    const res = await POST(post({ ...valido, itens: [{ itemId: A, quantidade: 2, valorCents: 1 }] }));
    expect(res.status).toBe(202);
    const { pedidoId } = await res.json();
    expect(pedidoId).toMatch(/^[0-9a-f-]{36}$/);
    expect(sqls()).toEqual(["BEGIN", "SELECT", "INSERT_PEDIDO", "INSERT_ITENS", "COMMIT"]);
    expect(clientQuery.mock.calls[2][1]).toEqual([pedidoId, "Ana", "ana@ex.com", 700]);
    expect(clientQuery.mock.calls[3][1]).toEqual([pedidoId, A, 2, 350]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("soma quantidades de itemIds repetidos (um insert por item)", async () => {
    precos([
      { id: A, valor_cents: 100 },
      { id: B, valor_cents: 50 },
    ]);
    const res = await POST(
      post({
        ...valido,
        itens: [
          { itemId: A, quantidade: 1 },
          { itemId: B, quantidade: 1 },
          { itemId: A, quantidade: 2 },
        ],
      }),
    );
    expect(res.status).toBe(202);
    const inserts = clientQuery.mock.calls.filter((c) => String(c[0]).includes("insert into pedido_itens"));
    expect(inserts.map((c) => c[1].slice(1))).toEqual([
      [A, 3, 100],
      [B, 1, 50],
    ]);
    expect(clientQuery.mock.calls[2][1][3]).toBe(350);
  });

  it("ROLLBACK e 500 quando um insert falha; libera o client", async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("from itens")) return { rows: [{ id: A, valor_cents: 100 }] };
      if (sql.includes("insert into pedido_itens")) throw new Error("boom");
      return { rows: [] };
    });
    const res = await POST(post(valido));
    expect(res.status).toBe(500);
    expect(sqls()).toContain("ROLLBACK");
    expect(sqls()).not.toContain("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("400 com ROLLBACK para item inexistente", async () => {
    precos([]);
    const res = await POST(post(valido));
    expect(res.status).toBe(400);
    expect(sqls()).toEqual(["BEGIN", "SELECT", "ROLLBACK"]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("400 com ROLLBACK quando o total estoura o inteiro do banco", async () => {
    precos([{ id: A, valor_cents: 2_000_000_000 }]);
    const res = await POST(post({ ...valido, itens: [{ itemId: A, quantidade: 2 }] }));
    expect(res.status).toBe(400);
    expect(sqls()).toEqual(["BEGIN", "SELECT", "ROLLBACK"]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("normaliza itemId em maiúsculas e soma duplicados com caixa mista", async () => {
    precos([{ id: A, valor_cents: 100 }]);
    const res = await POST(
      post({
        ...valido,
        itens: [
          { itemId: A.toUpperCase(), quantidade: 1 },
          { itemId: A, quantidade: 2 },
        ],
      }),
    );
    expect(res.status).toBe(202);
    expect(clientQuery.mock.calls[1][1]).toEqual([[A]]);
    const inserts = clientQuery.mock.calls.filter((c) => String(c[0]).includes("insert into pedido_itens"));
    expect(inserts.map((c) => c[1].slice(1))).toEqual([[A, 3, 100]]);
  });

  it.each([
    ["carrinho vazio", { ...valido, itens: [] }],
    ["sem itens", { nome: "Ana", email: "ana@ex.com" }],
    ["e-mail inválido", { ...valido, email: "ana" }],
    ["nome vazio", { ...valido, nome: " " }],
    ["quantidade 0", { ...valido, itens: [{ itemId: A, quantidade: 0 }] }],
    ["quantidade fracionária", { ...valido, itens: [{ itemId: A, quantidade: 1.5 }] }],
    ["itemId não uuid", { ...valido, itens: [{ itemId: "x", quantidade: 1 }] }],
    ["JSON inválido", "{oops"],
  ])("400: %s (sem tocar no banco)", async (_n, corpo) => {
    const res = await POST(post(corpo));
    expect(res.status).toBe(400);
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it("503 sem DATABASE_URL", async () => {
    // getPool() real lança ConfigAusenteError; aqui o mock reproduz esse contrato.
    falhaPool.erro = new ConfigAusenteError("DATABASE_URL");
    const res = await POST(post(valido));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ erro: "DATABASE_URL não configurada" });
  });
});

describe("GET /api/pedidos", () => {
  it("lista mais recentes primeiro no formato do contrato", async () => {
    poolQuery.mockResolvedValue({
      rows: [{ id: A, cliente_nome: "Ana", status: "recebido", total_cents: 700, criado_em: new Date("2026-01-02T03:04:05.000Z") }],
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      pedidos: [{ id: A, clienteNome: "Ana", status: "recebido", totalCents: 700, criadoEm: "2026-01-02T03:04:05.000Z" }],
    });
    expect(poolQuery.mock.calls[0][0]).toMatch(/order by criado_em desc/);
  });

  it("503 sem config", async () => {
    poolQuery.mockRejectedValue(new ConfigAusenteError("DATABASE_URL"));
    expect((await GET()).status).toBe(503);
  });
});
