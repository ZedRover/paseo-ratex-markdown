import assert from "node:assert/strict";
import { test } from "node:test";
import type { Block } from "../client/markdown/ast.ts";
import { parseMarkdown } from "../client/markdown/parse.ts";
import { isExternalLink, isRemoteImage, resolveMarkdownLink } from "../client/links.ts";

type Of<Type extends Block["type"]> = Extract<Block, { type: Type }>;

test("front matter becomes rows, or YAML source when it is not flat", () => {
  const flat = parseMarkdown("---\ntitle: \"Notes\"\ntags:\n  - a\n  - b\n---\n# Body");
  assert.deepEqual(flat.frontMatter?.rows, [
    { key: "title", value: "Notes" },
    { key: "tags", value: "a, b" },
  ]);
  assert.equal(flat.blocks[0].type, "heading");
  const nested = parseMarkdown("---\nauthor:\n  name: Ada\n---\nBody");
  assert.equal(nested.frontMatter?.rows, null);
  assert.equal(nested.frontMatter?.raw, "author:\n  name: Ada");
  assert.equal(parseMarkdown("no front matter").frontMatter, null);
});

test("task lists, ordered starts and looseness", () => {
  const [tasks, ordered, loose] = parseMarkdown("- [x] done\n- [ ] todo\n- plain\n\n3. c\n4. d\n\n* a\n\n* b").blocks as Of<"list">[];
  assert.deepEqual(tasks.items.map((item) => item.checked), [true, false, null]);
  assert.deepEqual(tasks.items[0].children, [{ type: "paragraph", children: [{ type: "text", text: "done" }] }]);
  assert.equal(ordered.ordered, true);
  assert.equal(ordered.start, 3);
  assert.equal(tasks.loose, false);
  assert.equal(loose.loose, true);
});

test("tables keep alignment and inline content", () => {
  const [table] = parseMarkdown("| a | b | c |\n|:-|:-:|-:|\n| $x$ | **y** | `z` |").blocks as Of<"table">[];
  assert.deepEqual(table.align, ["left", "center", "right"]);
  assert.deepEqual(table.rows[0][0], [{ type: "math", latex: "x", source: "$x$", display: false }]);
  assert.deepEqual(table.rows[0][1], [{ type: "strong", children: [{ type: "text", text: "y" }] }]);
});

test("footnotes, links, inline images and standalone images", () => {
  const tree = parseMarkdown("See[^n] [site](https://example.com) [![b](https://x/b.svg)](https://x)\n\n![plot](./plot.png \"Plot\")\n\n[^n]: Note $z$.");
  const [paragraph, image, footnotes] = tree.blocks;
  assert.equal(paragraph.type, "paragraph");
  assert.deepEqual((paragraph as Of<"paragraph">).children.slice(1, 2), [{ type: "footnoteRef", label: "1" }]);
  const link = (paragraph as Of<"paragraph">).children.find((node) => node.type === "link");
  assert.deepEqual(link, { type: "link", href: "https://example.com", title: null, children: [{ type: "text", text: "site" }] });
  assert.deepEqual(image, { type: "image", src: "./plot.png", alt: "plot", title: "Plot" });
  assert.equal(footnotes.type, "footnotes");
  assert.equal((footnotes as Of<"footnotes">).items[0].label, "1");
});

test("raw HTML is kept as text and unsafe link targets are not links", () => {
  const [html, paragraph] = parseMarkdown("<div onclick=\"x()\">hi</div>\n\n[x](javascript:alert(1)) a<br>b").blocks;
  assert.deepEqual(html, { type: "html", text: "<div onclick=\"x()\">hi</div>" });
  const children = (paragraph as Of<"paragraph">).children;
  assert.ok(!children.some((node) => node.type === "link"));
  assert.ok(children.some((node) => node.type === "break"));
});

test("link helpers", () => {
  assert.equal(isExternalLink("https://a.b"), true);
  assert.equal(isExternalLink("mailto:a@b.c"), true);
  assert.equal(isExternalLink("file:///etc/passwd"), false);
  assert.equal(isRemoteImage("data:image/png;base64,AAAA"), true);
  assert.equal(isRemoteImage("./a.png"), false);
  assert.equal(resolveMarkdownLink("docs/guide/intro.md", "../api.md#top"), "docs/api.md");
  assert.equal(resolveMarkdownLink("docs/intro.md", "./My%20Notes.md"), "docs/My Notes.md");
  assert.equal(resolveMarkdownLink("docs/intro.md", "/README.md"), "README.md");
  assert.equal(resolveMarkdownLink("README.md", "../outside.md"), null);
  assert.equal(resolveMarkdownLink("README.md", "image.png"), null);
  assert.equal(resolveMarkdownLink("README.md", "https://x/a.md"), null);
});

test("inline HTML keeps the words around and inside it", () => {
  const text = (markdown: string) =>
    (parseMarkdown(markdown).blocks[0] as Of<"paragraph">).children
      .map((node) => (node.type === "text" ? node.text : `[${node.type}]`))
      .join("");
  assert.equal(text("Press <Enter>, cd <repo-name>."), "Press <Enter>, cd <repo-name>.");
  assert.equal(text("<kbd>Ctrl</kbd>+<kbd>K</kbd> and <sup>2</sup>"), "Ctrl+K and 2");
  assert.equal(text('Status: <img src="b.svg" alt="build passing"> ok'), "Status: [image] ok");
  const [figure] = parseMarkdown('<img src="plot.png" alt="Plot" title="Figure">').blocks;
  assert.deepEqual(figure, { type: "html", text: '<img src="plot.png" alt="Plot" title="Figure">' }, "an HTML block stays source");
  const [inlineFigure] = parseMarkdown('Figure:\n<img src="plot.png" alt="Plot">').blocks;
  assert.ok((inlineFigure as Of<"paragraph">).children.some((node) => node.type === "image" && node.alt === "Plot"));
});

test("images inside a sentence stay inline; a paragraph of images is a figure", () => {
  const [sentence] = parseMarkdown("Click ![gear](g.png) now").blocks;
  assert.equal(sentence.type, "paragraph");
  assert.deepEqual((sentence as Of<"paragraph">).children.map((node) => node.type), ["text", "image", "text"]);
  assert.deepEqual(
    parseMarkdown("![a](a.png)\n![b](b.png)").blocks.map((block) => block.type),
    ["image", "image"],
  );
});
