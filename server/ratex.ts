import { Buffer } from "node:buffer";
import { brotliDecompressSync } from "node:zlib";
import type { DisplayList } from "ratex-wasm";
import { initSync, renderLatexWithOptions } from "../node_modules/ratex-wasm/pkg/ratex_wasm.js";
import { RATEX_WASM_BROTLI_BASE64 } from "./vendor/ratex-wasm-bytes.ts";

/**
 * RaTeX colors every item it lays out. Laying out in this unlikely color lets the scene tell
 * the document's text color (which the client picks per theme) apart from an explicit `\color`.
 */
export const LAYOUT_COLOR = { r: 1, g: 2, b: 3 } as const;

let initFailure: Error | null = null;
let initialized = false;

function initialize(): void {
  if (initialized) return;
  // A broken embedded binary fails the same way every time; do not recompile it per formula.
  if (initFailure) throw initFailure;
  try {
    initSync({ module: brotliDecompressSync(Buffer.from(RATEX_WASM_BROTLI_BASE64, "base64")) });
    initialized = true;
  } catch (error) {
    initFailure = new Error(`RaTeX failed to initialize: ${messageOf(error)}. Reload the plugin.`);
    throw initFailure;
  }
}

/** Parses and lays out one formula. Throws RaTeX's parse error message on invalid input. */
export function layoutLatex(latex: string, display: boolean): DisplayList {
  initialize();
  const { r, g, b } = LAYOUT_COLOR;
  let json: string;
  try {
    json = renderLatexWithOptions(latex, {
      displayMode: display,
      color: { r: r / 255, g: g / 255, b: b / 255, a: 1 },
    });
  } catch (error) {
    // wasm-bindgen rejects with the Rust error string, not an Error.
    throw new Error(messageOf(error));
  }
  const list = JSON.parse(json) as DisplayList;
  if (
    !Number.isFinite(list.width) ||
    !Number.isFinite(list.height) ||
    !Number.isFinite(list.depth) ||
    !Array.isArray(list.items)
  ) {
    throw new Error("RaTeX returned an invalid layout");
  }
  return list;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
