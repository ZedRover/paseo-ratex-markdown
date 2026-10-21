import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { FlatList, Icon, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { listMarkdownFilesRpc, readImageRpc, readMarkdownFileRpc } from "../shared/contracts";
import { MarkdownDocument } from "./document";
import type { DocumentEnvironment, ImageResult } from "./document-context";
import { isExternalLink, resolveMarkdownLink } from "./links";

/** How often an open document checks the disk; unchanged files are not sent again. */
const POLL_INTERVAL = 2000;

/** The file each workspace showed last, so reopening the panel returns to it. */
const lastOpened = new Map<string, string>();

type Theme = PluginWorkspacePanelProps["theme"];
type Layout = PluginWorkspacePanelProps["layout"];
type DocumentData = { text: string; revision: string };

/**
 * A workspace tab that shows a Markdown file of the workspace with RaTeX math. Hosts without
 * file panels get this instead of rendering inside the file tab itself.
 */
export function MarkdownPreviewPanel({ workspaceId, theme, layout }: PluginWorkspacePanelProps) {
  const [path, setPath] = useState<string | null>(() => lastOpened.get(workspaceId) ?? null);
  const [picking, setPicking] = useState(false);
  const queryClient = useQueryClient();
  const styles = useMemo(() => panelStyles(theme, layout.compact), [theme, layout.compact]);

  const open = useCallback(
    (next: string) => {
      lastOpened.set(workspaceId, next);
      setPath(next);
      setPicking(false);
    },
    [workspaceId],
  );
  const reload = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["ratex-markdown", "file", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ["ratex-markdown", "files", workspaceId] });
  }, [queryClient, workspaceId]);

  return (
    <View style={styles.panel}>
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose a Markdown file"
          onPress={() => setPicking(true)}
          style={styles.pathButton}
        >
          <Icon name="FileText" size={16} color={theme.colors.foregroundMuted} />
          <Text numberOfLines={1} style={path ? styles.pathText : styles.mutedText}>
            {path ?? "Choose a Markdown file"}
          </Text>
          <Icon name="ChevronDown" size={14} color={theme.colors.foregroundMuted} />
        </Pressable>
        {path ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Reload" onPress={reload} style={styles.iconButton}>
            <Icon name="RefreshCw" size={16} color={theme.colors.foregroundMuted} />
          </Pressable>
        ) : null}
      </View>
      {path ? (
        <DocumentFile key={path} workspaceId={workspaceId} path={path} onOpen={open} onPick={() => setPicking(true)} theme={theme} layout={layout} />
      ) : (
        <FilePicker workspaceId={workspaceId} onPick={open} theme={theme} layout={layout} />
      )}
      <Modal title="Open a Markdown file" open={picking} onOpenChange={setPicking}>
        <Modal.Content scrollable={false} contentContainerStyle={{ padding: 0, gap: 0 }} style={{ backgroundColor: theme.colors.surface0 }}>
          <FilePicker workspaceId={workspaceId} onPick={open} theme={theme} layout={layout} current={path} />
        </Modal.Content>
      </Modal>
    </View>
  );
}

function DocumentFile({
  workspaceId,
  path,
  onOpen,
  onPick,
  theme,
  layout,
}: {
  workspaceId: string;
  path: string;
  onOpen(path: string): void;
  onPick(): void;
  theme: Theme;
  layout: Layout;
}) {
  const readFile = useRpc(readMarkdownFileRpc);
  const readImage = useRpc(readImageRpc);
  const queryClient = useQueryClient();
  const styles = useMemo(() => panelStyles(theme, layout.compact), [theme, layout.compact]);
  const queryKey = useMemo(() => ["ratex-markdown", "file", workspaceId, path], [workspaceId, path]);
  const file = useQuery<DocumentData>({
    queryKey,
    queryFn: async () => {
      const previous = queryClient.getQueryData<DocumentData>(queryKey);
      const response = await readFile({ workspaceId, path, knownRevision: previous?.revision });
      if (response.status === "unchanged" && previous) return previous;
      if (response.status === "ok") return { text: response.text, revision: response.revision };
      throw new Error(response.status === "missing" ? response.message : `${path} changed while it was read.`);
    },
    refetchInterval: POLL_INTERVAL,
    refetchIntervalInBackground: false,
    retry: false,
  });

  const { compact, platform } = layout;
  const environment = useMemo<DocumentEnvironment>(
    () => ({
      theme,
      layout: { compact, platform },
      documentId: `${workspaceId}:${path}`,
      loadImage: async (src): Promise<ImageResult> => {
        const result = await readImage({ workspaceId, documentPath: path, src });
        return result.ok ? { uri: `data:${result.mimeType};base64,${result.base64}` } : { error: result.error };
      },
      openLink: (href) => {
        if (isExternalLink(href)) {
          void openExternalUrl(href);
          return;
        }
        const target = resolveMarkdownLink(path, href);
        if (target) onOpen(target);
      },
    }),
    [theme, compact, platform, workspaceId, path, readImage, onOpen],
  );

  if (file.data) {
    return (
      <ScrollView style={{ flex: 1 }}>
        <MarkdownDocument source={file.data.text} environment={environment} />
      </ScrollView>
    );
  }
  if (file.isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{file.error.message}</Text>
        <Pressable accessibilityRole="button" onPress={onPick} style={styles.button}>
          <Text style={styles.buttonText}>Choose another file</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.center}>
      <ActivityIndicator color={theme.colors.foregroundMuted} />
    </View>
  );
}

