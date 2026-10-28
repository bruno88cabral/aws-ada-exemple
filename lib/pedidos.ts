import { randomUUID } from "node:crypto";
import { getPool } from "@/lib/db";
import type { NovoPedido } from "@/lib/schemas";

const INT4_MAX = 2_147_483_647;

// O client mandou um itemId que não existe no catálogo, ou o total estoura o inteiro.
export class PedidoInvalidoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "PedidoInvalidoError";
  }
}

// Forma JSON de um pedido em GET /api/pedidos (camelCase).
export type Pedido = {
  id: string;
  clienteNome: string;
  status: string;
  totalCents: number | null;
  criadoEm: string;
};

// Grava o pedido 'recebido' numa única transação e devolve o id DEPOIS do COMMIT.
// Preços vêm do banco (nunca do client) e ficam congelados em pedido_itens.valor_cents.
// itemIds repetidos têm as quantidades somadas (PK é (pedido_id, item_id)).
// Quem chama (POST /api/checkout) enfileira o id via lib/sqs.ts depois do retorno.
export async function criarPedido(dados: NovoPedido): Promise<string> {
  const quantidades = new Map<string, number>();
  for (const { itemId, quantidade } of dados.itens) {
    quantidades.set(itemId, (quantidades.get(itemId) ?? 0) + quantidade);
  }
  const ids = [...quantidades.keys()];

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string; valor_cents: number }>(
      "select id, valor_cents from itens where id = any($1::uuid[])",
      [ids],
    );
    const precos = new Map(rows.map((r) => [r.id, r.valor_cents]));
    let total = 0;
    for (const [itemId, qtd] of quantidades) {
      const preco = precos.get(itemId);
      if (preco === undefined) throw new PedidoInvalidoError(`item inexistente: ${itemId}`);
      total += preco * qtd;
    }
    if (total > INT4_MAX) throw new PedidoInvalidoError("total do pedido acima do limite");

    const pedidoId = randomUUID();
    await client.query(
      `insert into pedidos (id, cliente_nome, cliente_email, status, total_cents)
       values ($1, $2, $3, 'recebido', $4)`,
      [pedidoId, dados.nome, dados.email, total],
    );
    for (const [itemId, qtd] of quantidades) {
      await client.query(
        `insert into pedido_itens (pedido_id, item_id, quantidade, valor_cents)
         values ($1, $2, $3, $4)`,
        [pedidoId, itemId, qtd, precos.get(itemId)],
      );
    }
    await client.query("COMMIT");
    return pedidoId;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // a falha original é a que importa
    }
    throw err;
  } finally {
    client.release();
  }
}

type LinhaPedido = {
  id: string;
  cliente_nome: string;
  status: string;
  total_cents: number | null;
  criado_em: Date | string;
};

export async function listarPedidos(): Promise<Pedido[]> {
  const { rows } = await getPool().query<LinhaPedido>(
    "select id, cliente_nome, status, total_cents, criado_em from pedidos order by criado_em desc, id",
  );
  return rows.map((r) => ({
    id: r.id,
    clienteNome: r.cliente_nome,
    status: r.status,
    totalCents: r.total_cents,
    criadoEm: new Date(r.criado_em).toISOString(),
  }));
}
