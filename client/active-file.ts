/**
 * The Markdown file open in Paseo's own file tab, so the preview command can show it.
 *
 * Paseo 0.11 and 0.12 tell plugins nothing about open tabs. On web and desktop the app persists
 * its workspace layout in localStorage, and plugin code runs in the app's page, so this reads that
 * private state. Anything it does not recognize means no file: the panel then keeps its own.
 */

export type KeyValueStorage = { getItem(key: string): string | null };

const LAYOUT_STORAGE_KEY = "workspace-layout-state";

type StoredTab = { tabId?: unknown; createdAt?: unknown; target?: { kind?: unknown; path?: unknown } };
type StoredPane = { id?: unknown; focusedTabId?: unknown; tabs?: unknown };
type StoredNode = { kind?: unknown; pane?: StoredPane; group?: { children?: unknown } };
type StoredLayout = { focusedPaneId?: unknown; root?: StoredNode };

/** The app's localStorage, or null on native clients and where storage is blocked. */
export function hostStorage(): KeyValueStorage | null {
  try {
    const storage = (globalThis as { localStorage?: KeyValueStorage }).localStorage;
    return typeof storage?.getItem === "function" ? storage : null;
  } catch {
    return null;
  }
}

/**
 * The workspace-relative path of the Markdown file in the focused tab. When focus sits elsewhere,
 * such as the file tree, the newest Markdown file showing in any pane.
 */
export function focusedMarkdownFile(
  storage: KeyValueStorage | null,
  workspace: { id: string; directory: string },
): string | null {
  for (const layout of storedLayouts(storage, workspace.id)) {
    const panes = collectPanes(layout.root);
    const focused = panes.find((pane) => pane.id === layout.focusedPaneId);
    const shown = panes.map(visibleTab).filter((tab): tab is StoredTab => markdownPath(tab) !== null);
    shown.sort((a, b) => createdAt(b) - createdAt(a));
    const path = markdownPath(focused && visibleTab(focused)) ?? markdownPath(shown[0]);
    if (path) return workspaceRelative(path, workspace.directory);
  }
  return null;
}

/** Layouts are keyed `serverId:workspaceId`; the plugin knows only the workspace. */
function storedLayouts(storage: KeyValueStorage | null, workspaceId: string): StoredLayout[] {
  let state: unknown;
  try {
    state = JSON.parse(storage?.getItem(LAYOUT_STORAGE_KEY) ?? "null")?.state;
  } catch {
    return [];
  }
  const layouts = (state as { layoutByWorkspace?: unknown } | null)?.layoutByWorkspace;
  if (!layouts || typeof layouts !== "object") return [];
  return Object.entries(layouts)
    .filter(([key, layout]) => key.endsWith(`:${workspaceId}`) && layout && typeof layout === "object")
    .map(([, layout]) => layout as StoredLayout);
}

function collectPanes(node: StoredNode | undefined): StoredPane[] {
  if (node?.kind === "pane" && node.pane) return [node.pane];
  const children = node?.kind === "group" ? node.group?.children : null;
  return Array.isArray(children) ? children.flatMap((child: StoredNode) => collectPanes(child)) : [];
}

function visibleTab(pane: StoredPane): StoredTab | undefined {
  return Array.isArray(pane.tabs) ? pane.tabs.find((tab: StoredTab) => tab?.tabId === pane.focusedTabId) : undefined;
}

function markdownPath(tab: StoredTab | undefined): string | null {
  const path = tab?.target?.kind === "file" ? tab.target.path : null;
  return typeof path === "string" && /\.(md|markdown)$/i.test(path) ? path : null;
}

function createdAt(tab: StoredTab): number {
  return typeof tab.createdAt === "number" ? tab.createdAt : 0;
}

/** File tabs hold workspace-relative paths, but an absolute one inside the workspace is trimmed too. */
function workspaceRelative(file: string, directory: string): string {
  const path = file.replace(/\\/g, "/");
  const root = directory.replace(/\\/g, "/").replace(/\/+$/, "");
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}
