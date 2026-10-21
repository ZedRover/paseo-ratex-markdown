import { z } from "zod";

/**
 * Scene lengths are thousandths of an em, the unit of the KaTeX fonts. Coordinates grow
 * rightwards and downwards from the top-left corner of the formula box; the baseline sits
 * `height` below the top and `depth` above the bottom.
 */
export const UNITS_PER_EM = 1000;

/** CSS color of an item that sets its own (`\color`); absent means the document text color. */
const color = z.string().optional();

const bounds = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export const glyphItemSchema = z.object({
  kind: z.literal("glyph"),
  /** Key of the outline in the response's `glyphs`. */
  glyph: z.string(),
  /** Baseline origin. */
  x: z.number(),
  y: z.number(),
  scale: z.number(),
  color,
});

/** A character the KaTeX fonts cannot draw, such as CJK in `\text{}`: the client's fonts draw it. */
export const textItemSchema = z.object({
  kind: z.literal("text"),
  text: z.string(),
  /** RaTeX font ID, for choosing a generic family. */
  font: z.string(),
  x: z.number(),
  y: z.number(),
  size: z.number(),
  color,
});

export const ruleItemSchema = z.object({
  kind: z.literal("rule"),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  dashed: z.boolean().optional(),
  color,
});

export const pathItemSchema = z.object({
  kind: z.literal("path"),
  /** Absolute path data. A filled path paints each subpath on its own, as ratex-svg does. */
  subpaths: z.array(z.string()),
  fill: z.boolean(),
  /** minX, minY, maxX, maxY of every point, control points included. */
  bounds,
  color,
});

export const sceneItemSchema = z.discriminatedUnion("kind", [
  glyphItemSchema,
  textItemSchema,
  ruleItemSchema,
  pathItemSchema,
]);

export const sceneSchema = z.object({
  width: z.number(),
  height: z.number(),
  depth: z.number(),
  items: z.array(sceneItemSchema),
});

/** A glyph outline relative to its baseline origin, at a font size of one em. */
export const glyphOutlineSchema = z.object({
  d: z.string(),
  bounds,
});

export type GlyphItem = z.infer<typeof glyphItemSchema>;
export type TextItem = z.infer<typeof textItemSchema>;
export type RuleItem = z.infer<typeof ruleItemSchema>;
export type PathItem = z.infer<typeof pathItemSchema>;
export type SceneItem = z.infer<typeof sceneItemSchema>;
export type MathScene = z.infer<typeof sceneSchema>;
export type GlyphOutline = z.infer<typeof glyphOutlineSchema>;
export type Bounds = z.infer<typeof bounds>;
