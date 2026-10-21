import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseMarkdown } from "../../client/markdown/parse.ts";
import { listMarkdownFilesIn, readImageIn, readMarkdownFileIn } from "../../server/files.ts";
import { renderMath } from "../../server/render.ts";
import { listMarkdownFilesRpc, readImageRpc, readMarkdownFileRpc, renderMathRpc } from "../../shared/contracts.ts";
import { DEMO, OTHER, PLOT_PNG_BASE64, README } from "./fixture.mjs";

// Browser tools can live in a scratch install instead of the plugin's dependencies:
// RATEX_BROWSER_DEPS=/path/with/esbuild,puppeteer-core,react-dom,react-native-web
// Chrome comes from CHROME_BIN (launched) or CHROME_CDP_URL (an already running browser).
// RATEX_CLIENT_BUNDLE=/file evaluates a client bundle taken from a daemon's plugin catalog.
// RATEX_SCREENSHOTS=/dir also saves the screenshots the README uses.
const root = fileURLToPath(new URL("../../", import.meta.url));
const deps = createRequire(path.join(process.env.RATEX_BROWSER_DEPS || root, "package.json"));
const { build } = deps("esbuild");
const puppeteer = deps("puppeteer-core");
const dependency = (name) => path.dirname(deps.resolve(`${name}/package.json`));
const screenshots = process.env.RATEX_SCREENSHOTS;

const HOST_MODULES = [
  "@getpaseo/plugin", "@getpaseo/plugin/client", "@getpaseo/plugin/client/react-native",
  "@getpaseo/plugin/client/ui", "@tanstack/react-query", "react", "react/jsx-runtime", "react-native", "zod",
];

// The same esbuild configuration Paseo's plugin compiler uses for client bundles.
const plugin = await build({
  entryPoints: [path.join(root, "index.client.tsx")],
  bundle: true, format: "cjs", jsx: "automatic", loader: { ".svg": "text" }, platform: "neutral",
  target: "es2020", mainFields: ["module", "main"], supported: { "async-await": false },
  external: HOST_MODULES, write: false, logLevel: "warning",
});
// RATEX_CLIENT_BUNDLE runs a bundle Paseo itself compiled (its plugin catalog) instead.
const pluginBundle = process.env.RATEX_CLIENT_BUNDLE
  ? await readFile(process.env.RATEX_CLIENT_BUNDLE, "utf8")
  : `(function(require) {\nconst module = { exports: {} };\nconst exports = module.exports;\n${plugin.outputFiles[0].text.replaceAll("get: () => from[key]", "value: from[key]")}\nreturn module.exports;\n})`;

const host = await build({
  entryPoints: [path.join(root, "tests/browser/host.jsx")],
  bundle: true, write: false, format: "esm", jsx: "automatic", logLevel: "warning",
  alias: {
    react: dependency("react"), "react-dom": dependency("react-dom"),
    "react-native": dependency("react-native-web"), "@tanstack/react-query": dependency("@tanstack/react-query"),
    zod: dependency("zod"),
  },
  define: { "process.env.NODE_ENV": '"development"' },
});

const workspace = await realpath(await mkdtemp(path.join(tmpdir(), "ratex-browser-")));
await mkdir(path.join(workspace, "docs", "img"), { recursive: true });
await mkdir(path.join(workspace, "notes"), { recursive: true });
await writeFile(path.join(workspace, "README.md"), README);
await writeFile(path.join(workspace, "docs", "demo.md"), DEMO);
await writeFile(path.join(workspace, "notes", "other.markdown"), OTHER);
await writeFile(path.join(workspace, "docs", "img", "plot.png"), Buffer.from(PLOT_PNG_BASE64, "base64"));

const handlers = {
  [renderMathRpc.name]: [renderMathRpc, (input) => renderMath(input)],
  [listMarkdownFilesRpc.name]: [listMarkdownFilesRpc, () => listMarkdownFilesIn(workspace)],
  [readMarkdownFileRpc.name]: [readMarkdownFileRpc, (input) => readMarkdownFileIn(workspace, input.path, input.knownRevision)],
  [readImageRpc.name]: [readImageRpc, (input) => readImageIn(workspace, input.documentPath, input.src)],
};

