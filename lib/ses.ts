import { SESv2Client } from "@aws-sdk/client-sesv2";
import { lerEnv } from "@/lib/config";

declare global {
  var __padariaSes: SESv2Client | undefined;
}

// Client lazy (nunca no import). Credenciais: cadeia padrão do SDK (na Lambda, a role).
export function getSes(): SESv2Client {
  if (!globalThis.__padariaSes) {
    globalThis.__padariaSes = new SESv2Client({ region: lerEnv("AWS_REGION") });
  }
  return globalThis.__padariaSes;
}
