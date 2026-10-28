# Roteiro de caos: retry, DLQ e idempotência

Este roteiro mostra, com a infraestrutura já deployada, o que o SQS faz quando a Lambda `processar-pedido` falha. Você vai provocar falhas de propósito pelo parâmetro `ChaosFailRate` do template (variável `CHAOS_FAIL_RATE` na Lambda).

## Como o caos funciona

- `ChaosFailRate` é um número de `0` a `1` (padrão `0`, que desliga o caos). O template rejeita valores fora dessa faixa.
- Na Lambda, a primeira coisa que `processarRegistro` faz é sortear um número em `[0, 1)`. Se for menor que a taxa, ela lança `CaosError` **antes de abrir conexão e antes de qualquer query**. O pedido continua `recebido`, o record entra em `batchItemFailures` e o SQS reentrega a mensagem após o visibility timeout (30 s).
- Taxa `0` nunca falha; taxa `1` sempre falha.
- Valor inválido na variável (texto, negativo, maior que 1) é ignorado com um aviso `CHAOS_FAIL_RATE inválida` no log, e a taxa vira `0`.

## Preparação

Use o mesmo perfil e região do deploy. Nos comandos abaixo, `<mesmos parâmetros do deploy>` significa repetir, no `--parameter-overrides`, **todos os parâmetros que você personalizou no deploy original**, com os mesmos valores: `DatabaseUrl` sempre (é `NoEcho`; não conte com o `samconfig.toml` para guardá-la) e, se você os alterou, `BucketName`, `AllowedOrigin` e `SesFrom`. Atenção: mudar o `BucketName` faria o CloudFormation substituir o bucket; mantenha o mesmo valor.

```bash
export AWS_PROFILE=padaria AWS_REGION=us-east-1

# URL da fila: Output PedidosQueueUrl do stack (troque <nome-do-stack> pelo --stack-name do deploy)
FILA=$(aws cloudformation describe-stacks --stack-name <nome-do-stack> \
  --query "Stacks[0].Outputs[?OutputKey=='PedidosQueueUrl'].OutputValue" --output text)

# A DLQ não tem Output; busque pelo nome
DLQ=$(aws sqs get-queue-url --queue-name pedidos-dlq --query QueueUrl --output text)
```

Ao subir o Next (`npm run dev`), use um terminal **sem** `AWS_PROFILE` (`unset AWS_PROFILE`): com o perfil exportado, o SDK ignora as chaves do `padaria-dev` no `.env.local` e o app roda com o admin sem avisar.

Atalho para ver as duas filas de uma vez:

```bash
for q in "$FILA" "$DLQ"; do
  aws sqs get-queue-attributes --queue-url "$q" \
    --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible
done
```

`ApproximateNumberOfMessages` são as mensagens esperando; `ApproximateNumberOfMessagesNotVisible` são as que estão "em voo" (entregues à Lambda e dentro do visibility timeout). Os números são aproximados e atrasam alguns segundos.

Deixe um segundo terminal acompanhando os logs durante todos os cenários:

```bash
aws logs tail /aws/lambda/processar-pedido --follow
```

## Cenário 1: rajada com 50% de falha

1. Ligue o caos:

   ```bash
   sam deploy --parameter-overrides ChaosFailRate=0.5 <mesmos parâmetros do deploy>
   ```

2. Com o Next rodando (`npm run dev`), finalize **10 pedidos** em `/checkout`, um atrás do outro.
3. Abra `/pedidos`: a lista atualiza a cada 2 s. Você deve ver os pedidos passando de `recebido` para `confirmado` **aos poucos**, não todos de uma vez: os que falharam no sorteio esperam ~30 s e são reentregues.
4. Nos logs, procure as linhas `falha no record ... (ApproximateReceiveCount=N)`. O `N` sobe (2, 3) para os pedidos que falham de novo. Com taxa 0,5, a chance de um pedido falhar 3 vezes seguidas é de 12,5%, então é normal que um ou outro chegue à DLQ.
5. Confira as filas com o atalho acima: `NotVisible` sobe durante a rajada e as duas zeram no fim (exceto mensagens que foram para a DLQ).

O que observar: nenhum pedido é confirmado duas vezes (um único e-mail por pedido), mesmo com retentativas.

## Cenário 2: tudo falha e a mensagem vai para a DLQ

1. Falha garantida:

   ```bash
   sam deploy --parameter-overrides ChaosFailRate=1 <mesmos parâmetros do deploy>
   ```

