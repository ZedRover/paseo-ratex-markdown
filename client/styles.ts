import type { PluginTheme } from "@getpaseo/plugin";
import { Platform, type TextStyle, type ViewStyle } from "react-native";

/**
 * Paseo's default code font stack on web. A bare "monospace" lets Chromium pick the locale's
 * fixed font, such as NSimSun on Chinese Windows. Native resolves a single family name.
 */
export const CODE_FONT_FAMILY =
  Platform.OS === "web"
    ? "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
    : Platform.OS === "ios"
      ? "Menlo"
      : "monospace";

/** KaTeX draws math at 1.21 times the surrounding text; RaTeX uses the same fonts and metrics. */
export const MATH_SCALE = 1.21;

export const BODY_FONT_SIZE = 15;
const LINE_HEIGHT = 24;
const HEADING_SIZES = [26, 21, 18, 16, 15, 14] as const;

export type Colors = PluginTheme["colors"];
export type DocumentStyles = ReturnType<typeof documentStyles>;

export function headingSize(level: number): number {
  return HEADING_SIZES[Math.min(Math.max(level, 1), 6) - 1];
}

export function documentStyles(colors: Colors, compact: boolean) {
  const gap = compact ? 12 : 14;
  const text: TextStyle = { color: colors.foreground, fontSize: BODY_FONT_SIZE, lineHeight: LINE_HEIGHT };
  const code: TextStyle = { fontFamily: CODE_FONT_FAMILY, fontSize: 13, lineHeight: 20 };
  return {
    gap,
    document: { gap, paddingHorizontal: compact ? 16 : 28, paddingVertical: compact ? 16 : 24 } satisfies ViewStyle,
    blocks: { gap } satisfies ViewStyle,
    tightBlocks: { gap: 4 } satisfies ViewStyle,
    paragraph: text,
    heading: (level: number): TextStyle => ({
      color: level === 6 ? colors.foregroundMuted : colors.foreground,
      fontSize: headingSize(level),
      lineHeight: Math.round(headingSize(level) * 1.3),
      fontWeight: level <= 2 ? "700" : "600",
      marginTop: level <= 2 ? gap / 2 : 0,
    }),
    headingRule: { height: 1, backgroundColor: colors.border, marginTop: 6 } satisfies ViewStyle,
    strong: { fontWeight: "700" } satisfies TextStyle,
    em: { fontStyle: "italic" } satisfies TextStyle,
    del: { textDecorationLine: "line-through" } satisfies TextStyle,
    link: { color: colors.accent, textDecorationLine: "underline" } satisfies TextStyle,
    inlineCode: { ...code, color: colors.foreground, backgroundColor: colors.surface2 } satisfies TextStyle,
    footnoteRef: { color: colors.accent, fontSize: 11, lineHeight: 16 } satisfies TextStyle,
    muted: { color: colors.foregroundMuted } satisfies TextStyle,
    codeBlock: {
      backgroundColor: colors.surface1,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      gap: 6,
    } satisfies ViewStyle,
    codeLanguage: { ...code, fontSize: 11, lineHeight: 14, color: colors.foregroundMuted } satisfies TextStyle,
    codeText: { ...code, color: colors.foreground } satisfies TextStyle,
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: colors.border,
      paddingLeft: 12,
      gap,
    } satisfies ViewStyle,
    listItem: { flexDirection: "row", alignItems: "flex-start", gap: 6 } satisfies ViewStyle,
    listMarker: { minWidth: 22, alignItems: "flex-end", paddingTop: 0 } satisfies ViewStyle,
    listMarkerText: { ...text, color: colors.foregroundMuted } satisfies TextStyle,
    listContent: { flex: 1, minWidth: 0 } satisfies ViewStyle,
    rule: { height: 1, backgroundColor: colors.border } satisfies ViewStyle,
    table: { borderColor: colors.border, borderWidth: 1, borderRadius: 6, overflow: "hidden" } satisfies ViewStyle,
    tableRow: { flexDirection: "row" } satisfies ViewStyle,
    tableHeaderRow: { flexDirection: "row", backgroundColor: colors.surface1 } satisfies ViewStyle,
    tableCell: {
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderColor: colors.border,
      borderRightWidth: 1,
      borderTopWidth: 1,
      justifyContent: "center",
    } satisfies ViewStyle,
    tableHeaderText: { ...text, fontWeight: "600" } satisfies TextStyle,
    displayMath: { alignItems: "center", paddingVertical: 4 } satisfies ViewStyle,
    displayMathScroll: { flexGrow: 1, justifyContent: "center" } satisfies ViewStyle,
    mathSource: { ...code, color: colors.foregroundMuted } satisfies TextStyle,
    mathError: { ...code, color: colors.statusDanger } satisfies TextStyle,
    mathErrorMessage: { fontSize: 12, lineHeight: 16, color: colors.statusDanger } satisfies TextStyle,
    html: { ...code, color: colors.foregroundMuted } satisfies TextStyle,
    image: { alignSelf: "flex-start", maxWidth: "100%", borderRadius: 4 } satisfies ViewStyle,
    imagePlaceholder: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      alignSelf: "flex-start",
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    } satisfies ViewStyle,
    caption: { fontSize: 12, lineHeight: 16, color: colors.foregroundMuted } satisfies TextStyle,
    frontMatter: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      overflow: "hidden",
    } satisfies ViewStyle,
    frontMatterRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.border } satisfies ViewStyle,
    frontMatterKey: {
      width: compact ? 110 : 160,
      paddingVertical: 6,
      paddingHorizontal: 10,
      backgroundColor: colors.surface2,
    } satisfies ViewStyle,
    frontMatterValue: { flex: 1, paddingVertical: 6, paddingHorizontal: 10 } satisfies ViewStyle,
    frontMatterKeyText: { ...code, color: colors.foregroundMuted } satisfies TextStyle,
    footnotes: { gap: 8 } satisfies ViewStyle,
    footnote: { flexDirection: "row", gap: 6 } satisfies ViewStyle,
    footnoteLabel: { fontSize: 13, lineHeight: 22, color: colors.foregroundMuted, minWidth: 22, textAlign: "right" } satisfies TextStyle,
    footnoteText: { ...text, fontSize: 13, lineHeight: 22 } satisfies TextStyle,
  };
}
