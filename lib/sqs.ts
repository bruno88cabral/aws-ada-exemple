import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { lerEnv } from "@/lib/config";

declare global {
  var __padariaSqs: SQSClient | undefined;
}

// Client lazy (nunca no import). Credenciais: cadeia padrão do SDK.
export function getSqs(): SQSClient {
  if (!globalThis.__padariaSqs) {
    globalThis.__padariaSqs = new SQSClient({ region: lerEnv("AWS_REGION") });
  }
  return globalThis.__padariaSqs;
}

// Enfileira { pedidoId } na fila `pedidos`. Chame só DEPOIS do COMMIT.
// Sem SQS_QUEUE_URL / AWS_REGION lança ConfigAusenteError (antes de qualquer chamada).
export async function enviarPedido(pedidoId: string): Promise<void> {
  const queueUrl = lerEnv("SQS_QUEUE_URL");
  await getSqs().send(
    new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify({ pedidoId }) }),
  );
}
