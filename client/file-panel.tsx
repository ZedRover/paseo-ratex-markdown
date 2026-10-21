import type { PluginClientContext, PluginHostProps } from "@getpaseo/plugin/client";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { readImageRpc } from "../shared/contracts";
import { MarkdownDocument } from "./document";
import type { DocumentEnvironment, ImageResult } from "./document-context";
import { isExternalLink } from "./links";

// File panels arrive with Paseo 0.13 (getpaseo/paseo#7411). This plugin builds against the 0.11
// SDK so it keeps working on older hosts; these are the parts of that contract it uses.
type PluginFile = {
  readonly path: string;
  readonly name: string;
  readText(): Promise<string>;
  watch(listener: (event: { type: string }) => void): () => void;
};

type FilePanelProps = PluginHostProps & { workspaceId: string; file: PluginFile };

type FilePanelHost = {
  addFilePanel(contribution: {
    id: string;
    title: string;
    icon: string;
    files: { extensions: readonly string[] };
    Component: ComponentType<FilePanelProps>;
  }): () => void;
};

/** Offers this renderer for Markdown files where the host has file panels. */
export function registerFilePanel(client: PluginClientContext): boolean {
  const host = client as PluginClientContext & Partial<FilePanelHost>;
  if (typeof host.addFilePanel !== "function") return false;
  try {
    host.addFilePanel({
      id: "markdown",
      title: "Markdown (RaTeX)",
      icon: "Sigma",
      files: { extensions: ["md", "markdown"] },
      Component: MarkdownFilePanel,
    });
    return true;
  } catch (error) {
    console.warn("[paseo-ratex-markdown] Could not register the file panel; using the workspace panel.", error);
    return false;
  }
}

type FileState =
  | { status: "loading" }
  | { status: "ready"; text: string }
  | { status: "failed"; message: string; text?: string }
  | { status: "deleted"; text?: string };

function MarkdownFilePanel({ file, workspaceId, theme, layout }: FilePanelProps) {
  const [state, setState] = useState<FileState>({ status: "loading" });
  const usable = typeof file?.readText === "function" && typeof file?.watch === "function";

  useEffect(() => {
    if (!usable) return;
    let active = true;
    let generation = 0;
    const load = async () => {
      const current = ++generation;
      try {
        const text = await file.readText();
        if (active && current === generation) setState({ status: "ready", text });
      } catch (error) {
        if (active && current === generation) {
          setState((previous) => ({ status: "failed", message: messageOf(error), text: textOf(previous) }));
        }
      }
    };
    void load();
    const unwatch = file.watch((event) => {
      if (event.type !== "deleted") {
        void load();
        return;
      }
      generation += 1;
      setState((previous) => ({ status: "deleted", text: textOf(previous) }));
    });
    return () => {
      active = false;
      unwatch();
    };
  }, [file, usable]);

  const readImage = useRpc(readImageRpc);
  const { compact, platform } = layout;
  const environment = useMemo<DocumentEnvironment>(
    () => ({
      theme,
      layout: { compact, platform },
      documentId: file.path,
      loadImage: async (src): Promise<ImageResult> => {
        const result = await readImage({ workspaceId, documentPath: file.path, src });
        return result.ok ? { uri: `data:${result.mimeType};base64,${result.base64}` } : { error: result.error };
      },
      openLink: (href) => {
        if (isExternalLink(href)) void openExternalUrl(href);
      },
    }),
    [theme, compact, platform, file.path, workspaceId, readImage],
  );

  const styles = useMemo(
    () => ({
      panel: { flex: 1, minHeight: 0, backgroundColor: theme.colors.surface0 },
      center: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, padding: 24 },
      banner: {
        paddingVertical: 8,
        paddingHorizontal: 16,
        backgroundColor: theme.colors.surface1,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      bannerText: { color: theme.colors.foregroundMuted, fontSize: 13 },
      error: { color: theme.colors.statusDanger, fontSize: 14, textAlign: "center" as const },
    }),
    [theme],
  );

  if (!usable) {
    return (
      <View style={[styles.panel, styles.center]}>
        <Text style={styles.error}>This Paseo version passes file panels a file this plugin does not understand. Update the plugin.</Text>
      </View>
    );
  }
  const text = textOf(state);
  if (text === undefined) {
    return (
      <View style={[styles.panel, styles.center]}>
        {state.status === "failed" ? (
          <Text style={styles.error}>{state.message}</Text>
        ) : state.status === "deleted" ? (
          <Text style={styles.error}>{file.name} was deleted.</Text>
        ) : (
          <ActivityIndicator color={theme.colors.foregroundMuted} />
        )}
      </View>
    );
  }
  const notice =
    state.status === "deleted"
      ? `${file.name} was deleted on disk. Showing the last version read.`
      : state.status === "failed"
        ? `Could not read the latest version: ${state.message}`
        : null;
  return (
    <View style={styles.panel}>
      {notice ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{notice}</Text>
        </View>
      ) : null}
      <ScrollView style={{ flex: 1 }}>
        <MarkdownDocument source={text} environment={environment} />
      </ScrollView>
    </View>
  );
}

function textOf(state: FileState): string | undefined {
  return "text" in state ? state.text : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
