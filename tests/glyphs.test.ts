import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { brotliDecompressSync } from "node:zlib";
import { resolveGlyph } from "../server/glyphs.ts";
import { KATEX_GLYPHS_BROTLI_BASE64 } from "../server/vendor/katex-glyphs.ts";

// Captured from 0.1.0's runtime opentype.js renderer before moving extraction to preparation.
// Hashes cover every mapped character's key, SVG path and control-point bounds.
const baseline = {
  "AMS-Regular": {
    "count": 257,
    "sha256": "009d8d37a5f19a4b77bf79e8d7b9dba9b36d64cf045da38e79dd35510381db3c"
  },
  "Caligraphic-Bold": {
    "count": 28,
    "sha256": "a5fb6ca1acbc08c59c7303da6de8a1b114d4c6ade99b3ff8330082b317b76a8e"
  },
  "Caligraphic-Regular": {
    "count": 28,
    "sha256": "c82c2d9b93eb856f71ff6a132daddc876a8586149524d9dc64024ef25faa38f5"
  },
  "Fraktur-Bold": {
    "count": 92,
    "sha256": "ee8301ea4a0836c034503c6bb6d3d38d2471e500b7e993e07f29df5fd385c917"
  },
  "Fraktur-Regular": {
    "count": 93,
    "sha256": "3cd90aab83bd9c9b23ad3893ec6d51e3e5f1c31866d589bef3450c9e5792c8cd"
  },
  "Main-Bold": {
    "count": 277,
    "sha256": "d2ba20f6898c59c5f8e09b1bb19e20137aa511f3f963d9184ecafb013c6ba619"
  },
  "Main-BoldItalic": {
    "count": 127,
    "sha256": "a86ff33cdc4a450a4858d0b7bbbcc641b6a6cf7af58c0c3fbb7cdcaea2755d43"
  },
  "Main-Italic": {
    "count": 128,
    "sha256": "f63c5618397f0847bcf7d3b6a71b5d9afe73a0f11116d2857401c88bb11bfb54"
  },
  "Main-Regular": {
    "count": 283,
    "sha256": "fefd076ea0a50dd37c4b5ebac8b3661db0bbfc674b491a80ba5b96ee62eab0df"
  },
  "Math-BoldItalic": {
    "count": 107,
    "sha256": "605b931b41d1dd0b1e1dae8a19e7ea11d241a54bf021c2c6e4fd2261fd48008a"
  },
  "Math-Italic": {
    "count": 107,
    "sha256": "859f226cafa2d1a191746df4a5a32c049454302d93e6d446dc37e674728040a7"
  },
  "SansSerif-Bold": {
    "count": 120,
    "sha256": "c9179938cee6be044c8f085d8558ccb3c6d0c37e32ebfb8856062a6519d9000c"
  },
  "SansSerif-Italic": {
    "count": 121,
    "sha256": "f4bf92de408b9587fd00db0717f73d798141e27a04c6f43e10f2f82d1d0a946e"
  },
  "SansSerif-Regular": {
    "count": 121,
    "sha256": "fe742678b046d00e58d3456440bda8349ebed7191f9ce75dae0ee2faa50c77b0"
  },
  "Script-Regular": {
    "count": 28,
    "sha256": "dfb9d6e5dd6751c04744d736465c57539c76c717230a76fbdb0fec951101deef"
  },
  "Size1-Regular": {
    "count": 45,
    "sha256": "1bd5b4ee289932a81b465758db55ac6a156cb9bcba9ec88170b5effb49bb885d"
  },
  "Size2-Regular": {
    "count": 37,
    "sha256": "38527e932bd42a41a833c3ecd1b633077ff8340fe86c04d17f3d2216ada45999"
  },
  "Size3-Regular": {
    "count": 21,
    "sha256": "d9d9abc23aca06e979b4b54005aefad11c4585894d0e02d4961252398aaf7d0e"
  },
  "Size4-Regular": {
    "count": 48,
    "sha256": "ae90058128bf6f04600e32f639c330ff4c287e45e26204b94aa2d944fcd4af90"
  },
  "Typewriter-Regular": {
    "count": 127,
    "sha256": "9cf64cefe09259a06f4c42a729db4c2ed63069ebd6518d2c40fd997449e642c4"
  }
};

test("precomputed outlines match all 2195 character lookups from the original renderer", () => {
  assert.deepEqual(Object.keys(KATEX_GLYPHS_BROTLI_BASE64).sort(), Object.keys(baseline).sort());
  for (const [face, expected] of Object.entries(baseline)) {
    const atlas = JSON.parse(brotliDecompressSync(Buffer.from(KATEX_GLYPHS_BROTLI_BASE64[face], "base64")).toString("utf8")) as {
      characters: Record<string, number>;
    };
    const codePoints = Object.keys(atlas.characters).map(Number)
      .filter((code) => atlas.characters[code] !== 0).sort((a, b) => a - b);
    assert.equal(codePoints.length, expected.count, face);
    const glyphs = codePoints.map((code) => [code, resolveGlyph(face, code)]);
    const hash = createHash("sha256").update(JSON.stringify(glyphs)).digest("hex");
    assert.equal(hash, expected.sha256, face);
  }
});

test("unknown faces and missing glyphs preserve the Main-Regular and system-text fallbacks", () => {
  assert.deepEqual(resolveGlyph("Unknown", 0x41), resolveGlyph("Main-Regular", 0x41));
  assert.deepEqual(resolveGlyph("Size4-Regular", 0x41), resolveGlyph("Main-Regular", 0x41));
  assert.equal(resolveGlyph("Main-Regular", 0x1f642), null);
  assert.equal(resolveGlyph("__proto__", 0x41)?.key, resolveGlyph("Main-Regular", 0x41)?.key);
  assert.equal(resolveGlyph("Main-Regular", 0x20)?.outline.d, "");
});
