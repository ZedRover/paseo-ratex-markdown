import type { PluginClientContext } from "@getpaseo/plugin/client";
import { registerFilePanel } from "./client/file-panel";
import { MarkdownPreviewPanel } from "./client/workspace-panel";

export default function contribute(client: PluginClientContext) {
  // Where the host can open Markdown files with a plugin panel, that is the whole integration.
  if (registerFilePanel(client)) return () => {};

  client.addWorkspacePanel({
    id: "preview",
    title: "Markdown (RaTeX)",
    icon: "Sigma",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: MarkdownPreviewPanel,
  });
  client.addCommandCenterItem({
    id: "open-preview",
    title: "Open Markdown preview (RaTeX)",
    icon: "Sigma",
    keywords: ["markdown", "math", "latex", "ratex", "preview"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("preview");
    },
  });
  return () => {};
}
