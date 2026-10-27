import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const poolCtor = vi.fn();
vi.mock("pg", () => ({
  Pool: class {
    constructor(opts: unknown) {
      poolCtor(opts);
    }
  },
}));

import { getPool } from "@/lib/db";
import { ConfigAusenteError } from "@/lib/config";

describe("lib/db getPool", () => {
  beforeEach(() => {
    poolCtor.mockClear();
    delete (globalThis as { __padariaPool?: unknown }).__padariaPool;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lança ConfigAusenteError sem DATABASE_URL", () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(() => getPool()).toThrow(ConfigAusenteError);
    expect(() => getPool()).toThrow("DATABASE_URL não configurada");
    expect(poolCtor).not.toHaveBeenCalled();
  });

  it("cria o pool uma vez só com DATABASE_URL", () => {
    vi.stubEnv("DATABASE_URL", "postgres://u:s@h:5432/padaria");
    const a = getPool();
    const b = getPool();
    expect(a).toBe(b);
    expect(poolCtor).toHaveBeenCalledTimes(1);
    expect(poolCtor).toHaveBeenCalledWith({
      connectionString: "postgres://u:s@h:5432/padaria",
    });
  });
});
