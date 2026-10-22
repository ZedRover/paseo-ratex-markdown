import assert from "node:assert/strict";
import { test } from "node:test";
import { focusedMarkdownFile, type KeyValueStorage } from "../client/active-file.ts";

const workspace = { id: "wks_1", directory: "/home/me/project" };

type Tab = { tabId: string; target: Record<string, unknown>; createdAt: number };

const tab = (tabId: string, target: Record<string, unknown>, createdAt = 1): Tab => ({ tabId, target, createdAt });
const file = (path: string, createdAt = 1) => tab(`file_${path}`, { kind: "file", path }, createdAt);
const pane = (id: string, tabs: Tab[], focusedTabId: string | null, hidden?: boolean) => ({
  kind: "pane",
  pane: { id, tabIds: tabs.map((entry) => entry.tabId), focusedTabId, tabs, ...(hidden ? { hidden } : {}) },
});
const group = (...children: unknown[]) => ({
  kind: "group",
  group: { id: "group", direction: "horizontal", children, sizes: children.map(() => 1 / children.length) },
});

/** localStorage as Paseo 0.11 and 0.12 leave it: zustand's envelope around the layout store. */
function storage(layoutByWorkspace: Record<string, unknown>): KeyValueStorage {
  const value = JSON.stringify({ state: { pinnedAgentIdsByWorkspace: {}, layoutByWorkspace }, version: 2 });
  return { getItem: (key) => (key === "workspace-layout-state" ? value : null) };
}

const agent = tab("agent_a", { kind: "agent", agentId: "a" });
const explorer = pane("explorer", [tab("changes_tree", { kind: "changes_tree" }), tab("files", { kind: "files" })], "files", true);

test("the Markdown file in the focused tab of this workspace", () => {
  const notes = file("docs/notes.md");
  const layouts = {
    "srv_x:wks_1": { focusedPaneId: "main", root: group(pane("main", [agent, notes], notes.tabId), explorer) },
    "srv_x:wks_2": { focusedPaneId: "main", root: pane("main", [file("other.md")], "file_other.md") },
  };
  assert.equal(focusedMarkdownFile(storage(layouts), workspace), "docs/notes.md");
  assert.equal(focusedMarkdownFile(storage(layouts), { id: "wks_2", directory: "/" }), "other.md");
  assert.equal(focusedMarkdownFile(storage(layouts), { id: "wks_3", directory: "/" }), null);
});

test("with focus elsewhere, the newest Markdown file showing in a pane", () => {
  const older = file("a.md", 10);
  const newer = file("b.markdown", 20);
  const hiddenBehind = file("c.md", 30);
  const layout = {
    focusedPaneId: "explorer",
    root: group(pane("main", [hiddenBehind, older], older.tabId), pane("side", [newer], newer.tabId), explorer),
  };
  assert.equal(focusedMarkdownFile(storage({ "srv_x:wks_1": layout }), workspace), "b.markdown");
});

test("no Markdown file showing, or state it does not recognize, gives none", () => {
  const script = file("run.py");
  const noMarkdown = { focusedPaneId: "main", root: pane("main", [agent, script], script.tabId) };
  assert.equal(focusedMarkdownFile(storage({ "srv_x:wks_1": noMarkdown }), workspace), null);
  const hidden = { focusedPaneId: "main", root: pane("main", [agent, file("x.md")], agent.tabId) };
  assert.equal(focusedMarkdownFile(storage({ "srv_x:wks_1": hidden }), workspace), null, "a tab behind another is not showing");
  assert.equal(focusedMarkdownFile(null, workspace), null);
  for (const raw of ["not json", "null", "{}", '{"state":{"layoutByWorkspace":{"srv_x:wks_1":{"root":{"kind":"pane"}}}}}']) {
    assert.equal(focusedMarkdownFile({ getItem: () => raw }, workspace), null, raw);
  }
});

test("absolute paths inside the workspace become relative", () => {
  const absolute = file("C:\\Users\\me\\project\\docs\\a.md");
  const layout = { focusedPaneId: "main", root: pane("main", [absolute], absolute.tabId) };
  assert.equal(focusedMarkdownFile(storage({ "srv_x:wks_1": layout }), { id: "wks_1", directory: "C:\\Users\\me\\project\\" }), "docs/a.md");
  const outside = file("/elsewhere/a.md");
  const other = { focusedPaneId: "main", root: pane("main", [outside], outside.tabId) };
  assert.equal(focusedMarkdownFile(storage({ "srv_x:wks_1": other }), workspace), "/elsewhere/a.md", "the daemon refuses it");
});
