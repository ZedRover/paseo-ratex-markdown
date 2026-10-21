import type { MarkdownIt, StateBlock, StateInline } from "markdown-it";

/**
 * markdown-it rules for TeX math. Tokens carry the TeX in `content` and the formula exactly as
 * written, delimiters included, in `meta.source`:
 *
 * - `math_block`: `$$ … $$` or `\[ … \]` starting a line.
 * - `math_inline`: `$…$`, `\(…\)` and GitHub's `` $`…`$ ``.
 * - `math_inline_display`: `$$…$$` inside a paragraph.
 *
 * `\[` inside a paragraph stays CommonMark's escaped bracket: Pandoc and HTML converters write
 * `\[1\]` for literal brackets all the time.
 */
export function mathSyntax(md: MarkdownIt): void {
  md.inline.ruler.before("escape", "math_inline", inlineMath);
  md.block.ruler.before("fence", "math_block", blockMath, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
}

type InlineMatch = { latex: string; display: boolean; end: number };

/** Where inline formulas can end in one paragraph, found in a single pass. */
type Closers = {
  /** `$` that is neither escaped nor inside a code span. */
  dollars: number[];
  /** `$$` that is neither escaped nor inside a code span. */
  doubleDollars: number[];
  /** `\)` whose backslash is not escaped, outside code spans. */
  parens: number[];
  /** "`$", the end of GitHub's $`…`$ form. */
  backtickDollars: number[];
};

// One index per paragraph: a lookup per opening delimiter keeps a paragraph full of unclosed
// `$$` or `\(` linear instead of rescanning the rest of it for every one.
const closersByParagraph = new WeakMap<StateInline, Closers>();

function closersOf(state: StateInline): Closers {
  let closers = closersByParagraph.get(state);
  if (!closers) {
    closers = scanClosers(state.src);
    closersByParagraph.set(state, closers);
  }
  return closers;
}

function scanClosers(src: string): Closers {
  const closers: Closers = { dollars: [], doubleDollars: [], parens: [], backtickDollars: [] };
  // Backtick runs by length: a code span closes at the next run of the same length.
  const runs = new Map<number, number[]>();
  for (let start = 0; start < src.length; ) {
    if (src[start] !== "`") {
      start += 1;
      continue;
    }
    let end = start + 1;
    while (src[end] === "`") end += 1;
    let starts = runs.get(end - start);
    if (!starts) runs.set(end - start, (starts = []));
    starts.push(start);
    if (src[end] === "$") closers.backtickDollars.push(end - 1);
    start = end;
  }
  for (let index = 0; index < src.length; index += 1) {
    const char = src[index];
    if (char === "`") {
      let end = index + 1;
      while (src[end] === "`") end += 1;
      const close = firstAtLeast(runs.get(end - index) ?? [], end);
      index = (close === undefined ? end : close + end - index) - 1;
    } else if (char === "\\") {
      if (src[index + 1] === ")") closers.parens.push(index);
      index += 1;
    } else if (char === "$") {
      closers.dollars.push(index);
      if (src[index + 1] === "$") closers.doubleDollars.push(index);
    }
  }
  return closers;
}

/** The first value at or after `minimum` in an ascending list. */
function firstAtLeast(sorted: readonly number[], minimum: number): number | undefined {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle] < minimum) low = middle + 1;
    else high = middle;
  }
  return sorted[low];
}

function inlineMath(state: StateInline, silent: boolean): boolean {
  const { src, pos, posMax } = state;
  if (src.startsWith("\\(", pos)) {
    const close = firstAtLeast(closersOf(state).parens, pos + 2);
    if (close === undefined || close + 2 > posMax) return false;
    return push(state, silent, pos, { latex: src.slice(pos + 2, close), display: false, end: close + 2 });
  }
  if (src[pos] !== "$") return false;
  if (src.startsWith("$$", pos)) {
    const close = firstAtLeast(closersOf(state).doubleDollars, pos + 2);
    if (close === undefined || close + 2 > posMax) {
      // A lone `$$` is text. Consuming both keeps the second from opening `$…$`.
      if (!silent) state.pending += "$$";
      state.pos += 2;
      return true;
    }
    return push(state, silent, pos, { latex: src.slice(pos + 2, close), display: true, end: close + 2 });
  }
  const match = dollarMath(state, pos, posMax);
  return match ? push(state, silent, pos, match) : false;
}

function push(state: StateInline, silent: boolean, start: number, match: InlineMatch): boolean {
  if (!match.latex.trim()) return false;
  if (!silent) {
    const token = state.push(match.display ? "math_inline_display" : "math_inline", "math", 0);
    token.content = match.latex.trim();
    token.meta = { source: state.src.slice(start, match.end) };
  }
  state.pos = match.end;
  return true;
}

