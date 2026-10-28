import type { SNSEvent } from "aws-lambda";
import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { lerEnv } from "@/lib/config";
import { formatarCentavos } from "@/lib/dinheiro";
import { getSes } from "@/lib/ses";
import type { PedidoConfirmado } from "@/lib/sns";

export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function montarAssunto(pedidoId: string): string {
  return `Pedido ${pedidoId} confirmado`;
}

export function montarHtml(p: PedidoConfirmado): string {
  const linhas = p.itens
    .map(
      (i) =>
        `<tr><td>${escaparHtml(i.nome)}</td><td>${i.quantidade}</td><td>${formatarCentavos(i.valorCents)}</td><td>${formatarCentavos(i.quantidade * i.valorCents)}</td></tr>`,
    )
    .join("");
  return `<html><body>
<h1>Pedido confirmado</h1>
<p>Olá, ${escaparHtml(p.nome)}! Seu pedido <strong>${escaparHtml(p.pedidoId)}</strong> foi confirmado.</p>
<table border="1" cellpadding="6" cellspacing="0">
<tr><th>Item</th><th>Qtd</th><th>Unitário</th><th>Subtotal</th></tr>${linhas}
</table>
<p><strong>Total: ${formatarCentavos(p.totalCents)}</strong></p>
</body></html>`;
}

// Erros propagam: o SNS reentrega a invocação assíncrona da Lambda.
export async function handler(event: SNSEvent): Promise<void> {
  for (const record of event.Records) {
    const pedido = JSON.parse(record.Sns.Message) as PedidoConfirmado;
    await getSes().send(
      new SendEmailCommand({
        FromEmailAddress: lerEnv("SES_FROM"),
        Destination: { ToAddresses: [pedido.email] },
        Content: {
          Simple: {
            Subject: { Data: montarAssunto(pedido.pedidoId), Charset: "UTF-8" },
            Body: { Html: { Data: montarHtml(pedido), Charset: "UTF-8" } },
          },
        },
      }),
    );
  }
}
