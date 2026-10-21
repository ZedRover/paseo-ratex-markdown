import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { renderMathRpc } from "../shared/contracts.ts";
import { sceneSchema, type GlyphOutline } from "../shared/scene.ts";
import { layoutLatex, messageOf } from "./ratex.ts";
import { buildScene } from "./scene.ts";

type Result = RpcOutput<typeof renderMathRpc>["results"][number];
type Entry = { result: Result; glyphs: Map<string, GlyphOutline>; weight: number };

/** Bounded so a long editing session cannot grow the daemon's heap without limit. */
const CACHE_LIMIT = 2048;
// A count cap alone would let a few hundred huge matrices occupy the heap.
const CACHE_WEIGHT_LIMIT = 16 * 1024 * 1024;

const cache = new Map<string, Entry>();
let cacheWeight = 0;

export function renderMath({ formulas }: RpcInput<typeof renderMathRpc>): RpcOutput<typeof renderMathRpc> {
  const glyphs: Record<string, GlyphOutline> = {};
  const results = formulas.map(({ latex, display }) => {
    const entry = render(latex, display);
    for (const [key, outline] of entry.glyphs) glyphs[key] = outline;
    return entry.result;
  });
  return { results, glyphs };
}

function render(latex: string, display: boolean): Entry {
  const key = `${display ? "D" : "T"}${latex}`;
  const cached = cache.get(key);
  if (cached) {
    // Re-insert so eviction drops the least recently used formula first.
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  let entry: Entry;
  try {
    const { scene, glyphs } = buildScene(layoutLatex(latex, display));
    // Paseo validates the whole response against the contract; a scene it would reject has to
    // fail here, on its own, instead of failing every formula in the batch.
    if (!sceneSchema.safeParse(scene).success) throw new Error("RaTeX produced a layout that cannot be drawn.");
    entry = { result: { ok: true, scene }, glyphs, weight: 0 };
  } catch (error) {
    entry = { result: { ok: false, error: messageOf(error) }, glyphs: new Map(), weight: 0 };
  }
  // UTF-16 length of the serialized result: an accounting unit, not a heap measurement.
  entry.weight = 2 * (key.length + JSON.stringify(entry.result).length);
  store(key, entry);
  return entry;
}

function store(key: string, entry: Entry): void {
  if (entry.weight > CACHE_WEIGHT_LIMIT / 16) return;
  while (cache.size >= CACHE_LIMIT || cacheWeight + entry.weight > CACHE_WEIGHT_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cacheWeight -= cache.get(oldest.value)!.weight;
    cache.delete(oldest.value);
  }
  cache.set(key, entry);
  cacheWeight += entry.weight;
}

/** Test seam: the cache is process-wide and would otherwise hide a fresh layout. */
export function clearRenderCache(): void {
  cache.clear();
  cacheWeight = 0;
}
