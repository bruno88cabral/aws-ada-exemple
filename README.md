# Padaria na AWS

Projeto de referência do módulo Cloud da Ada: catálogo e pedidos de uma padaria. O Next.js roda na sua máquina; a AWS cuida de fotos (S3), banco (RDS Postgres), fila (SQS), processamento (Lambda), notificação (SNS) e e-mail (SES).

```
Browser -> Next (local) -> S3 (foto), RDS, SQS pedidos -> Lambda processar-pedido -> SNS pedido-confirmado -> Lambda enviar-email -> SES -> cliente
```

O repositório já vem pronto para conectar: você **não edita código**. Cria os recursos, preenche o `.env.local` e roda `sam deploy`. Nomes, contratos das rotas e modelo de dados estão no [CLAUDE.md](CLAUDE.md).

Sem AWS configurada o app sobe normalmente e mostra estados "não configurado" (as rotas respondem 503 dizendo qual variável falta). Dá para explorar a interface antes de criar qualquer recurso.

## 1. Pré-requisitos

- Node 22+ e npm
- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- [SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
- Um cliente `psql` (ou outro cliente Postgres) para rodar os scripts SQL
- Opcional: `uv` e os MCPs da AWS no Claude Code (seção 10)

Tudo usa a região **`us-east-1`**.

## 2. Conta e IAM

Em uma conta AWS nova, no console do IAM:

1. **Usuário administrador** `padaria-admin`, com a policy `AdministratorAccess`. Crie uma access key (caso de uso "CLI") e configure um perfil local:

   ```bash
   aws configure --profile padaria     # região us-east-1
   aws sts get-caller-identity --profile padaria
   ```

   Esse perfil é usado só para o deploy e para os comandos `aws` deste README (`--profile padaria` ou `export AWS_PROFILE=padaria`).

2. **Usuário `padaria-dev`**, sem acesso ao console, com esta policy inline (troque `SEU-BUCKET` pelo nome do bucket que você vai usar na seção 5):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject"], "Resource": "arn:aws:s3:::SEU-BUCKET/itens/*" },
       { "Effect": "Allow", "Action": ["sqs:SendMessage", "sqs:GetQueueAttributes"], "Resource": "arn:aws:sqs:us-east-1:*:pedidos" }
     ]
   }
   ```

   Crie uma access key para ele. Ela vai **só** no `.env.local` (seção 6); **não** a coloque em `~/.aws` nem no perfil `padaria`.

O Next local usa apenas o `padaria-dev` (mínimo privilégio). As Lambdas recebem suas permissões do `template.yaml`.

## 3. RDS (Postgres)

O RDS não está no template. Crie pelo console (RDS > Create database):

- Engine **PostgreSQL 16**, template **Free tier** ou **Dev/Test**, classe **`db.t4g.micro`**, 20 GB.
- Usuário mestre e senha à sua escolha (anote).
- **Public access: Yes**.
- Security Group com uma regra de entrada: **PostgreSQL, porta 5432, origem `0.0.0.0/0`** (explicação abaixo).
- Em Additional configuration, "Initial database name" = `padaria` (ou rode `create database padaria;` depois).

**Por que `0.0.0.0/0`?** As Lambdas ficam **fora de VPC** e acessam o RDS pelo endpoint público, e uma Lambda fora de VPC não tem IP fixo, então não dá para liberar só o IP dela. O banco fica exposto à internet, protegido apenas por **senha forte + TLS** (`sslmode=require`): use uma senha longa e aleatória. A alternativa seria colocar as Lambdas na VPC, mas aí elas perdem a saída para a internet e precisam de NAT Gateway ou VPC endpoints para alcançar SNS e SES, o que custa dinheiro por hora. Como isso é um ambiente de estudo, aceitamos o trade-off: **apague o RDS assim que terminar** (seção 9).

Quando o status for `Available`, copie o **Endpoint** e rode os scripts:

```bash
export PGSSLMODE=require
psql -h SEU-ENDPOINT -U SEU-USUARIO -d padaria -f sql/schema.sql
psql -h SEU-ENDPOINT -U SEU-USUARIO -d padaria -f sql/seed.sql
```

O `psql` com `PGSSLMODE=require` (ou `sslmode=require` na URL) funciona normalmente; o `uselibpqcompat` abaixo só importa para o driver `pg` do Node. `sql/schema.sql` pode ser repetido sem problema. **`sql/seed.sql` roda uma vez só**: rodar de novo duplica os itens de exemplo.

Monte a `DATABASE_URL`:

```
postgres://USUARIO:SENHA@ENDPOINT:5432/padaria?uselibpqcompat=true&sslmode=require
```

Por que os dois parâmetros: o driver `pg` instalado trata `sslmode=require` puro como verificação completa do certificado e falha contra o certificado da RDS (`self-signed certificate in certificate chain`). Com `uselibpqcompat=true`, `require` volta ao significado do libpq: conexão criptografada, sem validar a CA. Se a senha tiver caracteres especiais (`@`, `/`, `:`, `#`), codifique-os (`@` vira `%40`).

## 4. SES (e-mail)

O SES começa em **sandbox**: só envia de e para endereços verificados.

1. Console do SES, região **us-east-1** > Identities > Create identity > **Email address**, com o seu e-mail.
2. Abra o e-mail de verificação e clique no link. O status deve ficar `Verified`.
3. Use esse mesmo e-mail como remetente (`SesFrom`, seção 5) **e** como e-mail do cliente ao finalizar o pedido. Em sandbox, remetente e destinatário precisam ser identidades verificadas; o mais simples é serem o mesmo endereço.

## 5. Deploy (SAM)

O `template.yaml` cria o bucket, a fila `pedidos` e a DLQ `pedidos-dlq`, o tópico `pedido-confirmado` e as duas Lambdas. Parâmetros:

| Parâmetro | O que é |
|---|---|
| `BucketName` | nome do bucket de fotos; precisa ser **único na AWS** (ex.: `padaria-fotos-seunome`); o mesmo nome vai na policy do `padaria-dev` |
| `AllowedOrigin` | origem liberada no CORS do bucket (padrão `http://localhost:3000`; mude se usar outra porta) |
| `DatabaseUrl` | a `DATABASE_URL` da seção 3 |
| `SesFrom` | seu e-mail verificado no SES |
| `ChaosFailRate` | `0` (padrão); só mude no roteiro de caos |

Ordem dos comandos:

```bash
npm install
npm run build:lambdas
rm -rf .aws-sam
sam validate --lint --profile padaria
sam deploy --guided --profile padaria --template-file template.yaml
```

Nos deploys seguintes (mudou parâmetro ou código de Lambda), repita a mesma sequência sem o `--guided`: `npm run build:lambdas`, `rm -rf .aws-sam`, `sam deploy --profile padaria --template-file template.yaml`.

- **`npm run build:lambdas` vem antes do deploy.** O `template.yaml` aponta para `dist/processar-pedido/` e `dist/enviar-email/`, que o esbuild gera (`dist/` não vai para o git). Sem esse passo o deploy falha por pasta inexistente.
- **Rode `npm run build:lambdas` antes de todo redeploy**, sempre que o código das Lambdas mudar: o `sam deploy` envia o que estiver em `dist/` naquele momento.
- **Não use `sam build`.** O esbuild já entrega o JavaScript pronto (um `index.mjs` por Lambda, com o `pg` embutido e o `@aws-sdk/*` vindo do runtime), sem `package.json` para o SAM instalar. O `sam build` criaria `.aws-sam/build/template.yaml`, e o `sam deploy` usa esse arquivo por padrão quando ele existe, enviando uma cópia antiga das Lambdas mesmo depois de um novo `build:lambdas`. Por isso o `rm -rf .aws-sam` e o `--template-file template.yaml` na sequência acima. O MCP `aws-serverless` (seção 10) pode sugerir `sam build`: não siga essa sugestão.
- No `--guided`: stack name (ex.: `padaria`), região `us-east-1`, os parâmetros da tabela, aceite a criação de roles IAM (`CAPABILITY_IAM`) e salve a configuração. A `DatabaseUrl` é `NoEcho`: não conte com o `samconfig.toml` para guardá-la; informe de novo (ou use `--parameter-overrides`) a cada deploy. `SesFrom` não tem valor padrão, então o SAM sempre pergunta.
- Se o deploy disser que o bucket já existe, troque o `BucketName`.

### Outputs para o `.env.local`

Ao fim do deploy o SAM imprime os Outputs. Para vê-los de novo:

```bash
aws cloudformation describe-stacks --stack-name padaria --profile padaria \
  --query "Stacks[0].Outputs" --output table
```

| Output | Vai para |
|---|---|
| `BucketName` | `S3_BUCKET` |
| `PedidosQueueUrl` | `SQS_QUEUE_URL` |
| `PedidoConfirmadoTopicArn` | não precisa: a `processar-pedido` já recebe `SNS_TOPIC_ARN` do template |

`SES_FROM` também não entra no `.env.local`: é variável da Lambda `enviar-email`, preenchida pelo parâmetro `SesFrom`.

## 6. Rodando

```bash
cp .env.example .env.local
```

Preencha o `.env.local`: `AWS_REGION`, as chaves do `padaria-dev`, a `DATABASE_URL`, `S3_BUCKET` e `SQS_QUEUE_URL` (Outputs). Depois:

```bash
npm run dev     # http://localhost:3000
```

Rode o `npm run dev` em um terminal **sem** `AWS_PROFILE` (`unset AWS_PROFILE`): se ele estiver exportado (seção 2), o SDK prefere o perfil às chaves do `padaria-dev` no `.env.local` e o app roda em silêncio com o perfil admin.

Teste o fluxo completo:

1. `/itens/novo`: cadastre um item com foto (jpeg, png ou webp, até 5 MB).
2. `/itens`: abra o item e adicione ao pedido.
3. `/checkout`: finalize usando o **e-mail verificado no SES**.
4. `/pedidos`: o pedido nasce `recebido` e muda para `confirmado` sozinho em alguns segundos. O e-mail chega na caixa de entrada (veja o spam).

Outros comandos: `npm run lint`, `npm run build` (passa mesmo sem `.env.local`), `npm test` (Vitest com mocks, sem AWS nem banco).

Comportamentos conhecidos:

- Se o envio ao SQS falhar, o checkout ainda responde `202` e o pedido fica `recebido`. Reenfileire à mão: `aws sqs send-message --queue-url "<SQS_QUEUE_URL>" --message-body '{"pedidoId":"<id>"}' --profile padaria`. É seguro repetir: a confirmação é idempotente.
- Em um caso raro (o COMMIT falha depois do `Publish` no SNS) o cliente pode receber o e-mail em duplicidade.

## 7. Pegadinhas

- **Upload da foto falha no browser (CORS ou 403).** O `AllowedOrigin` precisa ser exatamente a origem em que você abre o app (`http://localhost:3000`, com porta, sem barra no final). O `Content-Type` do `PUT` deve ser o mesmo `contentType` pedido ao assinar a URL. O `S3_BUCKET` e a policy do `padaria-dev` precisam apontar para o mesmo bucket.
- **`ETIMEDOUT` ou conexão recusada no banco.** O Security Group não tem a regra de entrada 5432 para `0.0.0.0/0` ou o "Public access" está desligado (seção 3).
- **`self-signed certificate in certificate chain`.** A `DATABASE_URL` está sem `uselibpqcompat=true&sslmode=require`.
- **Pedido fica `recebido`.** Olhe os logs: `aws logs tail /aws/lambda/processar-pedido --follow --profile padaria`. Causas comuns: Lambda sem alcançar o RDS, `DatabaseUrl` errada no deploy, mensagem já na DLQ.
- **E-mail não chega.** SES em sandbox: remetente e destinatário precisam ser identidades verificadas em `us-east-1`. Veja os logs da `enviar-email` (`MessageRejected`) e o spam.
- **`503` com "X não configurada".** Falta a variável no `.env.local`; reinicie o `npm run dev` depois de editar.

## 8. Resiliência

O SQS entrega a mensagem ao menos uma vez; se a `processar-pedido` falhar, ela volta após 30 s e, na 3ª falha, vai para a DLQ `pedidos-dlq`. A idempotência vem do `UPDATE ... WHERE status = 'recebido'`: uma entrega repetida não confirma de novo nem manda outro e-mail.

E se a Lambda de e-mail estiver fora do ar na hora do pedido? O pedido não é afetado: o cliente já recebeu o `202` e o pedido é confirmado, porque o SNS invoca o `enviar-email` de forma assíncrona. O Lambda tenta de novo em caso de erro, mas esgotadas as tentativas o e-mail é descartado (o template não tem DLQ nem destination para o `enviar-email`): pedido confirmado, cliente sem e-mail. A explicação completa e o desafio de não perder o e-mail estão em [docs/caos.md](docs/caos.md).

O mesmo documento traz o **roteiro de caos**: com o parâmetro `ChaosFailRate` você faz a `processar-pedido` falhar de propósito e observa a rajada com retentativas, a mensagem indo para a DLQ e a entrega dupla sem segundo e-mail. Ao terminar, volte `ChaosFailRate` para `0`.

## 9. Custo e teardown

O RDS cobra por hora enquanto existir (`db.t4g.micro`); S3, SQS, Lambda, SNS e SES custam centavos neste volume. **Pare o RDS quando não estiver usando** (a AWS religa um RDS parado após 7 dias). Ao terminar, apague tudo:

1. **RDS:** console > Databases > Actions > Delete. **Sem snapshot final** e desmarcando "retain automated backups"; se você criou snapshots manuais, apague-os em RDS > Snapshots (snapshots e backups retidos continuam cobrando). Apague também o Security Group criado para ele.
2. **Bucket, antes do stack:** o bucket não tem política de retenção e o CloudFormation não apaga bucket com objetos; se ele estiver cheio, o stack termina em `DELETE_FAILED`. Esvazie primeiro:

   ```bash
   aws s3 rm s3://SEU-BUCKET --recursive --profile padaria
   ```

3. **Stack:**

   ```bash
   sam delete --stack-name padaria --profile padaria
   ```

   Só se o bucket ainda existir depois disso: `aws s3 rb s3://SEU-BUCKET --profile padaria`.
4. **Restos do deploy:**
   - O `sam deploy --guided` criou o stack `aws-sam-cli-managed-default` com um bucket de artefatos. Esse bucket tem **versionamento ligado**: `aws s3 rm --recursive` deixa versões e delete markers para trás e o stack termina em `DELETE_FAILED`. Esvazie **todas as versões** pelo console do S3 (ache o bucket pelo nome em `aws cloudformation describe-stack-resources --stack-name aws-sam-cli-managed-default --profile padaria`, selecione-o e use o botão **Empty**, que remove todas as versões). Pela CLI seria preciso `aws s3api list-object-versions` seguido de `aws s3api delete-objects` para versões e delete markers. Depois apague o stack: `aws cloudformation delete-stack --stack-name aws-sam-cli-managed-default --profile padaria`.
   - Os log groups `/aws/lambda/processar-pedido` e `/aws/lambda/enviar-email` sobrevivem ao stack: `aws logs delete-log-group --log-group-name /aws/lambda/processar-pedido --profile padaria` (e o mesmo para `enviar-email`).
5. **SES:** remova a identidade verificada, se quiser.
6. **IAM:** apague as access keys do `padaria-dev` e o próprio usuário; por último, as chaves e o usuário `padaria-admin` (e o perfil `padaria` em `~/.aws`).
7. Apague o seu `.env.local`.

## 10. Opcional: MCPs da AWS no Claude Code

Com `uv` instalado, você pode ligar o Claude Code à sua conta. Use escopo `local` (padrão) e não crie `.mcp.json`, para não vazar o nome do perfil no git:

```bash
claude mcp add aws-api -e AWS_REGION=us-east-1 -e AWS_PROFILE=padaria -e READ_OPERATIONS_ONLY=true -- uvx awslabs.aws-api-mcp-server@latest
claude mcp add aws-serverless -e AWS_REGION=us-east-1 -e AWS_PROFILE=padaria -- uvx awslabs.aws-serverless-mcp-server@latest
```

O `aws-api` fica somente leitura; para permitir criar recursos, remova (`claude mcp remove aws-api`) e adicione de novo sem a flag. O `aws-serverless` usa o `sam` do seu `PATH`. Tudo que o MCP criar precisa voltar para o `template.yaml`; recurso criado só pelo MCP é dívida.

## 11. Desafios extras

- Segunda subscription no tópico: uma fila SQS `cozinha` que recebe o pedido confirmado, ao lado do e-mail.
- DLQ ou destination de falha para a `enviar-email`, para não perder o e-mail (ver [docs/caos.md](docs/caos.md)).
- Thumbnail da foto por evento do S3.
- Guardar a `DATABASE_URL` no Secrets Manager.
- Deploy do Next na Vercel.
- Fila FIFO.
- Alarme do CloudWatch na DLQ.
