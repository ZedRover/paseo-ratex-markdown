import assert from "node:assert/strict";
import { test } from "node:test";
import type { Block, Inline } from "../client/markdown/ast.ts";
import { parseMarkdown } from "../client/markdown/parse.ts";

function inlines(markdown: string): Inline[] {
  const [block] = parseMarkdown(markdown).blocks;
  assert.equal(block?.type, "paragraph", `expected a paragraph from ${JSON.stringify(markdown)}`);
  return (block as Extract<Block, { type: "paragraph" }>).children;
}

function formulas(markdown: string): string[] {
  const found: string[] = [];
  const visit = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (node.type === "math") found.push(node.latex);
      else if ("children" in node) visit(node.children);
    }
  };
  const walk = (blocks: Block[]) => {
    for (const block of blocks) {
      if (block.type === "math") found.push(block.latex);
      else if (block.type === "paragraph" || block.type === "heading") visit(block.children);
      else if (block.type === "blockquote") walk(block.children);
      else if (block.type === "list") block.items.forEach((item) => walk(item.children));
      else if (block.type === "table") for (const cell of [...block.header, ...block.rows.flat()]) visit(cell);
    }
  };
  walk(parseMarkdown(markdown).blocks);
  return found;
}

test("inline delimiters keep their source for copying", () => {
  assert.deepEqual(inlines("a $x^2$ b \\(y\\) c $`z`$"), [
    { type: "text", text: "a " },
    { type: "math", latex: "x^2", source: "$x^2$", display: false },
    { type: "text", text: " b " },
    { type: "math", latex: "y", source: "\\(y\\)", display: false },
    { type: "text", text: " c " },
    { type: "math", latex: "z", source: "$`z`$", display: false },
  ]);
});

test("currency and other prose dollars stay text", () => {
  for (const prose of [
    "It costs $5 and $10.",
    "Between $20,000 and $30,000 per year.",
    "Price: $ 5 $",
    "A lone $ sign.",
    "$5 then $x$ later",
  ]) {
    const found = formulas(prose);
    assert.ok(found.length === 0 || (prose.includes("$x$") && found.join() === "x"), `${prose} -> ${found}`);
  }
  assert.deepEqual(formulas("$5 then $x$ later"), ["x"]);
});

test("escaped dollars, code spans and fences are never math", () => {
  assert.deepEqual(formulas("\\$x\\$ and `$y$` and ``a $z$ b``"), []);
  assert.deepEqual(formulas("```\n$$x$$\n```\n\n    $$y$$"), []);
  assert.deepEqual(formulas("$a `b$` c$"), ["a `b$` c"]);
});

test("display math in blocks, paragraphs, quotes, lists and ```math fences", () => {
  const tree = parseMarkdown(
    ["$$", "\\int_0^1 x\\,dx", "$$", "", "\\[ a \\]", "", "> $$b$$", "", "- $$c$$", "", "```math", "d", "```"].join("\n"),
  );
  assert.deepEqual(
    tree.blocks.map((block) => block.type),
    ["math", "math", "blockquote", "list", "math"],
  );
  assert.deepEqual(formulas("text $$e$$ more"), ["e"]);
  const split = parseMarkdown("before $$E=mc^2$$ after").blocks;
  assert.deepEqual(split.map((block) => block.type), ["paragraph", "math", "paragraph"]);
  assert.deepEqual((split[2] as Extract<Block, { type: "paragraph" }>).children, [{ type: "text", text: "after" }]);
});

test("a stray $$ does not swallow the document", () => {
  const tree = parseMarkdown("$$\nnot closed\n\n# Heading\n\nText $x$.");
  assert.ok(tree.blocks.some((block) => block.type === "heading"));
  assert.deepEqual(formulas("$$\nnot closed\n\n# Heading\n\nText $x$."), ["x"]);
});

test("display math source is rebuilt without container markers", () => {
  const [quote] = parseMarkdown("> $$\n> a\n> $$").blocks;
  assert.equal(quote.type, "blockquote");
  const [math] = (quote as Extract<Block, { type: "blockquote" }>).children;
  assert.deepEqual(math, { type: "math", latex: "a", source: "$$\na\n$$" });
});

test("TeX newlines and escaped delimiters inside formulas", () => {
  assert.deepEqual(formulas("$$\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}$$"), [
    "\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}",
  ]);
  assert.deepEqual(formulas("$\\$5$"), ["\\$5"]);
  assert.deepEqual(formulas("\\(a \\\\) b\\)"), ["a \\\\) b"]);
});

test("escaped brackets in prose are CommonMark's literal brackets, not math", () => {
  const [paragraph] = parseMarkdown("See reference \\[1\\] and \\[2\\], or run with \\[--verbose\\].").blocks;
  assert.deepEqual(paragraph, {
    type: "paragraph",
    children: [{ type: "text", text: "See reference [1] and [2], or run with [--verbose]." }],
  });
  assert.deepEqual(formulas("\\[\nx\n\\]"), ["x"], "on its own lines \\[ still opens display math");
});

test("inline math may wrap onto the next line, as formatters wrap prose", () => {
  assert.deepEqual(formulas("energy $E =\nmc^2$ here"), ["E =\nmc^2"]);
  assert.deepEqual(formulas("$5 on Monday\n$6 on Tuesday"), []);
});

test("unclosed delimiters cost linear time", () => {
  const repeat = (unit: string) => unit.repeat(Math.ceil(120_000 / unit.length));
  for (const source of [repeat("\\( "), repeat("$$ "), repeat("$` "), repeat("$a `"), repeat("$$ x\n"), repeat("\\[ x\n")]) {
    const started = performance.now();
    parseMarkdown(source);
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 2000, `${JSON.stringify(source.slice(0, 6))}… took ${elapsed.toFixed(0)} ms`);
  }
});

test("resumed scans find the same closer a fresh scan would", () => {
  // Line 0 opens and finds no closer within the line limit; markdown-it then asks about every
  // later line, and line 50 is the first close enough to reach "e \]" on line 250. (`\[` is
  // used because a paragraph pairs inline `$$` itself.)
  const lines = Array.from({ length: 251 }, (_, index) => (index === 250 ? "e \\]" : `\\[ k${index}`));
  const blocks = parseMarkdown(lines.join("\n")).blocks;
  assert.deepEqual(blocks.map((block) => block.type), ["paragraph", "math"]);
  const math = blocks[1] as Extract<Block, { type: "math" }>;
  assert.ok(math.latex.startsWith("k50\n\\[ k51") && math.latex.endsWith("\\[ k249\ne"), math.latex.slice(0, 40));
});
