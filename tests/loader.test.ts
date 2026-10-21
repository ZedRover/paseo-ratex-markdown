import assert from "node:assert/strict";
import { test } from "node:test";
import { FormulaLoader } from "../client/math/loader.ts";
import { MAX_FORMULAS_PER_REQUEST } from "../shared/contracts.ts";
import type { MathScene } from "../shared/scene.ts";

const scene = (width: number): MathScene => ({ width, height: 1, depth: 0, items: [] });

test("formulas requested together share one request, and duplicates one entry", async () => {
  const requests: { latex: string; display: boolean }[][] = [];
  const loader = new FormulaLoader(async ({ formulas }) => {
    requests.push(formulas);
    return {
      results: formulas.map(({ latex }) => (latex === "bad" ? { ok: false as const, error: "ParseError" } : { ok: true as const, scene: scene(latex.length) })),
      glyphs: {},
    };
  });
  const [a, b, again, bad] = await Promise.all([
    loader.load("x", false),
    loader.load("xx", true),
    loader.load("x", false),
    loader.load("bad", true),
  ]);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], [
    { latex: "x", display: false },
    { latex: "xx", display: true },
    { latex: "bad", display: true },
  ]);
  assert.deepEqual(a, again);
  assert.equal(a.ok && a.scene.width, 1);
  assert.equal(b.ok && b.scene.width, 2);
  assert.deepEqual(bad, { ok: false, error: "ParseError" });
});

test("a long document is split into requests of the contract's size", async () => {
  const sizes: number[] = [];
  const loader = new FormulaLoader(async ({ formulas }) => {
    sizes.push(formulas.length);
    return { results: formulas.map(() => ({ ok: true as const, scene: scene(1) })), glyphs: {} };
  });
  await Promise.all(Array.from({ length: MAX_FORMULAS_PER_REQUEST * 2 + 5 }, (_, index) => loader.load(`x_${index}`, false)));
  assert.deepEqual(sizes, [MAX_FORMULAS_PER_REQUEST, MAX_FORMULAS_PER_REQUEST, 5]);
});

test("a failed request rejects every formula in it", async () => {
  const loader = new FormulaLoader(async () => {
    throw new Error("plugin is restarting");
  });
  const results = await Promise.allSettled([loader.load("a", false), loader.load("b", false)]);
  assert.deepEqual(results.map((result) => result.status), ["rejected", "rejected"]);
});
