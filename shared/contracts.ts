import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { glyphOutlineSchema, sceneSchema } from "./scene.ts";

/** Longer formulas are shown as source, so one pathological document cannot pin the daemon. */
export const MAX_LATEX_LENGTH = 4096;

/** Formulas per render request; a long document is sent in several batches. */
export const MAX_FORMULAS_PER_REQUEST = 64;

export const renderMathRpc = defineRpc({
  name: "math.render",
  input: z.object({
    formulas: z
      .array(
        z.object({
          latex: z.string().min(1).max(MAX_LATEX_LENGTH),
          display: z.boolean(),
        }),
      )
      .min(1)
      .max(MAX_FORMULAS_PER_REQUEST),
  }),
  output: z.object({
    /** One result per input formula, in order. */
    results: z.array(
      z.discriminatedUnion("ok", [
        z.object({ ok: z.literal(true), scene: sceneSchema }),
        z.object({ ok: z.literal(false), error: z.string() }),
      ]),
    ),
    /** Outlines of every glyph the scenes above use, shared between formulas. */
    glyphs: z.record(z.string(), glyphOutlineSchema),
  }),
});

export const listMarkdownFilesRpc = defineRpc({
  name: "files.list",
  input: z.object({ workspaceId: z.string().min(1) }),
  output: z.object({
    root: z.string(),
    /** Paths relative to `root`, with forward slashes, shallow files first. */
    files: z.array(z.object({ path: z.string(), size: z.number() })),
    truncated: z.boolean(),
  }),
});

export const readMarkdownFileRpc = defineRpc({
  name: "files.read",
  input: z.object({
    workspaceId: z.string().min(1),
    /** Relative to the workspace directory, or absolute inside it. */
    path: z.string().min(1),
    /** Revision the client already shows; an unchanged file is not sent again. */
    knownRevision: z.string().optional(),
  }),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), text: z.string(), revision: z.string(), path: z.string() }),
    z.object({ status: z.literal("unchanged"), revision: z.string() }),
    z.object({ status: z.literal("missing"), message: z.string() }),
  ]),
});

export const readImageRpc = defineRpc({
  name: "files.image",
  input: z.object({
    workspaceId: z.string().min(1),
    /** The Markdown file the image appears in: relative to the workspace, or absolute. */
    documentPath: z.string().min(1),
    /** The image reference as written, relative to the document. */
    src: z.string().min(1),
  }),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), mimeType: z.string(), base64: z.string() }),
    z.object({ ok: z.literal(false), error: z.string() }),
  ]),
});
