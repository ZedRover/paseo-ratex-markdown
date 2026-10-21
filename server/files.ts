import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { listMarkdownFilesRpc, readImageRpc, readMarkdownFileRpc } from "../shared/contracts.ts";

// Every read is confined to the workspace directory the daemon reports for the workspace ID,
// after resolving symlinks, and to Markdown or image files.

export const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

/** Dependency and build trees that hold no documentation worth listing. Dot directories are skipped too. */
const SKIPPED_DIRECTORIES = new Set([
  "node_modules", "bower_components", "__pycache__", "venv", "target", "dist", "build", "out", "coverage",
]);

const MAX_LISTED_FILES = 2000;
const MAX_VISITED_DIRECTORIES = 5000;
const MAX_MARKDOWN_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export async function listMarkdownFiles(
  { workspaceId }: RpcInput<typeof listMarkdownFilesRpc>,
  { paseo }: PluginHandlerContext,
): Promise<RpcOutput<typeof listMarkdownFilesRpc>> {
  return listMarkdownFilesIn(await workspaceRoot(paseo, workspaceId));
}

/** Breadth first, so a truncated listing keeps the files nearest the root. */
export async function listMarkdownFilesIn(root: string): Promise<RpcOutput<typeof listMarkdownFilesRpc>> {
  const files: { path: string; size: number }[] = [];
  const queue = [""];
  let truncated = false;
  for (let next = 0; next < queue.length && !truncated; next += 1) {
    if (next >= MAX_VISITED_DIRECTORIES) {
      truncated = true;
      break;
    }
    const directory = queue[next];
    const entries = await readdir(path.join(root, directory), { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const relative = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) queue.push(relative);
      } else if (entry.isFile() && MARKDOWN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        if (files.length >= MAX_LISTED_FILES) {
          truncated = true;
          break;
        }
        const info = await stat(path.join(root, relative)).catch(() => null);
        files.push({ path: relative, size: info?.size ?? 0 });
      }
    }
  }
  return { root, files, truncated };
}

export async function readMarkdownFile(
  { workspaceId, path: target, knownRevision }: RpcInput<typeof readMarkdownFileRpc>,
  { paseo }: PluginHandlerContext,
): Promise<RpcOutput<typeof readMarkdownFileRpc>> {
  return readMarkdownFileIn(await workspaceRoot(paseo, workspaceId), target, knownRevision);
}

export async function readMarkdownFileIn(
  root: string,
  target: string,
  knownRevision?: string,
): Promise<RpcOutput<typeof readMarkdownFileRpc>> {
  const file = await containedPath(root, path.resolve(root, target));
  if (!file || !MARKDOWN_EXTENSIONS.has(path.extname(file).toLowerCase())) {
    return { status: "missing", message: `${target} is not a Markdown file in this workspace.` };
  }
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return { status: "missing", message: `${target} was not found.` };
  const revision = `${info.mtimeMs}:${info.size}`;
  if (revision === knownRevision) return { status: "unchanged", revision };
  if (info.size > MAX_MARKDOWN_BYTES) {
    return { status: "missing", message: `${target} is larger than ${MAX_MARKDOWN_BYTES / 1024 / 1024} MB.` };
  }
  const text = await readFile(file, "utf8");
  return {
    status: "ok",
    text: text.startsWith("\ufeff") ? text.slice(1) : text,
    revision,
    path: path.relative(root, file).split(path.sep).join("/"),
  };
}

export async function readImage(
  { workspaceId, documentPath, src }: RpcInput<typeof readImageRpc>,
  { paseo }: PluginHandlerContext,
): Promise<RpcOutput<typeof readImageRpc>> {
  return readImageIn(await workspaceRoot(paseo, workspaceId), documentPath, src);
}

export async function readImageIn(
  root: string,
  documentPath: string,
  src: string,
): Promise<RpcOutput<typeof readImageRpc>> {
  const reference = localReference(src);
  if (!reference) return { ok: false, error: `${src} is not a local image.` };
  const directory = path.dirname(path.resolve(root, documentPath));
  // "/images/a.png" means the repository root in most Markdown hosts, unless it is a real
  // absolute path inside the workspace.
  const candidates = path.isAbsolute(reference)
    ? [reference, path.join(root, reference)]
    : [path.resolve(directory, reference)];
  let file: string | null = null;
  for (const candidate of candidates) {
    file = await containedPath(root, candidate);
    if (file) break;
  }
  const mimeType = file ? IMAGE_TYPES[path.extname(file).toLowerCase()] : undefined;
  if (!file || !mimeType) return { ok: false, error: `${src} is not an image file in this workspace.` };
  const info = await stat(file);
  if (!info.isFile()) return { ok: false, error: `${src} is not a file.` };
  if (info.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: `${src} is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.` };
  }
  return { ok: true, mimeType, base64: (await readFile(file)).toString("base64") };
}

/** A filesystem path from an image reference, or null for URLs the client loads itself. */
function localReference(src: string): string | null {
  if (/^file:/i.test(src)) {
    try {
      return fileURLToPath(src);
    } catch {
      return null;
    }
  }
  // A URL scheme, but not a Windows drive letter such as C:\.
  if (/^[a-z][a-z\d+.-]*:/i.test(src) && !/^[a-z]:[\\/]/i.test(src)) return null;
  const withoutSuffix = src.replace(/[?#].*$/, "");
  try {
    // markdown-it percent-encodes destinations ("my image.png" becomes "my%20image.png").
    return decodeURIComponent(withoutSuffix);
  } catch {
    return withoutSuffix;
  }
}

async function workspaceRoot(paseo: PluginHandlerContext["paseo"], workspaceId: string): Promise<string> {
  const workspace = await paseo.workspaces.ref(workspaceId).refresh();
  const directory = workspace?.workspaceDirectory;
  if (!directory) throw new Error("This workspace has no directory on the host.");
  return realpath(directory);
}

/** The real path of `candidate` when it exists inside `root` (itself a real path). */
async function containedPath(root: string, candidate: string): Promise<string | null> {
  const real = await realpath(candidate).catch(() => null);
  if (!real) return null;
  const relative = path.relative(root, real);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }
  return real;
}
