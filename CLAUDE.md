@AGENTS.md

# Padaria na AWS

Projeto de referência do módulo Cloud (Ada): catálogo e pedidos de uma padaria. Next.js 16 (App Router, TypeScript) local + AWS (S3, RDS Postgres, SQS, Lambda, SNS, SES). Este arquivo é a fonte dos nomes e regras; confira aqui antes de procurar fora.

## Arquitetura fechada

Fluxo: Browser -> Next (servidor) -> S3 (URL assinada PUT/GET), RDS, SQS `pedidos` (DLQ `pedidos-dlq` após 3 falhas) -> Lambda `processar-pedido` -> SNS `pedido-confirmado` -> Lambda `enviar-email` -> SES -> cliente.

- O Next grava o pedido (transação) antes de enfileirar; a fila carrega só `{ pedidoId }`.
- `processar-pedido` lê o RDS e faz `UPDATE ... SET status='confirmado' ... WHERE id=? AND status='recebido'`; só publica no SNS se afetou 1 linha.
- `enviar-email` assina o SNS direto (sem fila no meio).
- Erro na Lambda: a mensagem volta após o visibility timeout (30 s); na 3ª falha vai para a DLQ.
- `/pedidos` faz polling de `GET /api/pedidos` a cada 2 s.
- Foto: chave `itens/<uuid>.<ext>`; só jpeg/png/webp até 5 MB, validado no servidor antes de assinar.

Decisões fechadas (não rediscutir):
- Região `us-east-1`; Lambdas `nodejs22.x`.
- Carrinho no browser (localStorage); credenciais do banco em variáveis de ambiente (Secrets Manager é desafio extra).
- Next roda local; deploy na Vercel é opcional.
- RDS com endpoint público protegido por Security Group (5432 só para o IP local).
- Lambdas fora de VPC. Nada de NAT Gateway, VPC Endpoint ou ElastiCache.
- SES em sandbox: remetente e destinatário são identidades verificadas (o mais simples: o mesmo e-mail). O remetente é o parâmetro `SesFrom`, sem valor padrão.

## Nomes dos recursos

| Recurso | Nome |
|---|---|
| Região | `us-east-1` |
| Fila SQS | `pedidos` |
| DLQ | `pedidos-dlq` (`maxReceiveCount: 3`, visibility timeout 30 s) |
| Tópico SNS | `pedido-confirmado` |
| Lambda | `processar-pedido` (policies SAM: `SQSPollerPolicy` na fila + `SNSPublishMessagePolicy` no tópico) |
| Lambda | `enviar-email` (role: `ses:SendEmail`) |
| Bucket S3 | parâmetro `BucketName` (padrão `padaria-fotos-bruno`; os alunos usam um nome único), privado |
| Usuário IAM | `padaria-dev` (só o Next local, via `.env.local`) |
| Usuário IAM | `padaria-admin` (admin, usado pelo perfil `padaria` e pelos MCPs) |
| Perfil AWS CLI | `padaria` |
| SES (remetente) | parâmetro `SesFrom` (identidade verificada de cada aluno) |

Variáveis de ambiente (`.env.example` é o modelo; `.env.local` nunca é commitado):

| Variável | Usada por |
|---|---|
| `AWS_REGION` | Next, Lambdas |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Next, só local (usuário `padaria-dev`) |
| `DATABASE_URL` | Next, `processar-pedido` (RDS: `postgres://user:senha@host:5432/padaria?uselibpqcompat=true&sslmode=require`; com o `pg` instalado o `sslmode=require` puro vira verify-full e falha contra o CA da RDS) |
| `S3_BUCKET` | Next (Output `BucketName`) |
| `SQS_QUEUE_URL` | Next (Output `PedidosQueueUrl`) |
| `SNS_TOPIC_ARN` | `processar-pedido`; vem do template, não entra no `.env.local` |
| `SES_FROM` | `enviar-email`; vem do parâmetro `SesFrom`, não entra no `.env.local` |
| `CHAOS_FAIL_RATE` | `processar-pedido` (opcional, 0 a 1; parâmetro `ChaosFailRate`, ver `docs/caos.md`) |

