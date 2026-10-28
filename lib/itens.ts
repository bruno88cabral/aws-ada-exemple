import { getPool } from "@/lib/db";
import { urlParaLeituraOuNull } from "@/lib/s3";
import type { NovoItem } from "@/lib/schemas";

// Forma JSON do item em todas as respostas (camelCase).
export type Item = {
  id: string;
  nome: string;
  descricao: string | null;
  valorCents: number;
  fotoKey: string | null;
  fotoUrl: string | null;
  criadoEm: string;
};

type Linha = {
  id: string;
  nome: string;
  descricao: string | null;
  valor_cents: number;
  foto_key: string | null;
  criado_em: Date | string;
};

const COLUNAS = "id, nome, descricao, valor_cents, foto_key, criado_em";

// Único ponto que assina a URL de GET da foto. null sem foto ou sem S3 configurado.
export async function urlDaFoto(fotoKey: string | null): Promise<string | null> {
  if (!fotoKey) return null;
  return urlParaLeituraOuNull(fotoKey);
}

async function paraItem(l: Linha): Promise<Item> {
  return {
    id: l.id,
    nome: l.nome,
    descricao: l.descricao,
    valorCents: l.valor_cents,
    fotoKey: l.foto_key,
    fotoUrl: await urlDaFoto(l.foto_key),
    criadoEm: new Date(l.criado_em).toISOString(),
  };
}

export async function listarItens(): Promise<Item[]> {
  const { rows } = await getPool().query<Linha>(
    `select ${COLUNAS} from itens order by criado_em desc, id`,
  );
  return Promise.all(rows.map(paraItem));
}

// `id` precisa ser uuid válido (valide antes com idSchema).
export async function buscarItem(id: string): Promise<Item | null> {
  const { rows } = await getPool().query<Linha>(
    `select ${COLUNAS} from itens where id = $1`,
    [id],
  );
  return rows[0] ? paraItem(rows[0]) : null;
}

export async function criarItem(d: NovoItem): Promise<Item> {
  const { rows } = await getPool().query<Linha>(
    `insert into itens (nome, descricao, valor_cents, foto_key)
     values ($1, $2, $3, $4) returning ${COLUNAS}`,
    [d.nome, d.descricao, d.valorCents, d.fotoKey],
  );
  return paraItem(rows[0]);
}
