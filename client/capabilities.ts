import * as sdk from "@getpaseo/plugin";

/**
 * Whether the host's `Icon` draws inline SVG (`{ svg }`), the only way plugin code can draw
 * vectors on iOS and Android. Paseo ships the SVG validator in the same release, so its export
 * from the host's own copy of the SDK marks support.
 */
export function hostDrawsSvgIcons(): boolean {
  return typeof (sdk as Record<string, unknown>).findSvgIconProblem === "function";
}
