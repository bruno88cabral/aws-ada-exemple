import type { SQSEvent } from "aws-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const poolQuery = vi.fn();
const connect = vi.fn();
vi.mock("pg", () => ({ Pool: vi.fn(function () { return { query: poolQuery, connect }; }) }));

import { CaosError, handler, processarRegistro, SQL_CONFIRMAR, taxaDeCaos, type Cliente } from "./handler";

const P1 = "7b0d4a4e-2c3b-4f0e-9a52-1a2b3c4d5e6f";
const P2 = "8c1e5b5f-3d4c-4a1f-8b63-2b3c4d5e6f70";

function evento(...msgs: [string, string][]): SQSEvent {
  return {
    Records: msgs.map(([messageId, body]) => ({ messageId, body })),
  } as unknown as SQSEvent;
}

// Cliente fake: o UPDATE devolve `rowCount`; os SELECTs devolvem o pedido.
function fakeCliente(rowCount: number, falhaEm?: string) {
  const query = vi.fn(async (sql: string) => {
    if (falhaEm && sql === falhaEm) throw new Error(`falha em ${falhaEm}`);
    if (sql === SQL_CONFIRMAR) return { rowCount, rows: [] };
    if (/cliente_nome/.test(sql)) {
      return { rowCount: 1, rows: [{ nome: "Ana", email: "ana@x.com", total_cents: 1700 }] };
    }
    if (/pedido_itens pi/.test(sql)) {
      return {
        rowCount: 2,
        rows: [
          { nome: "Pao", quantidade: 2, valor_cents: 500 },
          { nome: "Bolo", quantidade: 1, valor_cents: 700 },
        ],
      };
    }
    return { rowCount: null, rows: [] };
  });
  const release = vi.fn();
  return { client: { query, release } satisfies Cliente, query, release };
}

const comandos = (q: ReturnType<typeof fakeCliente>["query"]) => q.mock.calls.map((c) => c[0]);

beforeEach(() => {
  poolQuery.mockReset();
  connect.mockReset();
  vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/padaria");
  delete (globalThis as { __padariaPool?: unknown }).__padariaPool;
  delete (globalThis as { __padariaSns?: unknown }).__padariaSns;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("processarRegistro", () => {
  it("1 linha: publica uma vez e só então faz COMMIT", async () => {
    const f = fakeCliente(1);
    const ordem: string[] = [];
    const publicar = vi.fn(async () => {
      ordem.push("publish");
    });
    const base = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql: string) => {
      if (sql === "COMMIT") ordem.push("commit");
      return base(sql);
    });
    const r = await processarRegistro(P1, { conectar: async () => f.client, publicar });
    expect(r).toEqual({ confirmado: true });
    expect(publicar).toHaveBeenCalledTimes(1);
    expect(ordem).toEqual(["publish", "commit"]);
    expect(comandos(f.query)[0]).toBe("BEGIN");
    expect(f.release).toHaveBeenCalledTimes(1);
  });

  it("payload com o formato combinado", async () => {
    const f = fakeCliente(1);
    const publicar = vi.fn().mockResolvedValue(undefined);
    await processarRegistro(P1, { conectar: async () => f.client, publicar });
    expect(publicar).toHaveBeenCalledWith({
      pedidoId: P1,
      nome: "Ana",
      email: "ana@x.com",
      itens: [
        { nome: "Pao", quantidade: 2, valorCents: 500 },
        { nome: "Bolo", quantidade: 1, valorCents: 700 },
      ],
      totalCents: 1700,
    });
  });

  it("0 linhas: não publica, COMMIT, sem erro", async () => {
    const f = fakeCliente(0);
    const publicar = vi.fn();
    const r = await processarRegistro(P1, { conectar: async () => f.client, publicar });
    expect(r).toEqual({ confirmado: false });
    expect(publicar).not.toHaveBeenCalled();
    expect(comandos(f.query)).toEqual(["BEGIN", SQL_CONFIRMAR, "COMMIT"]);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("já processado"));
    expect(f.release).toHaveBeenCalledTimes(1);
  });

  it("falha no Publish: ROLLBACK, sem COMMIT, erro propaga, client liberado", async () => {
    const f = fakeCliente(1);
    const publicar = vi.fn().mockRejectedValue(new Error("sns caiu"));
    await expect(processarRegistro(P1, { conectar: async () => f.client, publicar })).rejects.toThrow("sns caiu");
    const cmds = comandos(f.query);
    expect(cmds).toContain("ROLLBACK");
    expect(cmds).not.toContain("COMMIT");
    expect(f.release).toHaveBeenCalledTimes(1);
  });

  it("falha no UPDATE: ROLLBACK e nada publicado", async () => {
    const f = fakeCliente(1, SQL_CONFIRMAR);
    const publicar = vi.fn();
    await expect(processarRegistro(P1, { conectar: async () => f.client, publicar })).rejects.toThrow();
    expect(publicar).not.toHaveBeenCalled();
    expect(comandos(f.query)).toContain("ROLLBACK");
  });

  it("a idempotência está no WHERE status = 'recebido'", () => {
    expect(SQL_CONFIRMAR).toMatch(/where id = \$1 and status = 'recebido'/);
    expect(SQL_CONFIRMAR).toMatch(/status = 'confirmado'/);
    expect(SQL_CONFIRMAR).toMatch(/sum\(quantidade \* valor_cents\)/);
    expect(SQL_CONFIRMAR).toMatch(/confirmado_em = now\(\)/);
  });
});

