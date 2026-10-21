import type { FrontMatter } from "./ast.ts";

// Same delimiters Paseo's own Markdown preview recognizes.
const FRONT_MATTER = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Splits YAML front matter from the Markdown body. */
export function splitFrontMatter(source: string): { frontMatter: FrontMatter | null; body: string } {
  const match = FRONT_MATTER.exec(source);
  if (!match) return { frontMatter: null, body: source };
  return {
    frontMatter: { rows: simpleRows(match[1]), raw: match[1] },
    body: source.slice(match[0].length),
  };
}

/**
 * Rows for front matter made of `key: value` lines and `- item` lists under a key. Anything
 * else (nested maps, block scalars) returns null and is shown as YAML source instead.
 */
function simpleRows(yaml: string): { key: string; value: string }[] | null {
  const rows: { key: string; value: string; items: string[] }[] = [];
  for (const line of yaml.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const entry = /^([^\s#:][^:]*?):(?:\s+(.*?))?\s*$/.exec(line);
    if (entry) {
      const value = entry[2] ?? "";
      if (/^[|>]/.test(value)) return null;
      rows.push({ key: entry[1], value: unquote(value), items: [] });
      continue;
    }
    const item = /^\s+-\s+(.*?)\s*$/.exec(line);
    const last = rows[rows.length - 1];
    if (item && last && !last.value) {
      last.items.push(unquote(item[1]));
      continue;
    }
    return null;
  }
  return rows.map(({ key, value, items }) => ({ key, value: items.length ? items.join(", ") : value }));
}

function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted ? quoted[2] : value;
}