2. Finalize **1 pedido** em `/checkout` e guarde o número (`pedidoId`).
3. Nos logs aparecem 3 falhas, com `ApproximateReceiveCount=1`, `2` e `3`, espaçadas por ~30 s (visibility timeout). Aguarde cerca de 1 a 2 minutos.
4. Após a 3ª falha o SQS move a mensagem para a DLQ (`maxReceiveCount: 3`). Confirme:

   ```bash
   aws sqs get-queue-attributes --queue-url "$DLQ" --attribute-names ApproximateNumberOfMessages
   aws sqs receive-message --queue-url "$DLQ" --max-number-of-messages 1 --visibility-timeout 0
   ```

   O corpo da mensagem é o `{"pedidoId":"..."}` do pedido. `--visibility-timeout 0` devolve a mensagem sem escondê-la de outros consumidores.
5. Em `/pedidos` o pedido segue `recebido` (nada confirmou) e nenhum e-mail foi enviado.

## Cenário 3: entrega dupla não gera segundo e-mail

1. Desligue o caos para este cenário:

   ```bash
   sam deploy --parameter-overrides ChaosFailRate=0 <mesmos parâmetros do deploy>
   ```

2. Finalize um pedido e espere ele ficar `confirmado` em `/pedidos` (e o e-mail chegar). Anote o `pedidoId`.
3. Simule uma entrega duplicada (o SQS padrão garante entrega *ao menos uma vez*, então isso pode acontecer de verdade):

   ```bash
   aws sqs send-message --queue-url "$FILA" --message-body '{"pedidoId":"<pedidoId-do-passo-2>"}'
   ```

4. Nos logs aparece `pedido <id> já processado`: o `UPDATE ... WHERE id = $1 AND status = 'recebido'` afeta 0 linhas, a Lambda faz COMMIT e encerra **sem publicar no SNS**. Nenhum segundo e-mail chega e o pedido continua `confirmado` com o mesmo `confirmado_em`.

Opcional: reenvie o mesmo `send-message` mais algumas vezes; o resultado é sempre o mesmo.

## Encerramento

Volte a taxa para `0` e redeploye. **Não deixe o caos ligado**, ou pedidos reais vão falhar.

```bash
sam deploy --parameter-overrides ChaosFailRate=0 <mesmos parâmetros do deploy>
```

Se sobrou mensagem na DLQ, apague com `aws sqs purge-queue --queue-url "$DLQ"` (o purge aceita uma chamada a cada 60 s por fila).

## Rascunho da resposta: e se a Lambda de e-mail estiver fora do ar na hora do pedido?

O pedido **não é afetado**: o cliente recebe o `202`, o pedido é gravado e a `processar-pedido` o confirma normalmente. O `enviar-email` é invocado de forma **assíncrona** pelo SNS, então um problema nele nunca volta para quem fez o pedido.

O que acontece com o e-mail, nesta implementação:

1. A `processar-pedido` publica no tópico `pedido-confirmado` **dentro da transação**, antes do COMMIT. Se o próprio `Publish` falhar, a transação sofre ROLLBACK, o pedido continua `recebido` e o SQS reentrega a mensagem (até 3 vezes, depois DLQ). Nesse caso nenhum e-mail se perde.
2. Publicado o evento, o SNS o entrega ao `enviar-email` como **invocação assíncrona** do Lambda: o serviço Lambda enfileira o evento internamente e o executa depois. Se a função executar e lançar erro (por exemplo, o SES recusando o envio), o Lambda tenta de novo **2 vezes** (3 execuções no total), com espera entre elas. Se a função estiver indisponível ou limitada (throttling) ou houver erro do próprio serviço, o Lambda continua tentando até o evento completar a idade máxima (`MaximumEventAgeInSeconds`, padrão de 6 horas).
3. Esgotadas as tentativas, o evento é **descartado**: o `enviar-email` do template não tem DLQ nem *on-failure destination*, e o tópico não tem fila no meio. O pedido fica `confirmado` no banco, mas o cliente **não recebe o e-mail**. Também não há reprocessamento automático, porque a mensagem do SQS já foi consumida com sucesso.
4. Como o e-mail só é publicado quando o `UPDATE` afeta 1 linha, reenviar o `pedidoId` à fila **não** reenvia o e-mail de um pedido já confirmado (cenário 3). Recuperar um e-mail perdido exige ação manual ou uma das melhorias abaixo.

Em resumo: para o pedido o sistema é resiliente (nunca se perde, e só é confirmado se a publicação deu certo). Para o e-mail, a garantia é "ao menos uma vez" **com perda possível** depois que as retentativas do SNS/Lambda se esgotam. No sentido oposto, se o COMMIT falhar depois de um `Publish` bem-sucedido, a retentativa publica de novo e o cliente pode receber o e-mail em duplicidade (raro, e preferível a nunca receber).

### Desafio: não perder o e-mail

Para fechar essa lacuna, configure uma DLQ ou *on-failure destination* (uma fila SQS, por exemplo) no `enviar-email` (propriedades `DeadLetterQueue` ou `EventInvokeConfig` da função SAM, no `template.yaml`) e um alarme CloudWatch nela. Assim, os e-mails que esgotaram as tentativas ficam guardados e podem ser reenviados depois. Esta melhoria **não** está implementada.
