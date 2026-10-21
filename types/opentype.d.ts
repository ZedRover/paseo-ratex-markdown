// The subset of opentype.js 2.0 that server/glyphs.ts uses; the package ships no types.
declare module "opentype.js" {
  export type PathCommand =
    | { type: "M" | "L"; x: number; y: number }
    | { type: "Q"; x1: number; y1: number; x: number; y: number }
    | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: "Z" };

  export interface Path {
    commands: PathCommand[];
  }

  export interface Glyph {
    /** 0 is `.notdef`: the font has no glyph for the character. */
    index: number;
    /** Commands at `fontSize`, y growing downwards from the baseline origin (x, y). */
    getPath(x: number, y: number, fontSize: number): Path;
  }

  export interface Font {
    unitsPerEm: number;
    charToGlyph(char: string): Glyph;
  }

  const opentype: { parse(buffer: ArrayBuffer): Font };
  export default opentype;
}