const errors = [];
const html = `<!doctype html><html><head><meta charset="utf-8"><title>RaTeX Markdown</title>
<style>html,body{margin:0;height:100%}#root{height:100%}</style></head>
<body><div id="root"></div><script type="module" src="/host.js"></script></body></html>`;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/rpc/")) {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const [contract, handle] = handlers[url.pathname.slice(5)];
      // Paseo validates both sides of every RPC against the shared contract.
      const output = contract.output.parse(await handle(contract.input.parse(JSON.parse(raw))));
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(output));
    } else if (url.pathname.startsWith("/lucide/")) {
      // Real icons when lucide-static is among the browser dependencies, a box otherwise.
      let svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>';
      try {
        svg = await readFile(path.join(dependency("lucide-static"), "icons", path.basename(url.pathname)), "utf8");
      } catch {}
      response.setHeader("Content-Type", "image/svg+xml");
      response.end(svg.replaceAll("currentColor", url.searchParams.get("color") ?? "#888"));
    } else if (url.pathname === "/file") {
      response.end(await readFile(url.searchParams.get("path"), "utf8"));
    } else if (url.pathname === "/host.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(host.outputFiles[0].text);
    } else if (url.pathname === "/plugin.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(pluginBundle);
    } else {
      response.setHeader("Content-Type", "text/html");
      response.end(html);
    }
  } catch (error) {
    errors.push(`${url.pathname}: ${error instanceof Error ? error.stack : error}`);
    response.writeHead(500).end(String(error));
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;

function countFormulas(source) {
  let count = 0;
  const visit = (nodes) => nodes.forEach((node) => (node.type === "math" ? (count += 1) : "children" in node && visit(node.children)));
  const walk = (blocks) =>
    blocks.forEach((block) => {
      if (block.type === "math") count += 1;
      else if (block.type === "paragraph" || block.type === "heading") visit(block.children);
      else if (block.type === "blockquote") walk(block.children);
      else if (block.type === "list") block.items.forEach((item) => walk(item.children));
      else if (block.type === "table") [...block.header, ...block.rows.flat()].forEach(visit);
      else if (block.type === "footnotes") block.items.forEach((item) => walk(item.children));
    });
  walk(parseMarkdown(source).blocks);
  return count;
}
// One formula in the demo is invalid on purpose and stays source text.
const DEMO_IMAGES = countFormulas(DEMO) - 1;
const formulaImages = `img[src^="data:image/svg+xml"]:not([data-icon])`;

let browser;
try {
  browser = process.env.CHROME_CDP_URL
    ? await puppeteer.connect({ browserURL: process.env.CHROME_CDP_URL })
    : await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || assert.fail("Set CHROME_BIN or CHROME_CDP_URL"),
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
        headless: true,
      });

  async function open(query, viewport) {
    const page = await browser.newPage();
    page.on("pageerror", (error) => errors.push(`page: ${error.stack ?? error}`));
    page.on("console", (message) => {
      if (message.type() === "error" && !/Each child in a list|unique "key"/.test(message.text())) {
        errors.push(`console: ${message.text()}`);
      }
    });
    await page.setViewport(viewport);
    await page.goto(`${origin}/?${query}`, { waitUntil: "load" });
    await page.waitForFunction(() => window.registrations, { timeout: 15000 }).catch(() => {
      throw new Error(`The fixture did not start:\n${errors.join("\n")}`);
    });
    return page;
  }
  const settle = (page) => page.waitForFunction(() => window.pendingQueries?.() === 0, { timeout: 15000 });
  const rpcs = (page, name) => page.evaluate((name) => window.rpcCalls.filter((call) => call.name === name), name);
  const shot = async (page, name) => {
    if (screenshots) await page.screenshot({ path: path.join(screenshots, `${name}.png`) });
  };
  // The widest display formula, and the horizontal scroller around it.
  const widestFormula = (page) =>
    page.$$eval(formulaImages, (images) => {
      const widest = images.reduce((a, b) => (b.getBoundingClientRect().width > a.getBoundingClientRect().width ? b : a));
      let scroller = widest.parentElement;
      while (scroller && !["auto", "scroll"].includes(getComputedStyle(scroller).overflowX)) scroller = scroller.parentElement;
      return { image: widest.getBoundingClientRect().width, scroller: scroller?.clientWidth ?? 0, scrollWidth: scroller?.scrollWidth ?? 0 };
    });
  const pressLabel = (page, label) =>
    page.evaluate((label) => document.querySelector(`[aria-label="${label}"]`).click(), label);

  // A. Workspace panel on a wide desktop in the dark theme.
  {
    const page = await open("mode=workspace&theme=dark", { width: 1100, height: 1500, deviceScaleFactor: 1 });
    const registrations = await page.evaluate(() => window.registrations);
    assert.deepEqual(registrations.workspacePanels.map((panel) => panel.id), ["preview"]);
    assert.deepEqual(registrations.commands.map((command) => command.id), ["open-preview"]);
    await page.waitForSelector('[aria-label="Open docs/demo.md"]');
    const listed = await page.$$eval('[aria-label^="Open "]', (nodes) => nodes.map((node) => node.getAttribute("aria-label")));
    assert.deepEqual(listed, ["Open README.md", "Open docs/demo.md", "Open notes/other.markdown"]);

    await pressLabel(page, "Open docs/demo.md");
    await page.waitForFunction((selector, count) => document.querySelectorAll(selector).length === count, { timeout: 15000 }, formulaImages, DEMO_IMAGES);
    await settle(page);
    const renders = await rpcs(page, "math.render");
    assert.equal(renders.length, 1, "every formula of the document goes out in one batch");
    const text = await page.$eval("#root", (node) => node.innerText);
    assert.ok(text.includes("$\\frac{1}{$"), "an invalid formula stays as its source");
    assert.ok(text.includes("Prices like $5 and $10 stay text."));
    for (const heading of ["Typesetting math in Paseo", "Display math", "Distribution", "def gaussian"]) {
      assert.ok(text.includes(heading), `rendered ${heading}`);
    }
    const copied = await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById("root"));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const text = selection.toString();
      selection.removeAllRanges();
      return text;
    });
    for (const source of ["$e^{i\\pi} + 1 = 0$", "\\(\\nabla \\cdot \\vec E = \\frac{\\rho}{\\varepsilon_0}\\)", "$\\mu$"]) {
      assert.ok(copied.includes(source), `selection copies ${source}`);
    }
    const wide = await widestFormula(page);
    assert.ok(wide.image <= wide.scroller, `the widest equation fits a desktop panel: ${JSON.stringify(wide)}`);
    await page.waitForFunction(() => [...document.querySelectorAll("img")].some((node) => node.src.startsWith("data:image/png")), { timeout: 10000 });
    const [image] = await rpcs(page, "files.image");
    assert.deepEqual(image.input, { workspaceId: "workspace", documentPath: "docs/demo.md", src: "img/plot.png" });
    // Inline formulas sit on the line: their image's bottom edge is depth below the baseline.
    const inline = await page.$$eval(formulaImages, (images) =>
      images.filter((node) => getComputedStyle(node).display === "inline-block").map((node) => getComputedStyle(node).verticalAlign),
    );
    assert.ok(inline.length > 10 && inline.every((value) => /^-?[\d.]+px$/.test(value)), `inline alignment ${inline.slice(0, 3)}`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, "workspace-dark");

    // The theme repaints from the cached layouts.
    const darkSource = await page.$eval(formulaImages, (node) => node.src);
    await page.evaluate(() => window.setFixture({ theme: "light" }));
    await page.waitForFunction((selector, previous) => document.querySelector(selector)?.src !== previous, {}, formulaImages, darkSource);
    assert.ok((await page.$eval(formulaImages, (node) => decodeURIComponent(node.src))).includes('fill="#1d1f23"'));
    assert.equal((await rpcs(page, "math.render")).length, 1, "a theme change needs no new layout");
    await shot(page, "workspace-light");

    // An edit on disk shows up through polling, and only the new formula is laid out.
    await appendFile(path.join(workspace, "docs", "demo.md"), "\nAppended: $\\zeta(2) = \\frac{\\pi^2}{6}$.\n");
    await page.waitForFunction((selector, count) => document.querySelectorAll(selector).length === count, { timeout: 15000 }, formulaImages, DEMO_IMAGES + 1);
    const after = await rpcs(page, "math.render");
    assert.equal(after.length, 2);
    assert.deepEqual(after[1].input.formulas, [{ latex: "\\zeta(2) = \\frac{\\pi^2}{6}", display: false }]);
    const unchanged = (await rpcs(page, "files.read")).filter((call) => call.input.knownRevision);
    assert.ok(unchanged.length > 0, "polling sends the known revision");

    // Links: external ones go to the OS, relative Markdown links open in the panel.
    await page.evaluate(() => [...document.querySelectorAll('[role="link"]')].find((node) => node.textContent === "link").click());
    assert.deepEqual(await page.evaluate(() => window.openedUrls), ["https://paseo.sh"]);
    await pressLabel(page, "Choose a Markdown file");
    await page.waitForSelector('[data-testid="modal"] [aria-label="Open README.md"]');
    await page.evaluate(() => document.querySelector('[data-testid="modal"] [aria-label="Open README.md"]').click());
    await page.waitForFunction(() => document.getElementById("root").innerText.includes("Fixture workspace"));
    await page.evaluate(() => [...document.querySelectorAll('[role="link"]')].find((node) => node.textContent === "demo document").click());
    await page.waitForFunction((selector) => document.querySelectorAll(selector).length > 10, { timeout: 15000 }, formulaImages);
    await page.close();
    console.log(`workspace panel: ${DEMO_IMAGES} formulas in one request, copy, scrolling, images, theme, live edits, links`);
  }

  // B. The same panel on a phone-sized window.
  {
    await writeFile(path.join(workspace, "docs", "demo.md"), DEMO);
    const page = await open("mode=workspace&theme=dark&compact=1", { width: 390, height: 1400, deviceScaleFactor: 2 });
    await page.waitForSelector('[aria-label="Open docs/demo.md"]');
    await pressLabel(page, "Open docs/demo.md");
    await page.waitForFunction((selector, count) => document.querySelectorAll(selector).length === count, { timeout: 15000 }, formulaImages, DEMO_IMAGES);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390), "nothing overflows a 390px window");
    const wide = await widestFormula(page);
    assert.ok(wide.image > wide.scroller && wide.scrollWidth > wide.scroller, `the wide equation scrolls: ${JSON.stringify(wide)}`);
    await shot(page, "workspace-compact");
    await page.close();
    console.log("compact layout: no horizontal overflow");
  }

  // C. Paseo 0.13 file panels: the plugin renders inside the file tab instead.
  {
    const file = path.join(workspace, "docs", "demo.md");
    const page = await open(`mode=file&theme=light&file=${encodeURIComponent(file)}`, { width: 1000, height: 1300, deviceScaleFactor: 1 });
    const registrations = await page.evaluate(() => window.registrations);
    assert.deepEqual(registrations.filePanels, [
      { id: "markdown", title: "Markdown (RaTeX)", icon: "Sigma", files: { extensions: ["md", "markdown"] } },
    ]);
    assert.deepEqual(registrations.workspacePanels, [], "file panels replace the workspace panel");
    await page.waitForFunction((selector, count) => document.querySelectorAll(selector).length === count, { timeout: 15000 }, formulaImages, DEMO_IMAGES);
    await page.waitForFunction(() => [...document.querySelectorAll("img")].some((node) => node.src.startsWith("data:image/png")), { timeout: 10000 });
    assert.equal((await rpcs(page, "files.image"))[0].input.documentPath, file);
    await shot(page, "file-panel-light");
    await appendFile(file, "\nMore: $a^2+b^2=c^2$.\n");
    await page.evaluate(() => window.notifyFile({ type: "changed" }));
    await page.waitForFunction((selector, count) => document.querySelectorAll(selector).length === count, { timeout: 15000 }, formulaImages, DEMO_IMAGES + 1);
    await page.evaluate(() => window.notifyFile({ type: "deleted" }));
    await page.waitForFunction(() => document.getElementById("root").innerText.includes("was deleted on disk"));
    assert.equal(await page.$$eval(formulaImages, (nodes) => nodes.length), DEMO_IMAGES + 1, "the last version stays on screen");
    await page.close();
    console.log("file panel: registration, reading, changes and deletion");
  }

  // D. Native clients whose host draws inline SVG icons: one icon per glyph.
  {
    const file = path.join(workspace, "notes", "other.markdown");
    const page = await open(`mode=file&theme=dark&platform=ios&svgIcons=1&file=${encodeURIComponent(file)}`, { width: 700, height: 300, deviceScaleFactor: 2 });
    const [euler] = renderMath({ formulas: [{ latex: "e^{i\\pi} + 1 = 0", display: false }] }).results;
    const icons = euler.ok ? euler.scene.items.filter((item) => item.kind === "glyph" || item.kind === "path").length : -1;
    await page.waitForFunction((count) => document.querySelectorAll('img[data-icon="svg"]').length === count, { timeout: 15000 }, icons);
    assert.equal(await page.$$eval(formulaImages, (nodes) => nodes.length), 0);
    await shot(page, "native-icons");
    await page.close();

    // E. Native clients without SVG icons show TeX and never ask the daemon to lay it out.
    const legacy = await open(`mode=file&theme=dark&platform=android&file=${encodeURIComponent(file)}`, { width: 700, height: 300, deviceScaleFactor: 1 });
    await legacy.waitForFunction(() => document.getElementById("root").innerText.includes("$e^{i\\pi} + 1 = 0$"));
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.deepEqual(await rpcs(legacy, "math.render"), []);
    await legacy.close();
    console.log("native: glyph icons where the host draws SVG, TeX source elsewhere");
  }

  assert.deepEqual(errors, [], "no page, console or RPC errors");
  console.log("browser tests passed");
} finally {
  if (browser) {
    if (process.env.CHROME_CDP_URL) await browser.disconnect();
    else await browser.close();
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(workspace, { recursive: true, force: true });
}
