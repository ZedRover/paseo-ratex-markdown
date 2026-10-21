import { createElement, type ReactElement } from "react";
import { Platform, Text, View } from "react-native";
import type { FormulaImage } from "./math/svg";

/**
 * Invisible but selectable: a selection across a formula copies its TeX, which an image
 * alone would drop. Deliberately no userSelect: "none" anywhere on the host, which would take
 * this text out of the clipboard too.
 */
const SOURCE_STYLE = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  opacity: 0,
} as const;

/**
 * A formula as an <img> of its SVG on web, where react-native-web renders host elements as
 * DOM. Inline formulas sit in a Text (a span), not a View: a View inside a paragraph becomes
 * an inline-flex box, and browsers put a line break at such a boundary when copying.
 */
export function webFormula({
  image,
  display,
  source,
}: {
  image: FormulaImage;
  display: boolean;
  source: string;
}): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const { overhang } = image;
  const img = createElement("img", {
    src: image.uri,
    alt: "",
    title: source,
    draggable: false,
    "aria-hidden": true,
    style: display
      ? { display: "block", width: image.width, height: image.height, maxWidth: "none", userSelect: "none" }
      : {
          display: "inline-block",
          width: image.width,
          height: image.height,
          maxWidth: "none",
          userSelect: "none",
          // Negative margins keep ink overhang (an italic f, a large integral) from widening
          // the line, as KaTeX's overflow does. The bottom margin edge is the image's baseline
          // for vertical-align, so lowering it by the depth puts the formula on the text line.
          margin: `${-overhang.top}px ${-overhang.right}px ${-overhang.bottom}px ${-overhang.left}px`,
          verticalAlign: `${-image.depth}px`,
        },
  });
  const hidden = createElement(Text, { style: SOURCE_STYLE }, source);
  if (display) return createElement(View, null, hidden, img);
  return createElement(Text, null, hidden, img);
}
