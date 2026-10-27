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
