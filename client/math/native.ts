import { UNITS_PER_EM, type Bounds, type GlyphOutline, type MathScene } from "../../shared/scene.ts";
import { STROKE_WIDTH, fontFamily, num } from "./svg.ts";

/**
 * Native clients draw SVG only through the host's square `Icon`. Each glyph and stretchy path
 * becomes its own icon, centered in a square viewBox, so the drawn squares stay small; rules
 * are plain views and missing characters plain text.
 */
export type NativePart =
  | { kind: "icon"; key: string; svg: string; left: number; top: number; size: number; color: string }
  | { kind: "rule"; key: string; left: number; top: number; width: number; height: number; color: string; dashed: boolean }
  | { kind: "text"; key: string; text: string; left: number; top: number; fontSize: number; color: string; fontFamily: string };

export type NativeFormula = {
  /** The layout box in pixels; parts may overhang it. */
  width: number;
  height: number;
  depth: number;
  parts: NativePart[];
};

/** The host rejects inline SVG above this size. */
const ICON_LIMIT = 64 * 1024;
/** Room around an outline for antialiasing, in font units. */
const ICON_PADDING = 8;

const glyphIcons = new Map<string, { svg: string; viewBox: Bounds }>();

export function nativeFormula(
  scene: MathScene,
  outlines: Readonly<Record<string, GlyphOutline>>,
  { color, fontSize }: { color: string; fontSize: number },
): NativeFormula {
  const scale = fontSize / UNITS_PER_EM;
  const parts: NativePart[] = [];
  scene.items.forEach((item, index) => {
    const key = String(index);
    const paint = item.color ?? color;
    if (item.kind === "glyph") {
      const outline = outlines[item.glyph];
      if (!outline) return;
      const icon = glyphIcon(item.glyph, outline);
      const [vx, vy, side] = icon.viewBox;
      parts.push({
        kind: "icon",
        key,
        svg: icon.svg,
        left: (item.x + vx * item.scale) * scale,
        top: (item.y + vy * item.scale) * scale,
        size: side * item.scale * scale,
        color: paint,
      });
    } else if (item.kind === "rule") {
      parts.push({
        kind: "rule",
        key,
        left: item.x * scale,
        top: item.y * scale,
        width: Math.max(item.width * scale, 1),
        height: Math.max(item.height * scale, 1),
        color: paint,
        dashed: Boolean(item.dashed),
      });
    } else if (item.kind === "path") {
      const stroke = item.fill ? 0 : STROKE_WIDTH / 2;
      const [vx, vy, side] = square([item.bounds[0] - stroke, item.bounds[1] - stroke, item.bounds[2] + stroke, item.bounds[3] + stroke]);
      const paintAttributes = item.fill
        ? `fill="currentColor"`
        : `fill="none" stroke="currentColor" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"`;
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(vx)} ${num(vy)} ${num(side)} ${num(side)}">` +
        item.subpaths.map((d) => `<path d="${d}" ${paintAttributes}/>`).join("") +
        "</svg>";
      if (svg.length > ICON_LIMIT) return;
      parts.push({ kind: "icon", key, svg, left: vx * scale, top: vy * scale, size: side * scale, color: paint });
    } else {
      parts.push({
        kind: "text",
        key,
        text: item.text,
        left: item.x * scale,
        top: (item.y - item.size * 0.88) * scale,
        fontSize: item.size * scale,
        color: paint,
        fontFamily: fontFamily(item.font),
      });
    }
  });
  return {
    width: scene.width * scale,
    height: (scene.height + scene.depth) * scale,
    depth: scene.depth * scale,
    parts,
  };
}

/** One SVG per glyph, shared by every formula that uses it. */
function glyphIcon(key: string, outline: GlyphOutline): { svg: string; viewBox: Bounds } {
  const cached = glyphIcons.get(key);
  if (cached) return cached;
  const [vx, vy, side] = square(outline.bounds);
  const icon = {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(vx)} ${num(vy)} ${num(side)} ${num(side)}"><path d="${outline.d}" fill="currentColor"/></svg>`,
    viewBox: [vx, vy, side, side] as Bounds,
  };
  glyphIcons.set(key, icon);
  return icon;
}

/**
 * The padded square, centered on `bounds`, that the host's square icon draws into. Rounded
 * like the viewBox text, so the icon is placed exactly where its viewBox says.
 */
function square([x0, y0, x1, y1]: Bounds): [number, number, number] {
  const side = Number(num(Math.max(x1 - x0, y1 - y0) + 2 * ICON_PADDING));
  return [Number(num((x0 + x1 - side) / 2)), Number(num((y0 + y1 - side) / 2)), side];
}
