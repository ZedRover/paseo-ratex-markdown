import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const output = execFileSync(npm, ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
  shell: process.platform === "win32",
});
// Lifecycle scripts may print progress before npm's JSON result.
const [pack] = JSON.parse(output.slice(output.indexOf("[\n")));
const paths = new Set(pack.files.map(({ path }) => path));

const manifest = JSON.parse(readFileSync("paseo-plugin.json", "utf8"));
for (const path of [
  "paseo-plugin.json", "OVERVIEW.md", "README.md", "LICENSE",
  "index.client.tsx", "index.server.ts",
  "server/vendor/ratex-wasm-bytes.ts", "server/vendor/katex-fonts.ts",
  "scripts/prepare-plugin.mjs", "scripts/embed-assets.mjs",
  manifest.icon, ...manifest.media,
  // Bundled dependencies: Paseo compiles the plugin from them without installing anything.
  "node_modules/ratex-wasm/pkg/ratex_wasm.js",
  "node_modules/markdown-it/package.json",
  "node_modules/markdown-it-footnote/package.json",
  "node_modules/opentype.js/package.json",
]) {
  assert.ok(paths.has(path), `Missing published file: ${path}`);
}
for (const path of paths) {
  assert.ok(
    !/^(tests\/|\.github\/|\.env(?:\.|$)|\.npmrc$|package-lock\.json$|types\/)/.test(path),
    `Unexpected published file: ${path}`,
  );
}

// Keep our runtime sources, embedded data included, within what a registry reviewer can inspect.
const runtimeFiles = pack.files.filter(
  ({ path }) =>
    path === "paseo-plugin.json" ||
    /^(?:index\.(?:client|server)\.tsx?$|(?:client|server|shared)\/.*\.[cm]?[jt]sx?$)/.test(path),
);
const runtimeBytes = runtimeFiles.reduce((sum, { size }) => sum + size, 0);
assert.ok(runtimeFiles.length <= 200, "Runtime source count exceeds 200 files");
assert.ok(runtimeBytes <= 2_000_000, `Runtime sources exceed 2 MB: ${runtimeBytes} bytes`);
console.log(`Runtime sources: ${runtimeFiles.length} files, ${runtimeBytes} bytes.`);
console.log(`${pack.name}@${pack.version}: ${pack.entryCount} files, ${pack.unpackedSize} unpacked bytes; package checks passed.`);
