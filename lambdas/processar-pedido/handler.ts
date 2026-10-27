import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { getPool } from "@/lib/db";

export type Deps = {
  query: (sql: string, params: unknown[]) => Promise<{ rowCount: number | null }>;
};

export type Resultado = { confirmado: boolean };

// Idempotente: o WHERE status='recebido' só deixa a primeira entrega confirmar.
export const SQL_CONFIRMAR = `update pedidos
   set status = 'confirmado',
       total_cents = (select coalesce(sum(quantidade * valor_cents), 0) from pedido_itens where pedido_id = $1),
       confirmado_em = now()
 where id = $1 and status = 'recebido'`;

// MYK-975 estende este ponto: com confirmado === true, publica no SNS.
export async function processarRegistro(pedidoId: string, deps: Deps): Promise<Resultado> {
  const r = await deps.query(SQL_CONFIRMAR, [pedidoId]);
  if (r.rowCount === 0) {
    console.log(`pedido ${pedidoId} já processado`);
    return { confirmado: false };
  }
  return { confirmado: true };
}

function extrairPedidoId(body: string): string {
  const dados: unknown = JSON.parse(body);
  const id = (dados as { pedidoId?: unknown } | null)?.pedidoId;
  if (typeof id !== "string" || id === "") throw new Error("mensagem sem pedidoId");
  return id;
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchItemFailure[] = [];
  for (const record of event.Records) {
    try {
      const pedidoId = extrairPedidoId(record.body);
      await processarRegistro(pedidoId, { query: (sql, params) => getPool().query(sql, params) });
    } catch (err) {
      console.error(`falha no record ${record.messageId}`, err);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
