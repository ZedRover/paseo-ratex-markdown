import { Buffer } from "node:buffer";
import { brotliDecompressSync } from "node:zlib";
import opentype, { type Font } from "opentype.js";
import { UNITS_PER_EM, type Bounds, type GlyphOutline } from "../shared/scene.ts";
import { KATEX_FONTS_BROTLI_BASE64 } from "./vendor/katex-fonts.ts";

export type ResolvedGlyph = { key: string; outline: GlyphOutline };

/** Distinct (face, character) lookups kept; a document of rare Unicode cannot grow it forever. */
const GLYPH_CACHE_LIMIT = 8192;

const fonts = new Map<string, Font>();
const glyphs = new Map<string, ResolvedGlyph | null>();

function loadFont(id: string): Font | null {
  const cached = fonts.get(id);
  if (cached) return cached;
  const encoded = KATEX_FONTS_BROTLI_BASE64[id];
  if (!encoded) return null;
  const bytes = brotliDecompressSync(Buffer.from(encoded, "base64"));
  const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
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
  const face = KATEX_FONTS_BROTLI_BASE64[fontId] ? fontId : "Main-Regular";
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
  const glyph = font.charToGlyph(char);
  if (glyph.index === 0) return null;
  const { commands } = glyph.getPath(0, 0, UNITS_PER_EM);
  const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  let d = "";
  for (const command of commands) {
    if (command.type === "Z") {
      d += "Z";
      continue;
    }
    if (command.type === "C") {
      include(bounds, command.x1, command.y1);
      include(bounds, command.x2, command.y2);
      d += `C${num(command.x1)} ${num(command.y1)} ${num(command.x2)} ${num(command.y2)} `;
    } else if (command.type === "Q") {
      include(bounds, command.x1, command.y1);
      d += `Q${num(command.x1)} ${num(command.y1)} `;
    } else {
      d += command.type;
    }
    include(bounds, command.x, command.y);
    d += `${num(command.x)} ${num(command.y)}`;
  }
  // Spaces have no contours; they still resolve, so they are not drawn as text.
  return {
    key: `${fontId}#${glyph.index}`,
    outline: { d, bounds: d ? bounds : [0, 0, 0, 0] },
  };
}

function include(bounds: Bounds, x: number, y: number): void {
  bounds[0] = Math.min(bounds[0], x);
  bounds[1] = Math.min(bounds[1], y);
  bounds[2] = Math.max(bounds[2], x);
  bounds[3] = Math.max(bounds[3], y);
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
