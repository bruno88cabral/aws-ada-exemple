import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { getPool } from "@/lib/db";
import { publicarPedidoConfirmado, type PedidoConfirmado } from "@/lib/sns";

export type Resultado = { confirmado: boolean };

// Cliente de transação (subconjunto de pg.PoolClient), injetável nos testes.
export type Cliente = {
  query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: Record<string, unknown>[] }>;
  release: () => void;
};

export type Deps = {
  conectar: () => Promise<Cliente>;
  publicar: (pedido: PedidoConfirmado) => Promise<void>;
};

// Idempotente: o WHERE status='recebido' só deixa a primeira entrega confirmar.
export const SQL_CONFIRMAR = `update pedidos
   set status = 'confirmado',
       total_cents = (select coalesce(sum(quantidade * valor_cents), 0) from pedido_itens where pedido_id = $1),
       confirmado_em = now()
 where id = $1 and status = 'recebido'`;

export const SQL_CLIENTE = `select cliente_nome as nome, cliente_email as email, total_cents from pedidos where id = $1`;

export const SQL_ITENS = `select i.nome, pi.quantidade, pi.valor_cents
  from pedido_itens pi join itens i on i.id = pi.item_id
 where pi.pedido_id = $1
 order by i.nome`;

// MYK-976 insere o chaos check aqui, no início desta função.
export async function processarRegistro(pedidoId: string, deps: Deps): Promise<Resultado> {
  const client = await deps.conectar();
  try {
    await client.query("BEGIN");
    const r = await client.query(SQL_CONFIRMAR, [pedidoId]);
    if (r.rowCount === 0) {
      await client.query("COMMIT");
      console.log(`pedido ${pedidoId} já processado`);
      return { confirmado: false };
    }
    const cli = (await client.query(SQL_CLIENTE, [pedidoId])).rows[0];
    const itens = (await client.query(SQL_ITENS, [pedidoId])).rows;
    // Publica ANTES do COMMIT: se o Publish falhar, o ROLLBACK deixa o pedido
    // 'recebido' e o SQS reentrega (nenhum e-mail se perde). Se o COMMIT falhar
    // depois de um Publish bem-sucedido, a retentativa publica de novo: no raro
    // pior caso o cliente recebe o e-mail duplicado (preferível a nunca receber).
    await deps.publicar({
      pedidoId,
      nome: String(cli.nome),
      email: String(cli.email),
      itens: itens.map((i) => ({
        nome: String(i.nome),
        quantidade: Number(i.quantidade),
        valorCents: Number(i.valor_cents),
      })),
      totalCents: Number(cli.total_cents),
    });
    await client.query("COMMIT");
    return { confirmado: true };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (e) {
      console.error("falha no ROLLBACK", e);
    }
    throw err;
  } finally {
    client.release();
  }
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
      await processarRegistro(pedidoId, { conectar: () => getPool().connect(), publicar: publicarPedidoConfirmado });
    } catch (err) {
      console.error(`falha no record ${record.messageId}`, err);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
