import { access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Runs as the manifest's build command when Paseo installs or updates the plugin.
const root = fileURLToPath(new URL("../", import.meta.url));

async function exists(relative) {
  try {
    await access(new URL(relative, new URL("../", import.meta.url)));
    return true;
  } catch {
    return false;
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// A fresh Git checkout has no generated assets: install the locked production tree
// without lifecycle scripts, then embed them. npm carries the shrinkwrap, generated
// assets and bundled dependencies, so that channel needs no installation step here.
if (!(await exists("server/vendor/ratex-wasm-bytes.ts")) || !(await exists("server/vendor/katex-glyphs.ts"))) {
  if (!(await exists("npm-shrinkwrap.json"))) throw new Error("Missing dependency lock. Reinstall the plugin.");
  run(process.platform === "win32" ? "npm.cmd" : "npm", [
    "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund",
  ]);
  run(process.execPath, ["scripts/embed-assets.mjs"]);
}

for (const file of [
  "server/vendor/ratex-wasm-bytes.ts",
  "server/vendor/katex-glyphs.ts",
  "node_modules/ratex-wasm/pkg/ratex_wasm.js",
  "node_modules/markdown-it/package.json",
  "node_modules/markdown-it-footnote/package.json",
]) {
  if (!(await exists(file))) throw new Error(`Missing plugin asset: ${file}. Reinstall the plugin.`);
}
