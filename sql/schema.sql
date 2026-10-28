-- Schema da padaria (enunciado, seção 7). Idempotente: pode rodar duas vezes.
create extension if not exists pgcrypto;

create table if not exists itens (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  descricao   text,
  valor_cents integer not null check (valor_cents >= 0),
  foto_key    text,
  criado_em   timestamptz not null default now()
);

create table if not exists pedidos (
  id            uuid primary key,            -- gerado pelo Next, chave de idempotência
  cliente_nome  text not null,
  cliente_email text not null,
  status        text not null default 'recebido', -- recebido | confirmado
  total_cents   integer,
  criado_em     timestamptz not null default now(),
  confirmado_em timestamptz
);

create table if not exists pedido_itens (
  pedido_id   uuid references pedidos(id),
  item_id     uuid references itens(id),
  quantidade  integer not null check (quantidade > 0),
  valor_cents integer not null,                 -- preço congelado no pedido
  primary key (pedido_id, item_id)
);
