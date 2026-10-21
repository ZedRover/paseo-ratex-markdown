import { UNITS_PER_EM, type Bounds, type GlyphOutline, type MathScene } from "../../shared/scene.ts";

/** ratex-svg's stroke for unfilled paths: 1.5 user units at its default 40px em. */
export const STROKE_WIDTH = 37.5;

export type DrawOptions = {
  /** CSS color of everything without a `\color` of its own. */
  color: string;
  /** CSS pixels per em. */
  fontSize: number;
};

/** A formula drawn as an SVG image, sized in CSS pixels. */
export type FormulaImage = {
  uri: string;
  width: number;
  height: number;
  /**
   * Ink beyond the layout box on each side (italic overhang, large operators). The image is
   * this much bigger than the box the surrounding text should flow around.
   */
  overhang: { left: number; top: number; right: number; bottom: number };
  /** The layout box's depth below the baseline. */
  depth: number;
};

export function formulaImage(
  scene: MathScene,
  outlines: Readonly<Record<string, GlyphOutline>>,
  options: DrawOptions,
): FormulaImage {
  const { svg, bounds } = sceneToSvg(scene, outlines, options);
  const scale = options.fontSize / UNITS_PER_EM;
  const [minX, minY, maxX, maxY] = bounds;
  return {
    uri: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width: (maxX - minX) * scale,
    height: (maxY - minY) * scale,
    overhang: {
      left: -minX * scale,
      top: -minY * scale,
      right: (maxX - scene.width) * scale,
      bottom: (maxY - scene.height - scene.depth) * scale,
    },
    depth: scene.depth * scale,
  };
}

/** The SVG document and the ink bounds its viewBox covers, in scene units. */
export function sceneToSvg(
  scene: MathScene,
  outlines: Readonly<Record<string, GlyphOutline>>,
  { color, fontSize }: DrawOptions,
): { svg: string; bounds: Bounds } {
  const pixel = UNITS_PER_EM / fontSize;
  const bounds: Bounds = [0, 0, scene.width, scene.height + scene.depth];
  const ids = new Map<string, string>();
  let defs = "";
  let body = "";
  for (const item of scene.items) {
    const fill = attribute(item.color ?? color);
    if (item.kind === "glyph") {
      const outline = outlines[item.glyph];
      if (!outline) continue;
      let id = ids.get(item.glyph);
      if (!id) {
        id = `g${ids.size}`;
        ids.set(item.glyph, id);
        defs += `<path id="${id}" d="${outline.d}"/>`;
      }
      const [x0, y0, x1, y1] = outline.bounds;
      include(bounds, item.x + x0 * item.scale, item.y + y0 * item.scale, item.x + x1 * item.scale, item.y + y1 * item.scale);
      const scale = item.scale === 1 ? "" : ` scale(${item.scale})`;
      body += `<use href="#${id}" transform="translate(${num(item.x)} ${num(item.y)})${scale}" fill="${fill}"/>`;
    } else if (item.kind === "rule") {
      // KaTeX keeps rules at least a pixel thick (min-height: 1px), so thin fraction bars stay visible.
      const height = Math.max(item.height, pixel);
      const width = Math.max(item.width, pixel);
      const x = item.x - (width - item.width) / 2;
      const y = item.y - (height - item.height) / 2;
      include(bounds, x, y, x + width, y + height);
      if (item.dashed) {
        const center = num(y + height / 2);
        body += `<line x1="${num(x)}" y1="${center}" x2="${num(x + width)}" y2="${center}" stroke="${fill}" stroke-width="${num(height)}" stroke-dasharray="${num(height * 3)} ${num(height * 3)}"/>`;
      } else {
        body += `<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" fill="${fill}"/>`;
      }
    } else if (item.kind === "path") {
      const [x0, y0, x1, y1] = item.bounds;
      const stroke = item.fill ? 0 : STROKE_WIDTH / 2;
      include(bounds, x0 - stroke, y0 - stroke, x1 + stroke, y1 + stroke);
      const paint = item.fill
        ? `fill="${fill}"`
        : `fill="none" stroke="${fill}" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"`;
      for (const subpath of item.subpaths) body += `<path d="${subpath}" ${paint}/>`;
    } else {
      include(bounds, item.x, item.y - item.size * 0.88, item.x + item.size, item.y + item.size * 0.12);
      body += `<text x="${num(item.x)}" y="${num(item.y)}" font-size="${num(item.size)}" font-family="${fontFamily(item.font)}" fill="${fill}">${escapeText(item.text)}</text>`;
    }
  }
  // Room for antialiasing at the edges.
  bounds[0] -= pixel;
  bounds[1] -= pixel;
  bounds[2] += pixel;
  bounds[3] += pixel;
  const [minX, minY, maxX, maxY] = bounds;
  const viewBox = `${num(minX)} ${num(minY)} ${num(maxX - minX)} ${num(maxY - minY)}`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">` +
    (defs ? `<defs>${defs}</defs>` : "") +
    `${body}</svg>`;
  return { svg, bounds: [num(minX), num(minY), num(maxX), num(maxY)].map(Number) as Bounds };
}

/** Generic families for characters no KaTeX font has, as ratex-svg's `<text>` fallback picks them. */
export function fontFamily(font: string): string {
  if (font === "Emoji-Fallback") return "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
  return font.startsWith("CJK") ? "sans-serif" : "serif";
}

function include(bounds: Bounds, x0: number, y0: number, x1: number, y1: number): void {
  bounds[0] = Math.min(bounds[0], x0);
  bounds[1] = Math.min(bounds[1], y0);
  bounds[2] = Math.max(bounds[2], x1);
  bounds[3] = Math.max(bounds[3], y1);
}

export function num(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function attribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
