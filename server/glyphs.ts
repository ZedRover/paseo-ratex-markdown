import { Buffer } from "node:buffer";
import { brotliDecompressSync } from "node:zlib";
import type { GlyphOutline } from "../shared/scene.ts";
import { KATEX_GLYPHS_BROTLI_BASE64 } from "./vendor/katex-glyphs.ts";

export type ResolvedGlyph = { key: string; outline: GlyphOutline };

/** Distinct (face, character) lookups kept; a document of rare Unicode cannot grow it forever. */
const GLYPH_CACHE_LIMIT = 8192;

type FontAtlas = {
  characters: Record<string, number>;
  outlines: Record<string, GlyphOutline>;
};

const fonts = new Map<string, FontAtlas>();
const glyphs = new Map<string, ResolvedGlyph | null>();

function loadFont(id: string): FontAtlas | null {
  const cached = fonts.get(id);
  if (cached) return cached;
  const encoded = KATEX_GLYPHS_BROTLI_BASE64[id];
  if (!encoded) return null;
  const bytes = brotliDecompressSync(Buffer.from(encoded, "base64"));
  const font: FontAtlas = JSON.parse(bytes.toString("utf8"));
  fonts.set(id, font);
  return font;
}

/**
 * The outline that draws a DisplayList glyph, following ratex-svg's standalone renderer:
 * an unknown face lays out as Main-Regular, mathematical alphanumerics live at ASCII slots,
 * and a character missing from its face falls back to Main-Regular. Null means no KaTeX font
 * has it (CJK in `\text{}`, emoji): the caller draws it as text in a system font.
 */
export function resolveGlyph(fontId: string, charCode: number): ResolvedGlyph | null {
  const cacheKey = `${fontId}:${charCode}`;
  const cached = glyphs.get(cacheKey);
  if (cached !== undefined) return cached;
  const face = Object.hasOwn(KATEX_GLYPHS_BROTLI_BASE64, fontId) ? fontId : "Main-Regular";
  const char = katexTtfGlyphChar(face, charCode);
  const resolved =
    outlineOf(face, char) ?? (face === "Main-Regular" ? null : outlineOf("Main-Regular", char));
  if (glyphs.size >= GLYPH_CACHE_LIMIT) glyphs.clear();
  glyphs.set(cacheKey, resolved);
  return resolved;
}

function outlineOf(fontId: string, char: string): ResolvedGlyph | null {
  const font = loadFont(fontId);
  if (!font) return null;
  const index = font.characters[char.codePointAt(0)!];
  const outline = index ? font.outlines[index] : undefined;
  // Spaces resolve to empty paths, while missing characters fall back to system text.
  return outline ? { key: `${fontId}#${index}`, outline } : null;
}

/** One decimal: TrueType points are integers, implied on-curve points are halves. */
export function num(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

const ALPHANUMERIC_LETTERS: ReadonlyArray<readonly [number, string]> = [
  [0x1d400, "Main-Bold"],
  [0x1d434, "Math-Italic"],
  [0x1d468, "Math-BoldItalic"],
  [0x1d504, "Fraktur-Regular"],
  [0x1d56c, "Fraktur-Bold"],
  [0x1d5a0, "SansSerif-Regular"],
  [0x1d5d4, "SansSerif-Bold"],
  [0x1d608, "SansSerif-Italic"],
  [0x1d670, "Typewriter-Regular"],
];

const ALPHANUMERIC_DIGITS: ReadonlyArray<readonly [number, string]> = [
  [0x1d7ce, "Main-Bold"],
  [0x1d7e2, "SansSerif-Regular"],
  [0x1d7ec, "SansSerif-Bold"],
  [0x1d7f6, "Typewriter-Regular"],
];

/**
 * Port of ratex-font's `font_and_metric_for_mathematical_alphanumeric`: the KaTeX `.ttf`
 * cmaps key U+1D400–U+1D7FF glyphs by ASCII letter and digit.
 */
export function mathematicalAlphanumeric(codePoint: number): [string, number] | null {
  if (codePoint <= 0x7f) return null;
  for (const [base, font] of ALPHANUMERIC_LETTERS) {
    if (codePoint >= base && codePoint < base + 52) {
      const index = codePoint - base;
      return [font, index < 26 ? 0x41 + index : 0x61 + index - 26];
    }
  }
  if (codePoint >= 0x1d538 && codePoint < 0x1d538 + 26) return ["AMS-Regular", 0x41 + codePoint - 0x1d538];
  if (codePoint >= 0x1d49c && codePoint < 0x1d49c + 26) return ["Script-Regular", 0x41 + codePoint - 0x1d49c];
  if (codePoint === 0x1d55c) return ["AMS-Regular", 0x6b];
  for (const [base, font] of ALPHANUMERIC_DIGITS) {
    if (codePoint >= base && codePoint < base + 10) return [font, 0x30 + codePoint - base];
  }
  return null;
}

/** Port of ratex-font's `katex_ttf_glyph_char`: the character to look up in a face's cmap. */
export function katexTtfGlyphChar(fontId: string, codePoint: number): string {
  const mapped = mathematicalAlphanumeric(codePoint);
  return String.fromCodePoint(mapped && mapped[0] === fontId ? mapped[1] : codePoint);
}
