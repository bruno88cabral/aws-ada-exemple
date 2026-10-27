import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { lerEnv } from "@/lib/config";

declare global {
  var __padariaSns: SNSClient | undefined;
}

export type PedidoConfirmado = {
  pedidoId: string;
  nome: string;
  email: string;
  itens: { nome: string; quantidade: number; valorCents: number }[];
  totalCents: number;
};

// Client lazy (nunca no import). Credenciais: cadeia padrão do SDK (na Lambda, a role).
export function getSns(): SNSClient {
  if (!globalThis.__padariaSns) {
    globalThis.__padariaSns = new SNSClient({ region: lerEnv("AWS_REGION") });
  }
  return globalThis.__padariaSns;
}

// Publica o pedido confirmado em `pedido-confirmado` (SNS_TOPIC_ARN).
export async function publicarPedidoConfirmado(pedido: PedidoConfirmado): Promise<void> {
  const topicArn = lerEnv("SNS_TOPIC_ARN");
  await getSns().send(new PublishCommand({ TopicArn: topicArn, Message: JSON.stringify(pedido) }));
}
