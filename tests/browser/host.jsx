// Stands in for the Paseo app: evaluates the compiled client bundle the way Paseo does, maps the
// host modules plugins may import, and renders the panel the plugin registers.
import * as React from "react";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as ReactNative from "react-native";
import * as ReactQuery from "@tanstack/react-query";
import * as Zod from "zod";
import { createRoot } from "react-dom/client";

const params = new URLSearchParams(location.search);
const mode = params.get("mode") ?? "workspace";
const platform = params.get("platform") ?? "web";
const svgIcons = params.get("svgIcons") === "1";

const THEMES = {
  dark: {
    surface0: "#121212", surface1: "#1b1b1c", surface2: "#242426", border: "#2e2e31",
    foreground: "#e8e8e8", foregroundMuted: "#9b9ba1", accent: "#6aa6ff", accentForeground: "#0b0b0c",
    statusSuccess: "#4ade80", statusWarning: "#facc15", statusDanger: "#f87171",
  },
  light: {
    surface0: "#ffffff", surface1: "#f6f7f9", surface2: "#eef0f3", border: "#dfe2e7",
    foreground: "#1d1f23", foregroundMuted: "#646b75", accent: "#2563eb", accentForeground: "#ffffff",
    statusSuccess: "#16a34a", statusWarning: "#ca8a04", statusDanger: "#dc2626",
  },
};

window.rpcCalls = [];
window.openedUrls = [];
window.fileListeners = new Set();

async function callRpc(name, input) {
  window.rpcCalls.push({ name, input });
  const response = await fetch(`/rpc/${name}`, { method: "POST", body: JSON.stringify(input) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function Icon({ name, icon, size = 24, color = "currentColor" }) {
  if (icon && typeof icon.svg === "string") {
    // Paseo draws inline SVG at size x size with `color` as currentColor; an <img> of the same
    // markup is the closest a browser fixture gets to react-native-svg's SvgXml.
    const markup = icon.svg.replace(/currentColor/g, color);
    return React.createElement("img", {
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`,
      style: { width: size, height: size, display: "block" },
      "data-icon": "svg",
    });
  }
  // Lucide icons from the harness server, so screenshots look like Paseo.
  const file = name.replace(/([a-z\d])([A-Z])/g, "$1-$2").toLowerCase();
  return React.createElement("img", {
    src: `/lucide/${file}.svg?color=${encodeURIComponent(color)}`,
    style: { width: size, height: size, display: "block" },
    "data-icon": name,
  });
}

function Modal({ open, title, children }) {
  if (!open) return null;
  return React.createElement(
    ReactNative.View,
    { testID: "modal", style: { position: "absolute", top: 40, left: 20, right: 20, height: 420, borderWidth: 1, borderColor: "#888", backgroundColor: "#000" } },
    React.createElement(ReactNative.Text, { style: { color: "#fff", padding: 8 } }, title),
    children,
  );
}
Modal.Content = ({ children, style }) => React.createElement(ReactNative.View, { style: [{ flex: 1, minHeight: 0 }, style] }, children);

const hostModules = {
  react: React,
  "react/jsx-runtime": ReactJsxRuntime,
  "react-native": ReactNative,
  "@tanstack/react-query": ReactQuery,
  zod: Zod,
  // Paseo hosts that draw inline SVG icons also export the validator from the shared SDK.
  "@getpaseo/plugin": svgIcons ? { defineRpc: (contract) => contract, findSvgIconProblem: () => null } : { defineRpc: (contract) => contract },
  "@getpaseo/plugin/client": {
    // Like the SDK's callPluginRpc: the contract checks the input and the output on the client too.
    useRpc: (contract) =>
      React.useCallback(
        async (input) => contract.output.parseAsync(await callRpc(contract.name, await contract.input.parseAsync(input))),
        [contract],
      ),
    openExternalUrl: async (url) => {
      window.openedUrls.push(url);
    },
  },
  "@getpaseo/plugin/client/react-native": {
    Icon,
    Modal,
    FlatList: ReactNative.FlatList,
    ScrollView: ReactNative.ScrollView,
    TextInput: ReactNative.TextInput,
  },
};

function runtimeRequire(name) {
  if (name in hostModules) return hostModules[name];
  throw new Error(`Module "${name}" is not available in plugin client code`);
}

const registrations = { workspacePanels: [], commands: [], filePanels: [] };
const client = {
  addWorkspacePanel: (panel) => (registrations.workspacePanels.push(panel), () => {}),
  addCommandCenterItem: (item) => (registrations.commands.push(item), () => {}),
};
if (mode === "file") client.addFilePanel = (panel) => (registrations.filePanels.push(panel), () => {});

const bundle = await (await fetch("/plugin.js")).text();
const exports = globalThis.eval(bundle)(runtimeRequire);
exports.default(client);
window.registrations = {
  workspacePanels: registrations.workspacePanels.map(({ id, title, icon, context, locations }) => ({ id, title, icon, context, locations })),
  commands: registrations.commands.map(({ id, title, context }) => ({ id, title, context })),
  filePanels: registrations.filePanels.map(({ id, title, icon, files }) => ({ id, title, icon, files })),
};

const queryClient = new ReactQuery.QueryClient({ defaultOptions: { queries: { retry: false } } });
window.pendingQueries = () => queryClient.isFetching();

function fakeFile(path) {
  return {
    path,
    name: path.split("/").pop(),
    extension: "md",
    readText: async () => {
      const response = await fetch(`/file?path=${encodeURIComponent(path)}`);
      if (!response.ok) throw new Error(await response.text());
      return response.text();
    },
    watch(listener) {
      window.fileListeners.add(listener);
      return () => window.fileListeners.delete(listener);
    },
  };
}
window.notifyFile = (event) => window.fileListeners.forEach((listener) => listener(event));

function App() {
  const [state, setState] = React.useState({
    theme: params.get("theme") ?? "dark",
    compact: params.get("compact") === "1",
  });
  window.setFixture = (changes) => setState((previous) => ({ ...previous, ...changes }));
  const theme = React.useMemo(() => ({ colors: THEMES[state.theme] }), [state.theme]);
  const layout = React.useMemo(() => ({ compact: state.compact, platform }), [state.compact]);
  const common = { theme, layout, host: { id: "local", label: "Local" } };
  const file = React.useMemo(() => fakeFile(params.get("file") ?? ""), []);
  const panel =
    mode === "file"
      ? React.createElement(registrations.filePanels[0].Component, {
          ...common,
          workspaceId: "workspace",
          file,
          tab: { setModified() {} },
          location: { revision: 0 },
        })
      : React.createElement(registrations.workspacePanels[0].Component, { ...common, context: "workspace", workspaceId: "workspace" });
  return React.createElement(
    ReactNative.View,
    { style: { height: "100vh", backgroundColor: theme.colors.surface0 } },
    React.createElement(ReactQuery.QueryClientProvider, { client: queryClient }, panel),
  );
}

// Paseo forces its interface font on every node except [data-pmono] subtrees.
const style = document.createElement("style");
style.textContent = ":is(#root) *:not([data-pmono]):not([data-pmono] *){font-family:system-ui,sans-serif;}";
document.head.appendChild(style);

createRoot(document.getElementById("root")).render(React.createElement(App));