function dollarMath(state: StateInline, pos: number, max: number): InlineMatch | null {
  const { src } = state;
  const closers = closersOf(state);
  // GitHub's $`…`$ form, which leaves backticks free inside the formula.
  if (src[pos + 1] === "`") {
    const close = firstAtLeast(closers.backtickDollars, pos + 2);
    return close !== undefined && close + 2 <= max
      ? { latex: src.slice(pos + 2, close), display: false, end: close + 2 }
      : null;
  }
  // Pandoc's rules: no space after the opening `$`, none before the closing one, and no
  // digit after it, so "$5 and $10" stays prose. A formula may wrap onto the next line.
  const next = src[pos + 1];
  if (next === undefined || /\s/.test(next)) return null;
  const close = firstAtLeast(closers.dollars, pos + 1);
  if (close === undefined || close >= max) return null;
  // A `$` that starts a word or a `$$` opens something else: this run is prose.
  if (src[close + 1] === "$" || /\s/.test(src[close - 1]) || /\d/.test(src[close + 1] ?? "")) return null;
  return { latex: src.slice(pos + 1, close), display: false, end: close + 1 };
}

/** Lines a display formula may span; also bounds the work a line that never closes costs. */
const MAX_DISPLAY_LINES = 200;

/**
 * What the last failed scan for a closer learned: lines `from + 1` through `clear` are
 * non-blank and do not close, and `blocked` is the blank line or container end it stopped at,
 * if any. markdown-it asks this rule about every line of a paragraph to see whether it ends
 * there; a later scan in the same context continues after `clear` instead of starting over.
 */
type Scan = { closer: string; blkIndent: number; endLine: number; from: number; clear: number; blocked: boolean };

const lastScans = new WeakMap<StateBlock, Scan>();

function blockMath(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  // Four spaces of indentation make an indented code block instead.
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const opener = state.src.startsWith("$$", start) ? "$$" : state.src.startsWith("\\[", start) ? "\\[" : null;
  if (!opener) return false;
  const closer = opener === "$$" ? "$$" : "\\]";
  const first = state.src.slice(start + 2, trimmedEnd(state, startLine)).trimEnd();

  let lastLine = startLine;
  if (first.endsWith(closer)) {
    // `$$ x $$` on one line; text after the closer makes it part of a paragraph instead.
    const body = first.slice(0, -closer.length);
    if (body.includes(closer) || !body.trim()) return false;
  } else {
    if (first.includes(closer)) return false;
    let content = first.trim() !== "";
    let line = startLine + 1;
    const known = lastScans.get(state);
    if (
      known?.closer === closer &&
      known.blkIndent === state.blkIndent &&
      known.endLine === endLine &&
      known.from < startLine &&
      startLine < known.clear
    ) {
      // The same blank line or container end stops this scan too, with no closer before it.
      if (known.blocked) return false;
      line = known.clear + 1;
      content = true;
    }
    const fail = (clear: number, blocked: boolean) => {
      lastScans.set(state, { closer, blkIndent: state.blkIndent, endLine, from: startLine, clear, blocked });
      return false;
    };
    // Unclosed, or broken by a blank line, the end of its container or the line limit: not a
    // formula, so one stray `$$` cannot swallow the rest of the document.
    for (; ; line += 1) {
      if (line >= endLine || state.isEmpty(line) || state.sCount[line] < state.blkIndent) return fail(line - 1, true);
      if (line - startLine > MAX_DISPLAY_LINES) return fail(line - 1, false);
      const begin = state.bMarks[line] + state.tShift[line];
      const end = trimmedEnd(state, line);
      if (end - begin >= closer.length && state.src.startsWith(closer, end - closer.length)) {
        if (!content && end - closer.length <= begin) return false;
        lastLine = line;
        break;
      }
      content ||= end > begin;
    }
  }
  if (silent) return true;

  const lines = [first];
  for (let line = startLine + 1; line <= lastLine; line += 1) {
    lines.push(state.src.slice(state.bMarks[line] + state.tShift[line], trimmedEnd(state, line)));
  }
  const body = lines.join("\n").slice(0, -closer.length);

  const token = state.push("math_block", "math", 0);
  token.block = true;
  token.content = body.trim();
  token.map = [startLine, lastLine + 1];
  // Rebuilt rather than sliced, so a formula inside a blockquote copies without its `>` markers.
  token.meta = { source: `${opener}${body}${closer}` };
  state.line = lastLine + 1;
  return true;
}

/** The end of a line without its trailing whitespace. */
function trimmedEnd(state: StateBlock, line: number): number {
  const begin = state.bMarks[line] + state.tShift[line];
  let end = state.eMarks[line];
  while (end > begin && /\s/.test(state.src[end - 1])) end -= 1;
  return end;
}