## Regra de infra

Tudo que couber em SAM vai no `template.yaml` (fila, DLQ, tópico, Lambdas, bucket, assinatura). Ficam fora do template, documentados no README: RDS, usuários IAM, identidade do SES. Parâmetros do template: `BucketName`, `AllowedOrigin`, `DatabaseUrl` (NoEcho), `SesFrom`, `ChaosFailRate`. Outputs: `BucketName`, `PedidosQueueUrl`, `PedidoConfirmadoTopicArn`. O MCP pode criar/depurar recursos, mas a mudança volta para o template; recurso criado só pelo MCP é dívida.

## MCPs (opcionais; cada pessoa registra os seus, ver README seção 10)

Escopo `local` (vale só para este diretório, fica em `~/.claude.json`). Não usar `--scope project` e não criar `.mcp.json` (vazaria o nome do perfil para o git).

```bash
claude mcp add aws-api -e AWS_REGION=us-east-1 -e AWS_PROFILE=padaria -e READ_OPERATIONS_ONLY=true -- uvx awslabs.aws-api-mcp-server@latest
claude mcp add aws-serverless -e AWS_REGION=us-east-1 -e AWS_PROFILE=padaria -- uvx awslabs.aws-serverless-mcp-server@latest
```

- `aws-api`: `READ_OPERATIONS_ONLY=true` por padrão. Para criar recursos: `claude mcp remove aws-api` e adicionar de novo sem a flag.
- `aws-serverless`: SAM (build/deploy); precisa de `sam` no `PATH`.
- Opcional: AWS Knowledge MCP para consultar documentação.

## Contratos das rotas

| Rota | Entrada | Saída | Fala com |
|---|---|---|---|
| `POST /api/upload-url` | `{ contentType }` | `{ uploadUrl, fotoKey }` | S3 |
| `POST /api/itens` | `{ nome, descricao, valorCents, fotoKey }` | `201 { item }` | RDS |
| `GET /api/itens` | | `{ itens: [{ ..., fotoUrl }] }` | RDS, S3 (URL de GET) |
| `GET /api/itens/[id]` | | `{ item }` | RDS, S3 |
| `POST /api/checkout` | `{ nome, email, itens: [{ itemId, quantidade }] }` | `202 { pedidoId }` | RDS, SQS |
| `GET /api/pedidos` | | `{ pedidos: [{ id, clienteNome, status, totalCents, criadoEm }] }` | RDS |

Toda rota de `app/api` declara `export const runtime = "nodejs"` (o SDK da AWS não roda no Edge).

Estrutura: `app/` (páginas `itens`, `itens/novo`, `itens/[id]`, `checkout`, `pedidos` + `api/*`), `lib/` (`db.ts` pool do pg, `itens.ts` queries de itens + `urlDaFoto` (ponto único da foto), `schemas.ts` zod, `dinheiro.ts` centavos<->reais, `s3.ts`, `sqs.ts`, `carrinho.ts` só no browser), `lib/config.ts` (`lerEnv`, `lerEnvOpcional`), `lib/http.ts`, `lib/pedidos.ts`, `lib/sqs.ts`, `lib/sns.ts`, `lib/ses.ts`, `lambdas/` (`processar-pedido/handler.ts`, `enviar-email/handler.ts`, `build.mjs` esbuild -> `dist/<nome>/index.mjs`, o `CodeUri` do template; `dist/` é ignorado pelo controle de versão), `sql/` (`schema.sql` idempotente, `seed.sql` rodar uma vez), `template.yaml` (SAM) + `template.test.ts` + `infra/template.ts` (parse para os testes), `docs/caos.md` (roteiro de caos e resposta de resiliência), `README.md` (passo a passo dos alunos).

