/** A parsed Markdown document, independent of markdown-it's flat token stream. */
export type MarkdownTree = {
  frontMatter: FrontMatter | null;
  blocks: Block[];
};

/** YAML front matter: simple `key: value` rows when it has that shape, the raw text otherwise. */
export type FrontMatter = { rows: { key: string; value: string }[] | null; raw: string };

export type Align = "left" | "center" | "right" | null;

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "math"; latex: string; source: string }
  | { type: "image"; src: string; alt: string; title: string | null }
  | { type: "code"; language: string; text: string }
  | { type: "blockquote"; children: Block[] }
  | { type: "list"; ordered: boolean; start: number; loose: boolean; items: ListItem[] }
  | { type: "table"; align: Align[]; header: Inline[][]; rows: Inline[][][] }
  | { type: "html"; text: string }
  | { type: "rule" }
  | { type: "footnotes"; items: Footnote[] };

export type ListItem = {
  /** Task list state: `- [x]` is true, `- [ ]` false, an ordinary item null. */
  checked: boolean | null;
  children: Block[];
};

export type Footnote = { label: string; children: Block[] };

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong" | "em" | "del"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; title: string | null; children: Inline[] }
  | { type: "image"; src: string; alt: string; title: string | null }
  | { type: "math"; latex: string; source: string; display: boolean }
  | { type: "footnoteRef"; label: string }
  | { type: "softbreak" }
  | { type: "break" };
