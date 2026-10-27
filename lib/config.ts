// Config ausente: erro tipado compartilhado por todos os clients lazy
// (pg, S3, SQS, SNS, SES). As rotas o convertem em 503 via lib/http.ts.
export class ConfigAusenteError extends Error {
  readonly variavel: string;

  constructor(variavel: string) {
    super(`${variavel} não configurada`);
    this.name = "ConfigAusenteError";
    this.variavel = variavel;
  }
}

// Lê uma variável de ambiente obrigatória. Só chame dentro de funções
// (nunca no topo do módulo): o build precisa passar sem .env.local.
export function lerEnv(nome: string): string {
  const valor = process.env[nome];
  if (!valor || valor.trim() === "") {
    throw new ConfigAusenteError(nome);
  }
  return valor;
}

// Variável opcional: ausente ou em branco devolve undefined (sem lançar).
export function lerEnvOpcional(nome: string): string | undefined {
  const valor = process.env[nome];
  return valor && valor.trim() !== "" ? valor.trim() : undefined;
}
