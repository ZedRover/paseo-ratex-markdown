import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { relative, resolve } from "node:path";
import ts from "typescript";

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
  "paseo-plugin.json", "OVERVIEW.md", "README.md", "LICENSE", "npm-shrinkwrap.json",
  "index.client.tsx", "index.server.ts",
  "server/vendor/ratex-wasm-bytes.ts", "server/vendor/katex-glyphs.ts", "server/vendor/ratex_wasm.js",
  "scripts/prepare-plugin.mjs", "scripts/embed-assets.mjs",
  manifest.icon, ...manifest.media,
  // Bundled dependencies: Paseo compiles the plugin from them without installing anything.
  "node_modules/markdown-it/package.json",
  "node_modules/markdown-it-footnote/package.json",
]) {
  assert.ok(paths.has(path), `Missing published file: ${path}`);
}
// The embedded assets replace these at runtime; they are only needed to regenerate them.
for (const path of paths) {
  assert.ok(!/^node_modules\/(?:ratex-wasm|opentype\.js)\//.test(path), `Development dependency published: ${path}`);
}
const shrinkwrap = JSON.parse(readFileSync("npm-shrinkwrap.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
assert.equal(shrinkwrap.version, pkg.version, "Shrinkwrap version must match package.json");
assert.equal(shrinkwrap.packages[""].version, pkg.version);
assert.deepEqual(shrinkwrap.packages[""].dependencies, pkg.dependencies);
for (const path of paths) {
  assert.ok(
    !/^(tests\/|\.github\/|\.env(?:\.|$)|\.npmrc$|package-lock\.json$|types\/)/.test(path),
    `Unexpected published file: ${path}`,
  );
}

// Include reachable bundled dependencies, not just our own source directories. Both code
// and declaration resolutions count, so this is a conservative bound on the registry scan.
const published = new Map(pack.files.map((file) => [file.path, file]));
const visited = new Set();
const pending = ["paseo-plugin.json", "index.client.tsx", "index.server.ts"];
const hostModules = /^(?:@getpaseo\/plugin|@tanstack\/react-query|react|react-native|zod)(?:\/|$)/;
const options = { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true };
let runtimeBytes = 0;
while (pending.length) {
  const file = pending.pop();
  if (visited.has(file)) continue;
  const entry = published.get(file);
  assert.ok(entry, `Runtime import missing from the package: ${file}`);
  assert.ok(file.split("/").length - 1 <= 6, `Runtime import exceeds six directory levels: ${file}`);
  visited.add(file);
  runtimeBytes += entry.size;
  if (file.endsWith(".json")) continue;
  const content = readFileSync(file, "utf8");
  const { importedFiles, referencedFiles } = ts.preProcessFile(content, true, true);
  for (const { fileName: specifier } of [...importedFiles, ...referencedFiles]) {
    if (isBuiltin(specifier) || hostModules.test(specifier)) continue;
    const resolutions = new Set();
    for (const noDtsResolution of [false, true]) {
      const result = ts.resolveModuleName(specifier, resolve(file), { ...options, noDtsResolution }, ts.sys);
      if (result.resolvedModule) resolutions.add(result.resolvedModule.resolvedFileName);
    }
    assert.ok(resolutions.size, `Unresolved runtime import ${specifier} from ${file}`);
    for (const resolvedFile of resolutions) pending.push(relative(process.cwd(), resolvedFile).replaceAll("\\", "/"));
  }
}
assert.ok(visited.size <= 200, `Runtime source count exceeds 200 files: ${visited.size}`);
assert.ok(runtimeBytes <= 2_000_000, `Runtime graph exceeds 2 MB: ${runtimeBytes} bytes`);
console.log(`Published runtime graph: ${visited.size} files, ${runtimeBytes} bytes (code and types).`);
console.log(`${pack.name}@${pack.version}: ${pack.entryCount} files, ${pack.unpackedSize} unpacked bytes; package checks passed.`);
