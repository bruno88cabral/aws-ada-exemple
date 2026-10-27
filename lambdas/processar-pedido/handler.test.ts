import type { SQSEvent } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("pg", () => ({ Pool: vi.fn(function () { return { query }; }) }));

import { handler, processarRegistro, SQL_CONFIRMAR } from "./handler";

const P1 = "7b0d4a4e-2c3b-4f0e-9a52-1a2b3c4d5e6f";
const P2 = "8c1e5b5f-3d4c-4a1f-8b63-2b3c4d5e6f70";

function evento(...msgs: [string, string][]): SQSEvent {
  return {
    Records: msgs.map(([messageId, body]) => ({ messageId, body })),
  } as unknown as SQSEvent;
}

beforeEach(() => {
  query.mockReset();
  vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/padaria");
  delete (globalThis as { __padariaPool?: unknown }).__padariaPool;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("processarRegistro", () => {
  it("1 linha afetada confirma", async () => {
    const q = vi.fn().mockResolvedValue({ rowCount: 1 });
    expect(await processarRegistro(P1, { query: q })).toEqual({ confirmado: true });
    expect(q).toHaveBeenCalledWith(SQL_CONFIRMAR, [P1]);
  });

  it("0 linhas: já processado, sem erro", async () => {
    const q = vi.fn().mockResolvedValue({ rowCount: 0 });
    expect(await processarRegistro(P1, { query: q })).toEqual({ confirmado: false });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("já processado"));
  });

  it("a idempotência está no WHERE status = 'recebido'", () => {
    expect(SQL_CONFIRMAR).toMatch(/where id = \$1 and status = 'recebido'/);
    expect(SQL_CONFIRMAR).toMatch(/status = 'confirmado'/);
    expect(SQL_CONFIRMAR).toMatch(/sum\(quantidade \* valor_cents\)/);
    expect(SQL_CONFIRMAR).toMatch(/confirmado_em = now\(\)/);
  });
});

describe("handler", () => {
  it("batch sem falhas", async () => {
    query.mockResolvedValue({ rowCount: 1 });
    const r = await handler(evento(["m1", JSON.stringify({ pedidoId: P1 })], ["m2", JSON.stringify({ pedidoId: P2 })]));
    expect(r).toEqual({ batchItemFailures: [] });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("0 linhas não falha", async () => {
    query.mockResolvedValue({ rowCount: 0 });
    const r = await handler(evento(["m1", JSON.stringify({ pedidoId: P1 })]));
    expect(r.batchItemFailures).toEqual([]);
  });

  it("erro de um record vai para batchItemFailures sem derrubar os outros", async () => {
    query.mockResolvedValueOnce({ rowCount: 1 }).mockRejectedValueOnce(new Error("db caiu")).mockResolvedValueOnce({ rowCount: 1 });
    const r = await handler(
      evento(
        ["m1", JSON.stringify({ pedidoId: P1 })],
        ["m2", JSON.stringify({ pedidoId: P2 })],
        ["m3", JSON.stringify({ pedidoId: P1 })],
      ),
    );
    expect(r.batchItemFailures).toEqual([{ itemIdentifier: "m2" }]);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("corpo inválido (JSON ou sem pedidoId) falha só aquele record", async () => {
    query.mockResolvedValue({ rowCount: 1 });
    const r = await handler(evento(["a", "{nao-json"], ["b", "{}"], ["c", "null"], ["d", JSON.stringify({ pedidoId: P1 })]));
    expect(r.batchItemFailures).toEqual([{ itemIdentifier: "a" }, { itemIdentifier: "b" }, { itemIdentifier: "c" }]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("sem DATABASE_URL todos os records falham (voltam para a fila)", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const r = await handler(evento(["m1", JSON.stringify({ pedidoId: P1 })]));
    expect(r.batchItemFailures).toEqual([{ itemIdentifier: "m1" }]);
  });
});
