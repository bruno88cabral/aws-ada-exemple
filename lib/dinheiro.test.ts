import { describe, expect, it } from "vitest";
import { formatarCentavos, reaisParaCentavos } from "@/lib/dinheiro";

describe("reaisParaCentavos", () => {
  it.each([
    ["12,50", 1250],
    ["12.50", 1250],
    ["12", 1200],
    ["12,5", 1250],
    ["0,05", 5],
    ["0", 0],
    ["  7,00 ", 700],
    ["1234,56", 123456],
  ])("%s -> %i", (entrada, esperado) => {
    expect(reaisParaCentavos(entrada)).toBe(esperado);
  });

  it.each(["", " ", "-1", "-0,50", "1,234", "1.234", "abc", "12,", ",50", "1,2,3", "R$ 12", "99999999999"])(
    "rejeita %j",
    (entrada) => {
      expect(() => reaisParaCentavos(entrada)).toThrow();
    },
  );
});

describe("formatarCentavos", () => {
  it.each([
    [1250, "R$ 12,50"],
    [0, "R$ 0,00"],
    [5, "R$ 0,05"],
    [100, "R$ 1,00"],
    [123456, "R$ 1.234,56"],
    [100000000, "R$ 1.000.000,00"],
  ])("%i -> %s", (c, esperado) => {
    expect(formatarCentavos(c)).toBe(esperado);
  });
});
