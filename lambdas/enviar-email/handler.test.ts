import type { SNSEvent } from "aws-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handler, montarHtml } from "./handler";
import type { PedidoConfirmado } from "@/lib/sns";

const sesMock = mockClient(SESv2Client);

const pedido: PedidoConfirmado = {
  pedidoId: "7b0d4a4e-2c3b-4f0e-9a52-1a2b3c4d5e6f",
  nome: "Ana <script>",
  email: "ana@x.com",
  itens: [
    { nome: "Pão & Cia", quantidade: 2, valorCents: 500 },
    { nome: "Bolo", quantidade: 1, valorCents: 12550 },
  ],
  totalCents: 13550,
};

function evento(...msgs: string[]): SNSEvent {
  return { Records: msgs.map((Message) => ({ Sns: { Message } })) } as unknown as SNSEvent;
}

beforeEach(() => {
  sesMock.reset();
  sesMock.on(SendEmailCommand).resolves({});
  delete (globalThis as { __padariaSes?: unknown }).__padariaSes;
  vi.stubEnv("AWS_REGION", "us-east-1");
  vi.stubEnv("SES_FROM", "loja@x.com");
});

describe("montarHtml", () => {
  it("contém itens, quantidades, total em R$ e número do pedido", () => {
    const html = montarHtml(pedido);
    expect(html).toContain(pedido.pedidoId);
    expect(html).toContain("Bolo");
    expect(html).toContain("R$ 5,00");
    expect(html).toContain("R$ 10,00"); // subtotal 2 x 5,00
    expect(html).toContain("R$ 125,50");
    expect(html).toContain("Total: R$ 135,50");
  });

  it("escapa HTML em nomes de item e do cliente", () => {
    const html = montarHtml(pedido);
    expect(html).toContain("Pão &amp; Cia");
    expect(html).toContain("Ana &lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});

describe("handler enviar-email", () => {
  it("envia para o e-mail do pedido, do SES_FROM, com o número no assunto", async () => {
    await handler(evento(JSON.stringify(pedido)));
    const calls = sesMock.commandCalls(SendEmailCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;
    expect(input.FromEmailAddress).toBe("loja@x.com");
    expect(input.Destination?.ToAddresses).toEqual(["ana@x.com"]);
    expect(input.Content?.Simple?.Subject?.Data).toContain(pedido.pedidoId);
    expect(input.Content?.Simple?.Body?.Html?.Data).toContain("Total: R$ 135,50");
  });

  it("um e-mail por mensagem SNS", async () => {
    await handler(evento(JSON.stringify(pedido), JSON.stringify({ ...pedido, email: "b@x.com" })));
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(2);
  });

  it("erro do SES propaga (SNS reentrega)", async () => {
    sesMock.on(SendEmailCommand).rejects(new Error("ses caiu"));
    await expect(handler(evento(JSON.stringify(pedido)))).rejects.toThrow("ses caiu");
  });

  it("sem SES_FROM lança ConfigAusenteError e não envia", async () => {
    vi.stubEnv("SES_FROM", "");
    await expect(handler(evento(JSON.stringify(pedido)))).rejects.toThrow("SES_FROM");
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
  });
});
