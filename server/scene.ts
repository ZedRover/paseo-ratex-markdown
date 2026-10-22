import type { Color, DisplayItem, DisplayList } from "./vendor/ratex-types.js";
import {
  UNITS_PER_EM,
  type Bounds,
  type GlyphOutline,
  type MathScene,
  type SceneItem,
} from "../shared/scene.ts";
import { num, resolveGlyph } from "./glyphs.ts";
import { LAYOUT_COLOR } from "./ratex.ts";

type Item<Type extends string> = Extract<DisplayItem, { type: Type }>;

export type BuiltScene = {
  scene: MathScene;
  /** Outlines the scene's glyph items reference. */
  glyphs: Map<string, GlyphOutline>;
};

/**
 * Limits on what one formula may draw. A short formula can still lay out enormous boxes
 * (`\rule{99999em}{1em}`) or hundreds of stretchy paths; refusing those before the scene is
 * built keeps a crafted document from tying up the daemon or flooding the client.
 */
const MAX_SIZE_EM = 500;
const MAX_ITEMS = 10_000;
const MAX_PATH_COMMANDS = 20_000;
const TOO_LARGE = "This formula is too large to draw.";

/** Converts a RaTeX DisplayList (em) into a scene the client can draw as SVG. */
export function buildScene(list: DisplayList): BuiltScene {
  assertDrawable(list);
  const items: SceneItem[] = [];
  const glyphs = new Map<string, GlyphOutline>();
  for (const item of list.items) {
    if (item.type === "GlyphPath") {
      const glyph = item as Item<"GlyphPath">;
      const resolved = validCodePoint(glyph.char_code) ? resolveGlyph(glyph.font, glyph.char_code) : null;
      if (resolved && !resolved.outline.d) continue;
      if (resolved) {
        glyphs.set(resolved.key, resolved.outline);
        items.push({
          kind: "glyph",
          glyph: resolved.key,
          x: units(glyph.x),
          y: units(glyph.y),
          scale: round(glyph.scale, 4),
          color: cssColor(glyph.color),
        });
      } else {
        items.push({
          kind: "text",
          text: validCodePoint(glyph.char_code) ? String.fromCodePoint(glyph.char_code) : "�",
          font: glyph.font,
          x: units(glyph.x),
          y: units(glyph.y),
          size: units(glyph.scale),
          color: cssColor(glyph.color),
        });
      }
    } else if (item.type === "Line") {
      // A Line is centered on y, like ratex-svg's rect and ratex-wasm's canvas fillRect.
      const line = item as Item<"Line">;
      items.push({
        kind: "rule",
        x: units(line.x),
        y: units(line.y - line.thickness / 2),
        width: units(line.width),
        height: units(line.thickness),
        dashed: line.dashed || undefined,
        color: cssColor(line.color),
      });
    } else if (item.type === "Rect") {
      const rect = item as Item<"Rect">;
      items.push({
        kind: "rule",
        x: units(rect.x),
        y: units(rect.y),
        width: units(rect.width),
        height: units(rect.height),
        color: cssColor(rect.color),
      });
    } else if (item.type === "Path") {
      const path = pathItem(item as Item<"Path">);
      if (path) items.push(path);
    }
    // The DisplayList protocol asks decoders to skip item types newer than they know.
  }
  return {
    scene: { width: units(list.width), height: units(list.height), depth: units(list.depth), items },
    glyphs,
  };
}

function assertDrawable(list: DisplayList): void {
  const extent = (value: number) => Number.isFinite(value) && Math.abs(value) <= MAX_SIZE_EM;
  if (!extent(list.width) || !extent(list.height) || !extent(list.depth) || list.items.length > MAX_ITEMS) {
    throw new Error(TOO_LARGE);
  }
  let commands = 0;
  for (const item of list.items) {
    if (item.type === "Path") commands += (item as Item<"Path">).commands.length;
  }
  if (commands > MAX_PATH_COMMANDS) throw new Error(TOO_LARGE);
}

function pathItem(item: Item<"Path">): SceneItem | null {
  const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const subpaths: string[] = [];
  let current = "";
  const point = (x: number, y: number) => {
    const px = units(item.x + x);
    const py = units(item.y + y);
    bounds[0] = Math.min(bounds[0], px);
    bounds[1] = Math.min(bounds[1], py);
    bounds[2] = Math.max(bounds[2], px);
    bounds[3] = Math.max(bounds[3], py);
    return `${num(px)} ${num(py)}`;
  };
  for (const command of item.commands) {
    if (command.type === "MoveTo") {
      // KaTeX's stretchy shapes overlap their own subpaths; filling them as one nonzero
      // path would cut holes, so ratex-svg paints each subpath separately.
      if (current) subpaths.push(current);
      current = `M${point(command.x, command.y)}`;
    } else if (command.type === "LineTo") {
      current += `L${point(command.x, command.y)}`;
    } else if (command.type === "QuadTo") {
      current += `Q${point(command.x1, command.y1)} ${point(command.x, command.y)}`;
    } else if (command.type === "CubicTo") {
      current += `C${point(command.x1, command.y1)} ${point(command.x2, command.y2)} ${point(command.x, command.y)}`;
    } else if (command.type === "Close") {
      current += "Z";
    }
  }
  if (current) subpaths.push(current);
  if (subpaths.length === 0) return null;
  return { kind: "path", subpaths, fill: item.fill, bounds, color: cssColor(item.color) };
}

/** Undefined for RaTeX's default color, so the client applies the theme's text color. */
export function cssColor(color: Color): string | undefined {
  const channels = [color.r, color.g, color.b].map((channel) => Math.round(channel * 255));
  const [r, g, b] = channels;
  const alpha = round(color.a, 3);
  if (alpha >= 1 && r === LAYOUT_COLOR.r && g === LAYOUT_COLOR.g && b === LAYOUT_COLOR.b) {
    return undefined;
  }
  if (alpha >= 1) return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  return `rgba(${r},${g},${b},${alpha})`;
}

function units(em: number): number {
  return round(em * UNITS_PER_EM, 1);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function validCodePoint(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff;
}
