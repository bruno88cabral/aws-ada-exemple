import { readFileSync } from "node:fs";
import path from "node:path";
import { parse, type CollectionTag, type ScalarTag } from "yaml";

// Funções intrínsecas do CloudFormation em forma curta. `!Ref x` vira
// { Ref: x }; `!GetAtt A.B` vira { "Fn::GetAtt": ["A", "B"] }; as demais
// viram { "Fn::<Nome>": <valor> }.
const FUNCOES = [
  "Ref", "GetAtt", "Sub", "Join", "Select", "Split", "If", "Equals", "Not",
  "And", "Or", "FindInMap", "GetAZs", "ImportValue", "Base64", "Cidr",
  "Condition", "Transform", "ToJsonString", "Length",
];

function embrulhar(nome: string, valor: unknown): unknown {
  if (nome === "Ref" || nome === "Condition") return { [nome]: valor };
  if (nome === "GetAtt" && typeof valor === "string") {
    const [recurso, ...resto] = valor.split(".");
    return { "Fn::GetAtt": [recurso, resto.join(".")] };
  }
  return { [`Fn::${nome}`]: valor };
}

type Colecao = { toJSON(): unknown };

const tags: Array<ScalarTag | CollectionTag> = FUNCOES.flatMap((nome) => [
  { tag: `!${nome}`, resolve: (v: string) => embrulhar(nome, v) } as ScalarTag,
  { tag: `!${nome}`, collection: "seq", resolve: (c: Colecao) => embrulhar(nome, c.toJSON()) } as unknown as CollectionTag,
  { tag: `!${nome}`, collection: "map", resolve: (c: Colecao) => embrulhar(nome, c.toJSON()) } as unknown as CollectionTag,
]);

export type Recurso = { Type: string; Properties?: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

export type Template = {
  AWSTemplateFormatVersion?: string;
  Transform?: string;
  Parameters: Record<string, { Type: string; Default?: unknown; NoEcho?: boolean }>;
  Resources: Record<string, Recurso>;
  Outputs: Record<string, { Value: unknown; Description?: string }>;
};

export function parseTemplate(yaml: string): Template {
  return parse(yaml, { customTags: tags }) as Template;
}

export function lerTemplate(): Template {
  return parseTemplate(readFileSync(path.join(import.meta.dirname, "..", "template.yaml"), "utf8"));
}

export function recursosDoTipo(t: Template, tipo: string): Array<[string, Recurso]> {
  return Object.entries(t.Resources).filter(([, r]) => r.Type === tipo);
}
