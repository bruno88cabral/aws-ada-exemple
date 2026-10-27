import { Pool } from "pg";
import { lerEnv } from "@/lib/config";

// Um pool por processo, reaproveitado entre hot reloads do `next dev`.
// Lazy: nada acontece no import; sem DATABASE_URL, getPool() lança
// ConfigAusenteError("DATABASE_URL").
const globalComPool = globalThis as typeof globalThis & { __padariaPool?: Pool };

export function getPool(): Pool {
  if (!globalComPool.__padariaPool) {
    globalComPool.__padariaPool = new Pool({
      connectionString: lerEnv("DATABASE_URL"),
    });
  }
  return globalComPool.__padariaPool;
}
