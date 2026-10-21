import createMarkdownIt, { type MarkdownIt, type Token } from "markdown-it";
import footnote from "markdown-it-footnote";
import type { Align, Block, Footnote, Inline, ListItem, MarkdownTree } from "./ast.ts";
import { splitFrontMatter } from "./front-matter.ts";
import { mathSyntax } from "./math-syntax.ts";

type Container = Extract<Inline, { children: Inline[] }>;
type Cursor = { tokens: Token[]; index: number };

let instance: MarkdownIt | null = null;

function parser(): MarkdownIt {
  // Raw HTML is tokenized so it can be shown as source; it is never interpreted. markdown-it's
  // link validation already turns javascript: and similar destinations into text.
  instance ??= createMarkdownIt({ html: true, linkify: true }).use(mathSyntax).use(footnote);
  return instance;
}

export function parseMarkdown(source: string): MarkdownTree {
  const { frontMatter, body } = splitFrontMatter(source);
  const cursor: Cursor = { tokens: parser().parse(body, {}), index: 0 };
  return { frontMatter, blocks: readBlocks(cursor, null) };
}

function readBlocks(cursor: Cursor, closing: string | null): Block[] {
  const blocks: Block[] = [];
  while (cursor.index < cursor.tokens.length) {
    const token = cursor.tokens[cursor.index];
    cursor.index += 1;
    if (token.type === closing) break;
    switch (token.type) {
      case "heading_open": {
        const children = readInlines(cursor.tokens[cursor.index]);
        cursor.index += 2;
        blocks.push({ type: "heading", level: headingLevel(token.tag), children });
        break;
      }
      case "paragraph_open": {
        const children = readInlines(cursor.tokens[cursor.index]);
        cursor.index += 2;
        blocks.push(...splitParagraph(children));
        break;
      }
      case "blockquote_open":
        blocks.push({ type: "blockquote", children: readBlocks(cursor, "blockquote_close") });
        break;
      case "bullet_list_open":
      case "ordered_list_open":
        blocks.push(readList(cursor, token));
        break;
      case "fence": {
        const language = token.info.trim().split(/\s+/)[0] ?? "";
        // GitHub renders ```math fences as display math.
        if (language.toLowerCase() === "math" && token.content.trim()) {
          blocks.push({ type: "math", latex: token.content.trim(), source: `${token.markup}math\n${token.content}${token.markup}` });
        } else {
          blocks.push({ type: "code", language, text: token.content.replace(/\n$/, "") });
        }
        break;
      }
      case "code_block":
        blocks.push({ type: "code", language: "", text: token.content.replace(/\n$/, "") });
        break;
      case "math_block":
        blocks.push({ type: "math", latex: token.content, source: sourceOf(token) });
        break;
      case "hr":
        blocks.push({ type: "rule" });
        break;
      case "html_block":
        blocks.push({ type: "html", text: token.content.replace(/\n+$/, "") });
        break;
      case "table_open":
        blocks.push(readTable(cursor));
        break;
      case "footnote_block_open":
        blocks.push({ type: "footnotes", items: readFootnotes(cursor) });
        break;
      default:
        break;
    }
  }
  return blocks;
}

function readList(cursor: Cursor, open: Token): Block {
  const ordered = open.type === "ordered_list_open";
  const closing = ordered ? "ordered_list_close" : "bullet_list_close";
  const start = Number(open.attrGet("start") ?? 1);
  const items: ListItem[] = [];
  let loose = false;
  while (cursor.index < cursor.tokens.length) {
    const token = cursor.tokens[cursor.index];
    cursor.index += 1;
    if (token.type === closing) break;
    if (token.type !== "list_item_open") continue;
    // markdown-it hides the paragraphs of tight lists.
    const first = cursor.tokens[cursor.index];
    if (first?.type === "paragraph_open" && !first.hidden) loose = true;
    items.push(taskItem(readBlocks(cursor, "list_item_close")));
  }
  return { type: "list", ordered, start: Number.isFinite(start) ? start : 1, loose, items };
}

