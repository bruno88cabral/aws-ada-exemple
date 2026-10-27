import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adicionar, CHAVE_CARRINHO, limpar, listar } from "@/lib/carrinho";

function criarStorage() {
  const dados = new Map<string, string>();
  return {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => void dados.set(k, v),
    removeItem: (k: string) => void dados.delete(k),
  };
}

const pao = { itemId: "a", nome: "Pão", valorCents: 150 };

describe("lib/carrinho (browser)", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: criarStorage() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("começa vazio", () => {
    expect(listar()).toEqual([]);
  });

  it("adiciona e lista", () => {
    adicionar(pao, 2);
    expect(listar()).toEqual([{ ...pao, quantidade: 2 }]);
  });

  it("soma a quantidade do mesmo item", () => {
    adicionar(pao);
    adicionar(pao, 3);
    expect(listar()).toEqual([{ ...pao, quantidade: 4 }]);
  });

  it("mantém itens distintos", () => {
    adicionar(pao);
    adicionar({ itemId: "b", nome: "Bolo", valorCents: 1200 });
    expect(listar().map((i) => i.itemId)).toEqual(["a", "b"]);
  });

  it("ignora quantidade inválida", () => {
    adicionar(pao, 0);
    adicionar(pao, -2);
    adicionar(pao, Number.NaN);
    expect(listar()).toEqual([]);
  });

  it("limpar esvazia", () => {
    adicionar(pao);
    limpar();
    expect(listar()).toEqual([]);
  });

  it("JSON corrompido ou formato errado vira vazio", () => {
    window.localStorage.setItem(CHAVE_CARRINHO, "{nao-json");
    expect(listar()).toEqual([]);
    window.localStorage.setItem(CHAVE_CARRINHO, JSON.stringify([{ itemId: 1 }, null]));
    expect(listar()).toEqual([]);
  });
});

describe("lib/carrinho (SSR, sem window)", () => {
  it("não lança e não faz nada", () => {
    expect(typeof window).toBe("undefined");
    expect(listar()).toEqual([]);
    expect(adicionar(pao)).toEqual([]);
    expect(() => limpar()).not.toThrow();
  });
});
