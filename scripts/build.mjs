import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
const alias = {
  "@antithesishq/bombadil/internal": "./vendor/bombadil-api/internal.ts",
  "@antithesishq/bombadil/actions": "./vendor/bombadil-api/actions.ts",
  "@antithesishq/bombadil": "./vendor/bombadil-api/index.ts",
};
execFileSync(
  process.env.CARGO || "cargo",
  [
    "build",
    "--locked",
    "--target",
    "wasm32-unknown-unknown",
    "--release",
    "-p",
    "bombadil-sandbox-runtime",
  ],
  { stdio: "inherit" },
);
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/main.ts"],
  outdir: "dist",
  bundle: true,
  format: "esm",
  target: "es2022",
  alias,
  sourcemap: true,
});
await build({
  entryPoints: ["src/worker.ts"],
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "es2022",
  alias,
  sourcemap: true,
});
await build({
  entryPoints: ["src/evaluator.ts"],
  outfile: "tests/evaluator.bundle.mjs",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  alias,
});
await build({
  entryPoints: [
    "src/frames.ts",
    "src/model.ts",
    "src/examples.ts",
    "src/diagnostics.ts",
    "src/application.ts",
  ],
  outdir: "tests/build",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
});
const { standaloneDocument } = await import("../tests/build/frames.js");
const { brokenCode, fixedCode } = await import("../tests/build/model.js");
await writeFile("dist/todomvc.html", standaloneDocument(brokenCode, fixedCode));
await copyFile(
  "target/wasm32-unknown-unknown/release/bombadil_sandbox_runtime.wasm",
  "dist/evaluator.wasm",
);
console.log("Built static playground in dist/");
