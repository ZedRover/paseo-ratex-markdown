import assert from "node:assert/strict";
import { test } from "node:test";
import { katexTtfGlyphChar, mathematicalAlphanumeric, resolveGlyph } from "../server/glyphs.ts";
import { clearRenderCache, renderMath } from "../server/render.ts";
import { formulaImage, sceneToSvg } from "../client/math/svg.ts";
import { nativeFormula } from "../client/math/native.ts";
import type { MathScene } from "../shared/scene.ts";

function render(latex: string, display = true) {
  const output = renderMath({ formulas: [{ latex, display }] });
  const [result] = output.results;
  assert.ok(result.ok, `${latex}: ${result.ok ? "" : result.error}`);
  return { scene: result.scene, glyphs: output.glyphs };
}

test("lays out a formula into glyphs and rules with shared outlines", () => {
  const { scene, glyphs } = render("\\frac{a}{b}");
  assert.ok(scene.width > 0 && scene.height > 0 && scene.depth > 0);
  const kinds = scene.items.map((item) => item.kind);
  assert.deepEqual([...new Set(kinds)].sort(), ["glyph", "rule"]);
  for (const item of scene.items) {
    if (item.kind === "glyph") {
      assert.ok(glyphs[item.glyph], `outline for ${item.glyph}`);
      assert.match(glyphs[item.glyph].d, /^M[\d.\- ]+/);
    }
  }
});

test("inline and display styles differ", () => {
  assert.notDeepEqual(render("\\sum_{i=1}^n i", true).scene, render("\\sum_{i=1}^n i", false).scene);
});

test("the default color is left to the client, explicit colors are kept", () => {
  const { scene } = render("\\color{red}{x} y", false);
  assert.ok(scene.items.every((item) => item.color === "#ff0000"));
  assert.ok(render("x", false).scene.items.every((item) => item.color === undefined));
});

test("parse errors come back per formula without failing the batch", () => {
  const output = renderMath({
    formulas: [
      { latex: "\\frac{1}{2", display: true },
      { latex: "x", display: false },
    ],
  });
  assert.equal(output.results[0].ok, false);
  assert.match(output.results[0].ok ? "" : output.results[0].error, /ParseError/);
  assert.equal(output.results[1].ok, true);
});

test("math alphanumerics map to the ASCII slots of their KaTeX face", () => {
  assert.deepEqual(mathematicalAlphanumeric(0x1d400), ["Main-Bold", 0x41]);
  assert.deepEqual(mathematicalAlphanumeric(0x1d7ce), ["Main-Bold", 0x30]);
  assert.equal(katexTtfGlyphChar("Main-Bold", 0x1d400), "A");
  assert.equal(katexTtfGlyphChar("Main-Regular", 0x1d400), "\u{1d400}");
  assert.match(resolveGlyph("Main-Bold", 0x1d400)?.key ?? "", /^Main-Bold#/);
  const blackboard = render("\\mathbb{R}", false).scene.items[0];
  assert.equal(blackboard.kind, "glyph");
});

test("characters no KaTeX font has are drawn as text", () => {
  const { scene } = render("\\text{面积}", false);
  assert.deepEqual(
    scene.items.map((item) => (item.kind === "text" ? item.text : item.kind)),
    ["面", "积"],
  );
  assert.equal(resolveGlyph("CJK-Regular", "面".codePointAt(0)!), null);
});

test("stretchy paths are split into subpaths", () => {
  const { scene } = render("\\overbrace{a+b}^{n}");
  const path = scene.items.find((item) => item.kind === "path");
  assert.ok(path && path.kind === "path");
  assert.ok(path.subpaths.length >= 1 && path.subpaths.every((d) => d.startsWith("M")));
});

test("results are cached", () => {
  clearRenderCache();
  const first = render("e^{i\\pi}+1=0");
  const second = render("e^{i\\pi}+1=0");
  assert.equal(first.scene, second.scene);
});

test("SVG covers the layout box and its ink, and paints the theme color", () => {
  const { scene, glyphs } = render("\\int_0^1 f", true);
  const { svg, bounds } = sceneToSvg(scene, glyphs, { color: "#123456", fontSize: 20 });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[^"]+">/);
  assert.ok(svg.includes('fill="#123456"'));
  assert.ok(!svg.includes("<script") && !svg.includes("undefined") && !svg.includes("NaN"));
  assert.ok(bounds[0] < 0, "the integral overhangs the left of its box");
  assert.ok(bounds[2] >= scene.width && bounds[3] >= scene.height + scene.depth);
  const image = formulaImage(scene, glyphs, { color: "red", fontSize: 20 });
  assert.match(image.uri, /^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  assert.ok(image.overhang.left > 0 && image.overhang.top >= 0 && image.overhang.right >= 0);
  assert.equal(image.depth, (scene.depth * 20) / 1000);
});

test("SVG keeps thin rules at least a pixel thick and escapes text", () => {
  const scene: MathScene = {
    width: 1000,
    height: 500,
    depth: 0,
    items: [
      { kind: "rule", x: 0, y: 100, width: 1000, height: 10 },
      { kind: "text", text: "<&>", font: "CJK-Regular", x: 0, y: 400, size: 1000 },
    ],
  };
  const { svg } = sceneToSvg(scene, {}, { color: "a\"b", fontSize: 10 });
  assert.ok(svg.includes('height="100"'), "a 10-unit rule is 1px at 10px per em: 100 units");
  assert.ok(svg.includes("&lt;&amp;&gt;"));
  assert.ok(svg.includes('fill="a&quot;b"'));
});

test("native layout places each glyph icon over its outline", () => {
  const { scene, glyphs } = render("x^2", false);
  const formula = nativeFormula(scene, glyphs, { color: "#000", fontSize: 10 });
  assert.equal(formula.width, scene.width / 100);
  const icons = formula.parts.filter((part) => part.kind === "icon");
  assert.equal(icons.length, 2);
  for (const icon of icons) {
    assert.ok(icon.kind === "icon" && icon.size > 0 && icon.svg.length < 64 * 1024);
    assert.match(icon.kind === "icon" ? icon.svg : "", /viewBox="[\d.\- ]+"><path d="M/);
  }
  // The superscript is smaller than the base.
  assert.ok(icons[1].kind === "icon" && icons[0].kind === "icon" && icons[1].size < icons[0].size);
});

test("an oversized or overflowing formula fails alone", () => {
  const output = renderMath({
    formulas: [
      { latex: `\\rule{1${"0".repeat(305)}em}{1em}`, display: false },
      { latex: "\\rule{99999em}{1em}", display: false },
      { latex: "\\xrightarrow{a}".repeat(260), display: true },
      { latex: "x+1", display: false },
    ],
  });
  for (const result of output.results.slice(0, 3)) {
    assert.equal(result.ok, false);
    assert.equal(result.ok ? "" : result.error, "This formula is too large to draw.");
  }
  assert.equal(output.results[3].ok, true);
});
