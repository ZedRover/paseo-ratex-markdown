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

// Both channels carry the embedded RaTeX assets in server/vendor. npm also carries the
// bundled dependencies; a fresh Git checkout installs the locked production tree without
// lifecycle scripts.
if (!(await exists("node_modules/markdown-it/package.json"))) {
  if (!(await exists("npm-shrinkwrap.json"))) throw new Error("Missing dependency lock. Reinstall the plugin.");
  run(process.platform === "win32" ? "npm.cmd" : "npm", [
    "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund",
  ]);
}

for (const file of [
  "server/vendor/ratex-wasm-bytes.ts",
  "server/vendor/katex-glyphs.ts",
  "server/vendor/ratex_wasm.js",
  "node_modules/markdown-it/package.json",
  "node_modules/markdown-it-footnote/package.json",
]) {
  if (!(await exists(file))) throw new Error(`Missing plugin asset: ${file}. Reinstall the plugin.`);
}
