// Dinheiro em centavos inteiros, nunca float. Funções puras.

export class ValorInvalidoError extends Error {
  constructor(entrada: string) {
    super(`valor inválido: "${entrada}"`);
    this.name = "ValorInvalidoError";
  }
}

// "12,50" | "12.50" | "12" -> 1250. Rejeita vazio, negativo, letras e
// mais de 2 casas decimais (lança ValorInvalidoError).
export function reaisParaCentavos(entrada: string): number {
  const texto = entrada.trim();
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(texto);
  if (!m) throw new ValorInvalidoError(entrada);
  const reais = Number(m[1]);
  const centavos = Number((m[2] ?? "").padEnd(2, "0"));
  const total = reais * 100 + centavos;
  if (!Number.isSafeInteger(total) || total > 2_147_483_647) {
    throw new ValorInvalidoError(entrada); // coluna integer do Postgres
  }
  return total;
}

// 1250 -> "R$ 12,50"; 123456 -> "R$ 1.234,56".
export function formatarCentavos(centavos: number): string {
  const negativo = centavos < 0;
  const abs = Math.abs(Math.trunc(centavos));
  const reais = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const cents = String(abs % 100).padStart(2, "0");
  return `${negativo ? "-" : ""}R$ ${reais},${cents}`;
}
