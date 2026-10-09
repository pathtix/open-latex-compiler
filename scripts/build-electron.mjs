// Bundles the server and the Electron main/preload scripts into dist-electron/.
import { build } from "esbuild";

const common = { bundle: true, platform: "node", target: "node22", logLevel: "warning" };
// CommonJS dependencies (express, multer…) call require(), which plain ES modules lack.
const requireShim = { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' };

await Promise.all([
  build({ ...common, entryPoints: ["server/index.ts"], outfile: "dist-electron/server.mjs", format: "esm", banner: requireShim, external: ["vite"] }),
  build({ ...common, entryPoints: ["electron/main.ts"], outfile: "dist-electron/main.mjs", format: "esm", external: ["electron"] }),
  build({ ...common, entryPoints: ["electron/preload.ts"], outfile: "dist-electron/preload.cjs", format: "cjs", external: ["electron"] }),
]);