function FilePicker({
  workspaceId,
  onPick,
  theme,
  layout,
  current = null,
}: {
  workspaceId: string;
  onPick(path: string): void;
  theme: Theme;
  layout: Layout;
  current?: string | null;
}) {
  const listFiles = useRpc(listMarkdownFilesRpc);
  const files = useQuery({
    queryKey: ["ratex-markdown", "files", workspaceId],
    queryFn: () => listFiles({ workspaceId }),
    staleTime: 15 * 1000,
  });
  const [filter, setFilter] = useState("");
  const styles = useMemo(() => panelStyles(theme, layout.compact), [theme, layout.compact]);
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const all = files.data?.files ?? [];
    return needle ? all.filter((file) => file.path.toLowerCase().includes(needle)) : all;
  }, [files.data, filter]);

  let body;
  if (files.isPending) {
    body = (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.foregroundMuted} />
      </View>
    );
  } else if (files.isError) {
    body = (
      <View style={styles.center}>
        <Text style={styles.errorText}>{files.error.message}</Text>
      </View>
    );
  } else if (visible.length === 0) {
    body = (
      <View style={styles.center}>
        <Text style={styles.mutedText}>{filter ? "No Markdown file matches." : "This workspace has no Markdown files."}</Text>
      </View>
    );
  } else {
    body = (
      <FlatList
        style={{ flex: 1, minHeight: 0 }}
        data={visible}
        keyExtractor={(file) => file.path}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.path}`}
            onPress={() => onPick(item.path)}
            style={[styles.fileRow, item.path === current && styles.fileRowActive]}
          >
            <Icon name="FileText" size={16} color={theme.colors.foregroundMuted} />
            <Text numberOfLines={1} style={styles.fileName}>
              {item.path}
            </Text>
            <Text style={styles.fileSize}>{formatSize(item.size)}</Text>
          </Pressable>
        )}
      />
    );
  }

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View style={styles.searchRow}>
        <TextInput
          value={filter}
          onChangeText={setFilter}
          placeholder="Filter Markdown files"
          placeholderTextColor={theme.colors.foregroundMuted}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Filter Markdown files"
          style={styles.search}
        />
      </View>
      {body}
      {files.data?.truncated ? (
        <Text style={[styles.mutedText, styles.footer]}>Showing the first {files.data.files.length} files.</Text>
      ) : null}
    </View>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function panelStyles(theme: Theme, compact: boolean) {
  const { colors } = theme;
  const gutter = compact ? 12 : 16;
  return {
    panel: { flex: 1, minHeight: 0, backgroundColor: colors.surface0 },
    toolbar: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingHorizontal: gutter,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface0,
    },
    pathButton: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    },
    pathText: { flexShrink: 1, color: colors.foreground, fontSize: 13 },
    mutedText: { flexShrink: 1, color: colors.foregroundMuted, fontSize: 13 },
    iconButton: { padding: 8, borderRadius: 8 },
    center: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, gap: 12, padding: 24 },
    errorText: { color: colors.statusDanger, fontSize: 14, textAlign: "center" as const },
    button: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: colors.accent },
    buttonText: { color: colors.accentForeground, fontSize: 13, fontWeight: "600" as const },
    searchRow: { paddingHorizontal: gutter, paddingVertical: 10 },
    search: {
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface2,
      color: colors.foreground,
      fontSize: 14,
    },
    fileRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
      paddingVertical: compact ? 10 : 8,
      paddingHorizontal: gutter,
    },
    fileRowActive: { backgroundColor: colors.surface1 },
    fileName: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 14 },
    fileSize: { color: colors.foregroundMuted, fontSize: 12 },
    footer: { paddingHorizontal: gutter, paddingVertical: 8 },
  };
}
