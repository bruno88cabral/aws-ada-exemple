import { mockClient } from "aws-sdk-client-mock";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { publicarPedidoConfirmado } from "./sns";

const snsMock = mockClient(SNSClient);

beforeEach(() => {
  snsMock.reset();
  snsMock.on(PublishCommand).resolves({});
  delete (globalThis as { __padariaSns?: unknown }).__padariaSns;
  vi.stubEnv("AWS_REGION", "us-east-1");
  vi.stubEnv("SNS_TOPIC_ARN", "arn:aws:sns:us-east-1:123:pedido-confirmado");
});

const pedido = { pedidoId: "p", nome: "A", email: "a@x.com", itens: [], totalCents: 0 };

describe("publicarPedidoConfirmado", () => {
  it("publica o JSON no tópico", async () => {
    await publicarPedidoConfirmado(pedido);
    const [c] = snsMock.commandCalls(PublishCommand);
    expect(c.args[0].input.TopicArn).toBe("arn:aws:sns:us-east-1:123:pedido-confirmado");
    expect(JSON.parse(c.args[0].input.Message!)).toEqual(pedido);
  });

  it("sem SNS_TOPIC_ARN lança ConfigAusenteError e não chama a AWS", async () => {
    vi.stubEnv("SNS_TOPIC_ARN", "");
    await expect(publicarPedidoConfirmado(pedido)).rejects.toThrow("SNS_TOPIC_ARN");
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
  });
});
