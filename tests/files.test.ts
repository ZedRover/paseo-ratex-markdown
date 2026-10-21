import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { listMarkdownFilesIn, readImageIn, readMarkdownFileIn } from "../server/files.ts";

let root = "";
let outside = "";

before(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "ratex-markdown-")));
  outside = await realpath(await mkdtemp(path.join(tmpdir(), "ratex-outside-")));
  await mkdir(path.join(root, "docs", "img"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
  await mkdir(path.join(root, ".git"), { recursive: true });
  await writeFile(path.join(root, "README.md"), "﻿# Readme");
  await writeFile(path.join(root, "docs", "guide.markdown"), "# Guide");
  await writeFile(path.join(root, "docs", "notes.txt"), "not markdown");
  await writeFile(path.join(root, "node_modules", "pkg", "README.md"), "# dependency");
  await writeFile(path.join(root, ".git", "x.md"), "# git");
  await writeFile(path.join(root, "docs", "img", "dot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(path.join(outside, "secret.md"), "# secret");
  await writeFile(path.join(outside, "secret.png"), Buffer.from([1, 2, 3]));
  await symlink(path.join(outside, "secret.md"), path.join(root, "docs", "link.md"));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

test("lists Markdown files breadth first, skipping dependency and dot directories", async () => {
  const listing = await listMarkdownFilesIn(root);
  assert.deepEqual(
    listing.files.map((file) => file.path),
    ["README.md", "docs/guide.markdown"],
  );
  assert.equal(listing.truncated, false);
});

test("reads Markdown inside the workspace and reports unchanged revisions", async () => {
  const first = await readMarkdownFileIn(root, "README.md");
  assert.equal(first.status, "ok");
  assert.equal(first.status === "ok" ? first.text : "", "# Readme", "the byte order mark is dropped");
  const again = await readMarkdownFileIn(root, path.join(root, "README.md"), first.status === "ok" ? first.revision : "");
  assert.equal(again.status, "unchanged");
});

test("refuses paths outside the workspace, symlink escapes and other file types", async () => {
  for (const target of ["../" + path.basename(outside) + "/secret.md", path.join(outside, "secret.md"), "docs/link.md", "docs/notes.txt", "missing.md"]) {
    const result = await readMarkdownFileIn(root, target);
    assert.equal(result.status, "missing", target);
  }
});

test("reads images relative to the document and refuses everything else", async () => {
  const image = await readImageIn(root, "docs/guide.markdown", "img/dot.png");
  assert.deepEqual(image, { ok: true, mimeType: "image/png", base64: "iVBORw==" });
  const rooted = await readImageIn(root, "docs/guide.markdown", "/docs/img/dot.png");
  assert.equal(rooted.ok, true, "a leading slash means the workspace root");
  for (const src of [path.join(outside, "secret.png"), "../../" + path.basename(outside) + "/secret.png", "notes.txt", "https://example.com/a.png", "data:image/png;base64,AA"]) {
    const result = await readImageIn(root, "docs/guide.markdown", src);
    assert.equal(result.ok, false, src);
  }
});
