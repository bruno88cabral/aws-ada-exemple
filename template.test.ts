import { describe, expect, it } from "vitest";
import { lerTemplate, parseTemplate } from "@/infra/template";

// Parse do template.yaml. Não substitui `sam validate --lint` (passo do aluno).
// MYK-974/975: acrescente `describe` abaixo; o helper (infra/template.ts) já
// entende !Ref/!GetAtt/!Sub/!Join/... e oferece recursosDoTipo(t, "AWS::...").
const t = lerTemplate();

describe("parse das tags curtas", () => {
  it("converte !Ref, !GetAtt, !Sub e !Join", () => {
    const x = parseTemplate("A: !Ref B\nC: !GetAtt Fila.Arn\nD: !Sub '${AWS::Region}'\nE: !Join ['-', [a, !Ref B]]");
    expect(x).toEqual({
      A: { Ref: "B" },
      C: { "Fn::GetAtt": ["Fila", "Arn"] },
      D: { "Fn::Sub": "${AWS::Region}" },
      E: { "Fn::Join": ["-", ["a", { Ref: "B" }]] },
    });
  });
});

describe("template.yaml - base", () => {
  it("é SAM", () => {
    expect(t.Transform).toBe("AWS::Serverless-2016-10-31");
  });
});

describe("template.yaml - bucket de fotos", () => {
  it("parâmetros com os defaults", () => {
    expect(t.Parameters.BucketName.Default).toBe("padaria-fotos-bruno");
    expect(t.Parameters.AllowedOrigin.Default).toBe("http://localhost:3000");
  });

  const bucket = t.Resources.FotosBucket;

  it("é um AWS::S3::Bucket", () => {
    expect(bucket.Type).toBe("AWS::S3::Bucket");
  });

  it("nome vem do parâmetro", () => {
    expect(bucket.Properties?.BucketName).toEqual({ Ref: "BucketName" });
  });

  it("bloqueia todo acesso público", () => {
    expect(bucket.Properties?.PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
  });

  it("CORS libera PUT e GET para AllowedOrigin com qualquer header", () => {
    const [regra] = bucket.Properties?.CorsConfiguration.CorsRules;
    expect(regra.AllowedMethods).toEqual(["PUT", "GET"]);
    expect(regra.AllowedOrigins).toEqual([{ Ref: "AllowedOrigin" }]);
    expect(regra.AllowedHeaders).toEqual(["*"]);
  });

  it("output com o nome do bucket", () => {
    expect(t.Outputs.BucketName.Value).toEqual({ Ref: "FotosBucket" });
  });
});

describe("template.yaml - fila de pedidos", () => {
  const fila = { ...t.Resources.PedidosQueue, Properties: t.Resources.PedidosQueue.Properties ?? {} };
  const dlq = { ...t.Resources.PedidosDlq, Properties: t.Resources.PedidosDlq.Properties ?? {} };

  it("fila pedidos com visibility timeout de 30 s", () => {
    expect(fila.Type).toBe("AWS::SQS::Queue");
    expect(fila.Properties.QueueName).toBe("pedidos");
    expect(fila.Properties.VisibilityTimeout).toBe(30);
  });

  it("DLQ pedidos-dlq após 3 recebimentos", () => {
    expect(dlq.Type).toBe("AWS::SQS::Queue");
    expect(dlq.Properties.QueueName).toBe("pedidos-dlq");
    expect(fila.Properties.RedrivePolicy).toEqual({
      deadLetterTargetArn: { "Fn::GetAtt": ["PedidosDlq", "Arn"] },
      maxReceiveCount: 3,
    });
  });

  it("output com a URL da fila", () => {
    expect(t.Outputs.PedidosQueueUrl.Value).toEqual({ Ref: "PedidosQueue" });
  });
});

describe("template.yaml - Lambda processar-pedido", () => {
  const fn = t.Resources.ProcessarPedidoFunction;
  const p = fn.Properties ?? {};

  it("nodejs22.x, código em dist/, fora de VPC", () => {
    expect(fn.Type).toBe("AWS::Serverless::Function");
    expect(p.FunctionName).toBe("processar-pedido");
    expect(p.Runtime).toBe("nodejs22.x");
    expect(p.Handler).toBe("index.handler");
    expect(p.CodeUri).toBe("dist/processar-pedido/");
    expect(p.VpcConfig).toBeUndefined();
  });

  it("trigger SQS com lote de 5 e ReportBatchItemFailures", () => {
    const ev = p.Events.Pedidos;
    expect(ev.Type).toBe("SQS");
    expect(ev.Properties.Queue).toEqual({ "Fn::GetAtt": ["PedidosQueue", "Arn"] });
    expect(ev.Properties.BatchSize).toBe(5);
    expect(ev.Properties.FunctionResponseTypes).toEqual(["ReportBatchItemFailures"]);
  });

  it("timeout menor que o visibility timeout da fila", () => {
    expect(p.Timeout).toBeLessThan(t.Resources.PedidosQueue.Properties?.VisibilityTimeout);
  });

  it("DATABASE_URL vem de parâmetro NoEcho", () => {
    expect(t.Parameters.DatabaseUrl.NoEcho).toBe(true);
    expect(p.Environment.Variables.DATABASE_URL).toEqual({ Ref: "DatabaseUrl" });
  });

  it("SNS_TOPIC_ARN vem de parâmetro (vazio até o SNS entrar)", () => {
    expect(p.Environment.Variables.SNS_TOPIC_ARN).toEqual({ Ref: "SnsTopicArn" });
    expect(t.Parameters.SnsTopicArn.Default).toBe("");
  });
});
