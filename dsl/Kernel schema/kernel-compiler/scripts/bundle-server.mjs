// scripts/bundle-server.mjs
// Bundle the LSP server into a single CJS file for the VS Code extension.
// Usage: node scripts/bundle-server.mjs [outdir]

import * as esbuild from "esbuild";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outdir = process.argv[2] || resolve(__dirname, "..", "..", "kernel-vscode", "server");

await esbuild.build({
  entryPoints: [resolve(__dirname, "..", "src", "lsp", "main.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: resolve(outdir, "server.js"),
  sourcemap: true,
  minify: false,
  logLevel: "info",
});