describe("handler", () => {
  const snsMock = mockClient(SNSClient);

  beforeEach(() => {
    snsMock.reset();
    snsMock.on(PublishCommand).resolves({});
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("SNS_TOPIC_ARN", "arn:aws:sns:us-east-1:123:pedido-confirmado");
  });

  function clientePool(rowCount: number) {
    connect.mockImplementation(async () => fakeCliente(rowCount).client);
  }

  it("batch sem falhas publica 1 vez por pedido confirmado", async () => {
    clientePool(1);
    const r = await handler(evento(["m1", JSON.stringify({ pedidoId: P1 })], ["m2", JSON.stringify({ pedidoId: P2 })]));
    expect(r).toEqual({ batchItemFailures: [] });
    const envios = snsMock.commandCalls(PublishCommand);
    expect(envios).toHaveLength(2);
    expect(envios[0].args[0].input.TopicArn).toBe("arn:aws:sns:us-east-1:123:pedido-confirmado");
    expect(JSON.parse(envios[0].args[0].input.Message!).pedidoId).toBe(P1);
  });

  it("0 linhas não publica nem falha", async () => {
    clientePool(0);
    const r = await handler(evento(["m1", JSON.stringify({ pedidoId: P1 })]));
    expect(r.batchItemFailures).toEqual([]);
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
  });

  it("Publish falhando vira batchItemFailure (SQS reentrega)", async () => {
    clientePool(1);
    snsMock.on(PublishCommand).rejects(new Error("sns caiu"));
    const r = await handler(evento(["m1", JSON.stringify({ pedidoId: P1 })]));
    expect(r.batchItemFailures).toEqual([{ itemIdentifier: "m1" }]);
  });

  it("erro de um record não derruba os outros", async () => {
    clientePool(1);
    connect
      .mockImplementationOnce(async () => fakeCliente(1).client)
      .mockRejectedValueOnce(new Error("db caiu"));
    const r = await handler(
      evento(
        ["m1", JSON.stringify({ pedidoId: P1 })],
        ["m2", JSON.stringify({ pedidoId: P2 })],
        ["m3", JSON.stringify({ pedidoId: P1 })],
      ),
    );
    expect(r.batchItemFailures).toEqual([{ itemIdentifier: "m2" }]);
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it("corpo inválido (JSON ou sem pedidoId) falha só aquele record", async () => {
    clientePool(1);
    const r = await handler(evento(["a", "{nao-json"], ["b", "{}"], ["c", "null"], ["d", JSON.stringify({ pedidoId: P1 })]));
    expect(r.batchItemFailures).toEqual([{ itemIdentifier: "a" }, { itemIdentifier: "b" }, { itemIdentifier: "c" }]);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("sem DATABASE_URL todos os records falham (voltam para a fila)", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const r = await handler(evento(["m1", JSON.stringify({ pedidoId: P1 })]));
    expect(r.batchItemFailures).toEqual([{ itemIdentifier: "m1" }]);
  });
});

describe("caos (CHAOS_FAIL_RATE)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function deps(aleatorio: () => number) {
    const f = fakeCliente(1);
    const conectar = vi.fn(async () => f.client);
    const publicar = vi.fn(async () => {});
    return { f, conectar, publicar, d: { conectar, publicar, aleatorio } };
  }

  it("taxa 0, ausente ou vazia: nunca falha, mesmo com sorteio 0", async () => {
    for (const valor of ["0", "", "   ", undefined]) {
      vi.stubEnv("CHAOS_FAIL_RATE", valor as string);
      if (valor === undefined) delete process.env.CHAOS_FAIL_RATE;
      const x = deps(() => 0);
      await expect(processarRegistro(P1, x.d)).resolves.toEqual({ confirmado: true });
    }
  });

  it("taxa 1: sempre falha, mesmo com o maior sorteio possível", async () => {
    vi.stubEnv("CHAOS_FAIL_RATE", "1");
    const x = deps(() => 0.999999);
    await expect(processarRegistro(P1, x.d)).rejects.toBeInstanceOf(CaosError);
  });

  it("o erro acontece antes de conectar e de qualquer query", async () => {
    vi.stubEnv("CHAOS_FAIL_RATE", "1");
    const x = deps(() => 0);
    await expect(processarRegistro(P1, x.d)).rejects.toThrow(/caos/);
    expect(x.conectar).not.toHaveBeenCalled();
    expect(x.f.query).not.toHaveBeenCalled();
    expect(x.publicar).not.toHaveBeenCalled();
  });

  it("taxa 0.5: sorteio abaixo falha, igual ou acima passa", async () => {
    vi.stubEnv("CHAOS_FAIL_RATE", "0.5");
    await expect(processarRegistro(P1, deps(() => 0.49).d)).rejects.toBeInstanceOf(CaosError);
    await expect(processarRegistro(P1, deps(() => 0.5).d)).resolves.toEqual({ confirmado: true });
  });

  it("valor inválido ou fora de 0..1: avisa e usa 0", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const v of ["abc", "-0.1", "1.5", "NaN"]) {
      vi.stubEnv("CHAOS_FAIL_RATE", v);
      expect(taxaDeCaos()).toBe(0);
    }
    expect(aviso).toHaveBeenCalledTimes(4);
  });

  it("no handler, taxa 1 manda todos os records para batchItemFailures sem tocar no banco", async () => {
    vi.stubEnv("CHAOS_FAIL_RATE", "1");
    const r = await handler(evento(["m1", JSON.stringify({ pedidoId: P1 })], ["m2", JSON.stringify({ pedidoId: P2 })]));
    expect(r.batchItemFailures).toEqual([{ itemIdentifier: "m1" }, { itemIdentifier: "m2" }]);
    expect(connect).not.toHaveBeenCalled();
  });
});
