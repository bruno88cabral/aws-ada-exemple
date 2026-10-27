# Padaria na AWS

Projeto de referência do módulo Cloud da Ada: catálogo e pedidos de uma padaria, com Next.js rodando local e S3, RDS, SQS, Lambda, SNS e SES na AWS.

## Rodando local

Usamos npm.

```bash
npm install
cp .env.example .env.local   # preencha as variáveis
npm run dev                  # http://localhost:3000
npm run lint
npm run build
```

## Recursos fora do template SAM

Estes recursos não estão no `template.yaml`:

- RDS Postgres
- Usuários IAM `padaria-dev` e `padaria-admin`
- Identidade do SES (`bruno88cabral@gmail.com`)

O passo a passo de cada um é adicionado pelas tarefas que criam esses recursos.

## Arquitetura, nomes e contratos

Veja o [CLAUDE.md](CLAUDE.md).