/** GitHub task list items: `- [ ] todo` and `- [x] done`. */
function taskItem(children: Block[]): ListItem {
  const first = children[0];
  const text = first?.type === "paragraph" ? first.children[0] : undefined;
  const marker = text?.type === "text" ? /^\[([ xX])\](?:[ \t]+|$)/.exec(text.text) : null;
  if (first?.type !== "paragraph" || text?.type !== "text" || !marker) return { checked: null, children };
  const rest = text.text.slice(marker[0].length);
  const inlines: Inline[] = rest ? [{ type: "text", text: rest }, ...first.children.slice(1)] : first.children.slice(1);
  return { checked: marker[1] !== " ", children: [{ type: "paragraph", children: inlines }, ...children.slice(1)] };
}

function readTable(cursor: Cursor): Block {
  const align: Align[] = [];
  const header: Inline[][] = [];
  const rows: Inline[][][] = [];
  let row: Inline[][] = [];
  let inHead = false;
  while (cursor.index < cursor.tokens.length) {
    const token = cursor.tokens[cursor.index];
    cursor.index += 1;
    if (token.type === "table_close") break;
    if (token.type === "thead_open") inHead = true;
    else if (token.type === "thead_close") inHead = false;
    else if (token.type === "tr_open") row = [];
    else if (token.type === "tr_close" && !inHead) rows.push(row);
    else if (token.type === "th_open" || token.type === "td_open") {
      const cell = readInlines(cursor.tokens[cursor.index]);
      cursor.index += 2;
      if (inHead) {
        header.push(cell);
        align.push(alignOf(token));
      } else {
        row.push(cell);
      }
    }
  }
  return { type: "table", align, header, rows };
}

function alignOf(token: Token): Align {
  const match = /text-align:\s*(left|center|right)/.exec(attribute(token, "style") ?? "");
  return match ? (match[1] as Align) : null;
}

function readFootnotes(cursor: Cursor): Footnote[] {
  const items: Footnote[] = [];
  while (cursor.index < cursor.tokens.length) {
    const token = cursor.tokens[cursor.index];
    cursor.index += 1;
    if (token.type === "footnote_block_close") break;
    if (token.type === "footnote_open") {
      items.push({ label: footnoteLabel(token), children: readBlocks(cursor, "footnote_close") });
    }
  }
  return items;
}

function readInlines(token: Token | undefined): Inline[] {
  const root: Inline[] = [];
  const stack: Inline[][] = [root];
  const add = (node: Inline) => {
    if (node.type === "text" && !node.text) return;
    const target = stack[stack.length - 1];
    const last = target[target.length - 1];
    if (node.type === "text" && last?.type === "text") last.text += node.text;
    else target.push(node);
  };
  const open = (node: Container) => {
    add(node);
    stack.push(node.children);
  };
  for (const child of token?.children ?? []) {
    switch (child.type) {
      case "text":
      case "text_special":
        add({ type: "text", text: child.content });
        break;
      case "softbreak":
        add({ type: "softbreak" });
        break;
      case "hardbreak":
        add({ type: "break" });
        break;
      case "code_inline":
        add({ type: "code", text: child.content });
        break;
      case "strong_open":
        open({ type: "strong", children: [] });
        break;
      case "em_open":
        open({ type: "em", children: [] });
        break;
      case "s_open":
        open({ type: "del", children: [] });
        break;
      case "link_open":
        open({ type: "link", href: attribute(child, "href") ?? "", title: attribute(child, "title"), children: [] });
        break;
      case "strong_close":
      case "em_close":
      case "s_close":
      case "link_close":
        if (stack.length > 1) stack.pop();
        break;
      case "image":
        add({ type: "image", src: attribute(child, "src") ?? "", alt: child.content, title: attribute(child, "title") });
        break;
      case "html_inline":
        add(inlineHtml(child.content));
        break;
      case "math_inline":
      case "math_inline_display":
        add({
          type: "math",
          latex: child.content,
          source: sourceOf(child),
          display: child.type === "math_inline_display",
        });
        break;
      case "footnote_ref":
        add({ type: "footnoteRef", label: footnoteLabel(child) });
        break;
      case "footnote_anchor":
        break;
      default:
        if (child.content) add({ type: "text", text: child.content });
    }
  }
  return root;
}

