RaTeX Markdown renders Markdown files with their LaTeX math typeset by RaTeX, a KaTeX-compatible math engine written in Rust. Inline math (`$…$`, `\(…\)`) sits on the text baseline, display math (`$$…$$`, `\[…\]`, `math` code fences) is centered and scrolls sideways when it is wider than the panel, and chemistry with `\ce` works too. The rest of the document renders as well: headings, lists and task lists, quotes, tables, code blocks, footnotes, YAML front matter and images.

## Opening a file

On Paseo 0.13 and later, opening a `.md` or `.markdown` file offers **Markdown (RaTeX)** alongside Paseo's own Markdown and Source panels, and **Don't ask me again** makes it the default. On Paseo 0.11 and 0.12, which have no file panels, open a Markdown file and run **Open Markdown preview (RaTeX)** from the Command Center: the panel shows that file. Run from any other tab, it lists the workspace's Markdown files to pick from. The open document follows edits on disk.

## How it works

The daemon lays out each formula with the bundled `ratex-wasm` module and uses embedded KaTeX glyph outlines, so nothing is downloaded at runtime. The app draws each formula as a vector image that follows the Paseo theme. Selecting text across a formula copies its TeX source. A formula RaTeX cannot parse is shown as source with the error.

## Setup and requirements

Paseo 0.11.0 or later. Installing from npm or Git needs Node.js and npm on the daemon host. The npm package and the repository both include the embedded math engine and glyph outlines; a Git installation only installs the locked Markdown parser.

Desktop and web clients render formulas. iOS and Android clients render them where Paseo draws inline SVG icons (0.13 and later) and show the TeX source otherwise.

## Data access

The daemon reads only Markdown and image files inside the directory of the workspace being viewed, after resolving symlinks, and refuses paths outside it. It makes no network requests. Images with `http` or `https` addresses in a document are loaded by the app directly. Links open in the system browser only for `http`, `https` and `mailto` addresses. Raw HTML in a document is never interpreted: HTML blocks show as source, and inline tags are either dropped with their text kept (formatting such as `<kbd>`) or shown as written. On Paseo 0.11 and 0.12 the preview command reads the tab layout the app keeps in its local storage on web and desktop, only to find the open Markdown file.

## Limitations

Code blocks are not syntax highlighted and Mermaid diagrams appear as code. Images inside links, such as badges, appear as their label. Characters outside the KaTeX fonts, such as CJK in `\text{}`, use the client's system fonts.