## Modelo de dados

```sql
create table itens (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  descricao   text,
  valor_cents integer not null check (valor_cents >= 0),
  foto_key    text,
  criado_em   timestamptz not null default now()
);

create table pedidos (
  id            uuid primary key,            -- gerado pelo Next, chave de idempotência
  cliente_nome  text not null,
  cliente_email text not null,
  status        text not null default 'recebido', -- recebido | confirmado
  total_cents   integer,
  criado_em     timestamptz not null default now(),
  confirmado_em timestamptz
);

create table pedido_itens (
  pedido_id   uuid references pedidos(id),
  item_id     uuid references itens(id),
  quantidade  integer not null check (quantidade > 0),
  valor_cents integer not null,                 -- preço congelado no pedido
  primary key (pedido_id, item_id)
);
```

Regras de negócio:
- Valor em centavos inteiros, nunca float.
- Preço congelado em `pedido_itens.valor_cents`.
- Pedido sem itens não finaliza; nome e e-mail obrigatórios, e-mail com formato válido.
- Idempotência pelo `WHERE status = 'recebido'`; um único e-mail por pedido.
- O e-mail lista itens, quantidades, total e número do pedido.

## Segurança

- Nenhuma credencial no browser nem no git.
- O Next usa só `padaria-dev`, via `.env.local` (ignorado pelo git). As chaves do `padaria-dev` nunca entram em `~/.aws`; o perfil `padaria` é do `padaria-admin`.
- Antes de commitar: `git status` e conferir que nenhum `.env*` além de `.env.example` está staged.
- Foto: validar tipo (jpeg/png/webp) e tamanho (5 MB) no servidor antes de assinar a URL.

## Comandos

Gerenciador: npm.

| Comando | Uso |
|---|---|
| `npm run dev` | Next local |
| `npm run lint` | ESLint |
| `npm run build` | Build de produção (deve passar sempre, inclusive sem `.env.local`) |
| `npm test` | Vitest (`vitest run`), com mocks; sem AWS nem banco reais. Testes ficam ao lado do código (`lib/*.test.ts`); alias `@/*` configurado em `vitest.config.mts` |
| `npm run build:lambdas` | esbuild das duas Lambdas para `dist/`; rodar antes do `sam deploy` |
| `sam validate --lint` / `sam deploy --guided --profile padaria` | Passos do aluno (precisam do `sam` e da conta AWS); nunca rodados no desenvolvimento do repo. Sem `sam build`: o `dist/` já é JS pronto. O `npm test` só faz parse do `template.yaml` (`template.test.ts`, helper `infra/template.ts` com as tags `!Ref`/`!GetAtt`/`!Sub`...) |

Config ausente (clients lazy):
- Nenhum client (pg, S3, SQS, SNS, SES) é criado no import; `npm run build` passa sem `.env.local`.
- Variável obrigatória lida com `lerEnv(nome)` de `lib/config.ts`, que lança `ConfigAusenteError(nome)` (mensagem `<VAR> não configurada`).
- Toda rota de `app/api` captura erros com `respostaDeErro(err)` de `lib/http.ts`: `ConfigAusenteError` -> `503 { erro }`, outros -> `500 { erro: "erro interno" }`.
- Banco: `getPool()` de `lib/db.ts` (pool único por processo, via `globalThis`). `sql/schema.sql` é idempotente; `sql/seed.sql` roda uma vez.

Regras do Next 16 neste repo:
- `next.config.ts` NÃO pode habilitar `cacheComponents` (nem `partialPrefetching`): com Cache Components o Next 16 proíbe `export const runtime` (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/runtime.md:24`), e toda rota precisa de `runtime = "nodejs"`.
- Leia `node_modules/next/dist/docs/` antes de usar qualquer API do Next (ver bloco do `AGENTS.md` acima). O `next dev` reescreve o `AGENTS.md`; não editar à mão.
