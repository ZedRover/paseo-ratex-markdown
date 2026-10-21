import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo, useRef, type ComponentType, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { MAX_LATEX_LENGTH, renderMathRpc } from "../../shared/contracts";
import { hostDrawsSvgIcons } from "../capabilities";
import { MATH_SCALE, type DocumentStyles } from "../styles";
import { webFormula } from "../web";
import { FormulaLoader, type FormulaResult } from "./loader";
import { nativeFormula, type NativeFormula } from "./native";
import { formulaImage } from "./svg";

const LoaderContext = createContext<FormulaLoader | null>(null);

/** One loader per document, so all of its formulas share batched requests. */
export function FormulaLoaderProvider({ children }: { children: ReactNode }) {
  const renderMath = useRpc(renderMathRpc);
  const latest = useRef(renderMath);
  latest.current = renderMath;
  const loader = useMemo(() => new FormulaLoader((input) => latest.current(input)), []);
  return <LoaderContext.Provider value={loader}>{children}</LoaderContext.Provider>;
}

function useFormula(latex: string, display: boolean, enabled: boolean) {
  const loader = useContext(LoaderContext);
  return useQuery<FormulaResult>({
    queryKey: ["ratex-markdown", "formula", display, latex],
    queryFn: () => loader!.load(latex, display),
    enabled: enabled && loader !== null,
    // A formula always lays out the same way; the theme only changes how it is painted.
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    structuralSharing: false,
    // Keep the previous drawing while an edited formula re-renders, instead of collapsing it.
    placeholderData: (previous) => previous,
  });
}

// The host's Icon accepts inline SVG once hostDrawsSvgIcons() holds; the 0.11 SDK types predate it.
const SvgIcon = Icon as unknown as ComponentType<{ icon: { svg: string }; size: number; color: string }>;

export type FormulaProps = {
  latex: string;
  /** The formula as written, delimiters included: what a copy yields and what failures show. */
  source: string;
  display: boolean;
  /** Size of the surrounding text; math is drawn a little larger, as KaTeX does. */
  fontSize: number;
  color: string;
  platform: "ios" | "android" | "web";
  styles: DocumentStyles;
};

export function Formula({ latex, source, display, fontSize, color, platform, styles }: FormulaProps) {
  const web = platform === "web";
  const drawable = latex.length <= MAX_LATEX_LENGTH && (web || hostDrawsSvgIcons());
  const query = useFormula(latex, display, drawable);
  // A disabled query still serves placeholder data: the drawing of what the formula was before.
  const result = drawable ? query.data : undefined;
  const mathSize = fontSize * MATH_SCALE;
  const drawing = useMemo(() => {
    if (!result?.ok) return null;
    return web
      ? { web: formulaImage(result.scene, result.outlines, { color, fontSize: mathSize }) }
      : { native: nativeFormula(result.scene, result.outlines, { color, fontSize: mathSize }) };
  }, [result, web, color, mathSize]);

  if (!drawing) {
    // Loading, failed, or a client that cannot draw vectors: the TeX itself, selectable.
    const error = result && !result.ok ? result.error : query.isError ? messageOf(query.error) : null;
    const text = (
      <Text selectable style={error ? styles.mathError : styles.mathSource}>
        {source}
      </Text>
    );
    if (!display) return text;
    return (
      <View style={styles.displayMath} accessibilityLabel={error ?? undefined}>
        {text}
        {error ? <Text style={styles.mathErrorMessage}>{error}</Text> : null}
      </View>
    );
  }

  const body = drawing.web ? (
    webFormula({ image: drawing.web, display, source })
  ) : (
    <NativeFormulaView formula={drawing.native} display={display} label={source} />
  );
  if (!display) return body;
  // Wide equations scroll sideways instead of shrinking to unreadable sizes.
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.displayMathScroll}>
      <View style={styles.displayMath}>{body}</View>
    </ScrollView>
  );
}

function NativeFormulaView({ formula, display, label }: { formula: NativeFormula; display: boolean; label: string }) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      pointerEvents="none"
      style={{
        width: formula.width,
        height: formula.height,
        // Inline views sit on the text baseline; the formula's own baseline is depth above its bottom.
        transform: display ? undefined : [{ translateY: formula.depth }],
      }}
    >
      {formula.parts.map((part) =>
        part.kind === "icon" ? (
          <View
            key={part.key}
            style={{ position: "absolute", left: part.left, top: part.top, width: part.size, height: part.size }}
          >
            <SvgIcon icon={{ svg: part.svg }} size={part.size} color={part.color} />
          </View>
        ) : part.kind === "rule" ? (
          <View
            key={part.key}
            style={{
              position: "absolute",
              left: part.left,
              top: part.top,
              width: part.width,
              height: part.height,
              backgroundColor: part.color,
            }}
          />
        ) : (
          <Text
            key={part.key}
            style={{
              position: "absolute",
              left: part.left,
              top: part.top,
              fontSize: part.fontSize,
              lineHeight: part.fontSize * 1.2,
              color: part.color,
            }}
          >
            {part.text}
          </Text>
        ),
      )}
    </View>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
