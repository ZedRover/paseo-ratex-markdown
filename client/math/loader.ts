import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { MAX_FORMULAS_PER_REQUEST, type renderMathRpc } from "../../shared/contracts.ts";
import type { GlyphOutline, MathScene } from "../../shared/scene.ts";

export type FormulaResult =
  | { ok: true; scene: MathScene; outlines: Readonly<Record<string, GlyphOutline>> }
  | { ok: false; error: string };

type RenderMath = (input: RpcInput<typeof renderMathRpc>) => Promise<RpcOutput<typeof renderMathRpc>>;
type Waiter = { resolve(result: FormulaResult): void; reject(error: unknown): void };
type Pending = { latex: string; display: boolean; waiters: Waiter[] };

/**
 * Collects the formulas a render asks for and sends them to the daemon in as few requests as
 * possible: a document with two hundred formulas costs four round trips, not two hundred.
 */
export class FormulaLoader {
  private readonly pending = new Map<string, Pending>();
  private readonly renderMath: RenderMath;
  private scheduled = false;

  constructor(renderMath: RenderMath) {
    this.renderMath = renderMath;
  }

  load(latex: string, display: boolean): Promise<FormulaResult> {
    return new Promise((resolve, reject) => {
      const key = `${display ? "D" : "T"}${latex}`;
      let entry = this.pending.get(key);
      if (!entry) {
        entry = { latex, display, waiters: [] };
        this.pending.set(key, entry);
      }
      entry.waiters.push({ resolve, reject });
      if (!this.scheduled) {
        this.scheduled = true;
        // After the commit that mounted every formula of the document.
        setTimeout(() => this.flush(), 0);
      }
    });
  }

  private flush(): void {
    this.scheduled = false;
    const batch = [...this.pending.values()];
    this.pending.clear();
    for (let start = 0; start < batch.length; start += MAX_FORMULAS_PER_REQUEST) {
      const chunk = batch.slice(start, start + MAX_FORMULAS_PER_REQUEST);
      this.renderMath({ formulas: chunk.map(({ latex, display }) => ({ latex, display })) }).then(
        ({ results, glyphs }) => {
          chunk.forEach((entry, index) => {
            const result = results[index];
            const value: FormulaResult = !result
              ? { ok: false, error: "The daemon returned no result for this formula." }
              : result.ok
                ? { ok: true, scene: result.scene, outlines: glyphs }
                : result;
            for (const waiter of entry.waiters) waiter.resolve(value);
          });
        },
        (error: unknown) => {
          for (const entry of chunk) for (const waiter of entry.waiters) waiter.reject(error);
        },
      );
    }
  }
}
