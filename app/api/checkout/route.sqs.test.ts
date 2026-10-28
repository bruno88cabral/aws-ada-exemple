import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ordem: string[] = [];
const criarPedido = vi.fn();
vi.mock("@/lib/pedidos", async (orig) => ({
  ...(await orig<typeof import("@/lib/pedidos")>()),
  criarPedido: (...a: unknown[]) => criarPedido(...a),
}));

import { POST } from "./route";
import { PedidoInvalidoError } from "@/lib/pedidos";

const sqs = mockClient(SQSClient);
const ID = "7b0d4a4e-2c3b-4f0e-9a52-1a2b3c4d5e6f";
const valido = { nome: "Ana", email: "ana@ex.com", itens: [{ itemId: ID, quantidade: 1 }] };
const req = () => new Request("http://x/api/checkout", { method: "POST", body: JSON.stringify(valido) });

beforeEach(() => {
  ordem.length = 0;
  sqs.reset();
  delete (globalThis as { __padariaSqs?: unknown }).__padariaSqs;
  vi.stubEnv("AWS_REGION", "us-east-1");
  vi.stubEnv("SQS_QUEUE_URL", "https://sqs.us-east-1.amazonaws.com/123/pedidos");
  criarPedido.mockImplementation(async () => {
    ordem.push("commit");
    return ID;
  });
  sqs.on(SendMessageCommand).callsFake(async () => {
    ordem.push("send");
    return {};
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/checkout - SQS", () => {
  it("envia { pedidoId } só depois do COMMIT e responde 202", async () => {
    const res = await POST(req());
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ pedidoId: ID });
    expect(ordem).toEqual(["commit", "send"]);
    const [chamada] = sqs.commandCalls(SendMessageCommand);
    expect(chamada.args[0].input).toEqual({
      QueueUrl: "https://sqs.us-east-1.amazonaws.com/123/pedidos",
      MessageBody: JSON.stringify({ pedidoId: ID }),
    });
  });

  it("sem SQS_QUEUE_URL: não envia, avisa e responde 202", async () => {
    vi.stubEnv("SQS_QUEUE_URL", "");
    const res = await POST(req());
    expect(res.status).toBe(202);
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("SQS_QUEUE_URL não configurada"));
  });

  it("falha do SQS depois do COMMIT: loga o erro e ainda responde 202", async () => {
    sqs.on(SendMessageCommand).rejects(new Error("sqs fora"));
    const res = await POST(req());
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ pedidoId: ID });
    expect(console.error).toHaveBeenCalled();
  });

  it("pedido inválido: 400 e nada é enviado", async () => {
    criarPedido.mockRejectedValue(new PedidoInvalidoError("item inexistente"));
    const res = await POST(req());
    expect(res.status).toBe(400);
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
  });
});
