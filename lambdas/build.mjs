// Build das Lambdas: esbuild -> dist/<nome>/index.mjs (CodeUri do template.yaml).
// O esbuild lê os `paths` do tsconfig.json, então o alias `@/` de lib/ funciona.
// `pg` entra no bundle; @aws-sdk/* já existe no runtime nodejs22.x.
import { build } from "esbuild";

// Bundle ESM não tem `require`; o `pg` (CJS) usa require() de módulos do Node.
const banner = `import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);`;

for (const nome of ["processar-pedido"]) {
  await build({
    entryPoints: [`lambdas/${nome}/handler.ts`],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    outfile: `dist/${nome}/index.mjs`,
    external: ["@aws-sdk/*", "pg-native"],
    banner: { js: banner },
    logLevel: "info",
  });
}
