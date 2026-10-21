/** Links the client hands to the operating system. */
export function isExternalLink(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}

/** Images the client loads itself; anything else is a file the daemon reads. */
export function isRemoteImage(src: string): boolean {
  return /^(https?:|data:image\/)/i.test(src);
}

/**
 * The workspace-relative Markdown file a relative link points to, or null. `documentPath` is
 * workspace-relative with forward slashes; links that leave the workspace resolve to null.
 */
export function resolveMarkdownLink(documentPath: string, href: string): string | null {
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("#")) return null;
  let target = href.replace(/[?#].*$/, "");
  try {
    target = decodeURIComponent(target);
  } catch {
    // Keep the raw reference; a malformed escape is still a usable path.
  }
  if (!/\.(md|markdown)$/i.test(target)) return null;
  const base = target.startsWith("/") ? [] : documentPath.split("/").slice(0, -1);
  const segments = [...base];
  for (const segment of target.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.length ? segments.join("/") : null;
}