/**
 * Display math inside a paragraph becomes a block of its own, as on GitHub. Images become
 * blocks only in a paragraph of nothing else (a figure); inside a sentence they keep their
 * place as their label.
 */
function splitParagraph(children: Inline[]): Block[] {
  const figure = children.some((node) => node.type === "image") && children.every(
    (node) => node.type === "image" || (node.type === "math" && node.display) || blank(node),
  );
  const blocks: Block[] = [];
  let run: Inline[] = [];
  const flush = () => {
    const trimmed = trimEdges(run);
    if (trimmed.length) blocks.push({ type: "paragraph", children: trimmed });
    run = [];
  };
  for (const node of children) {
    if (node.type === "math" && node.display) {
      flush();
      blocks.push({ type: "math", latex: node.latex, source: node.source });
    } else if (node.type === "image" && figure) {
      flush();
      blocks.push({ type: "image", src: node.src, alt: node.alt, title: node.title });
    } else {
      run.push(node);
    }
  }
  flush();
  return blocks;
}

// Formatting tags whose text is worth keeping without the tag itself.
const FORMATTING_TAG =
  /^<\/?(?:a|abbr|b|bdi|bdo|big|cite|code|del|dfn|em|font|i|ins|kbd|mark|q|s|samp|small|span|strike|strong|sub|sup|tt|u|var|wbr)(?:\s[^>]*)?\/?>$/i;

/**
 * Raw inline HTML is never interpreted. Formatting tags are dropped and the text between them
 * kept, <br> breaks the line and <img> shows its label. Anything else stays as written, so
 * prose such as "cd <repo-name>" keeps its words.
 */
function inlineHtml(html: string): Inline {
  const tag = html.trim();
  if (/^<br\s*\/?>$/i.test(tag)) return { type: "break" };
  if (FORMATTING_TAG.test(tag)) return { type: "text", text: "" };
  if (/^<img\s/i.test(tag)) {
    const attribute = (name: string) => {
      const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
      return match ? (match[1] ?? match[2] ?? match[3]) : "";
    };
    return { type: "image", src: attribute("src"), alt: attribute("alt"), title: attribute("title") || null };
  }
  return { type: "text", text: html };
}

function blank(node: Inline): boolean {
  return node.type === "softbreak" || node.type === "break" || (node.type === "text" && !node.text.trim());
}

function trimEdges(nodes: Inline[]): Inline[] {
  let start = 0;
  let end = nodes.length;
  while (start < end && blank(nodes[start])) start += 1;
  while (end > start && blank(nodes[end - 1])) end -= 1;
  const trimmed = nodes.slice(start, end);
  // The space left next to a formula or image that moved out of the paragraph.
  const first = trimmed[0];
  if (first?.type === "text") trimmed[0] = { type: "text", text: first.text.trimStart() };
  const last = trimmed[trimmed.length - 1];
  if (last?.type === "text") trimmed[trimmed.length - 1] = { type: "text", text: last.text.trimEnd() };
  return trimmed;
}

function headingLevel(tag: string): 1 | 2 | 3 | 4 | 5 | 6 {
  const level = Number(tag.slice(1));
  return (level >= 1 && level <= 6 ? level : 6) as 1 | 2 | 3 | 4 | 5 | 6;
}

function attribute(token: Token, name: string): string | null {
  const value = token.attrGet(name);
  return value === null ? null : String(value);
}

function footnoteLabel(token: Token): string {
  const id = (token.meta as { id?: unknown } | null)?.id;
  return typeof id === "number" ? String(id + 1) : "?";
}

function sourceOf(token: Token): string {
  const source = (token.meta as { source?: unknown } | null)?.source;
  return typeof source === "string" ? source : token.content;
}
