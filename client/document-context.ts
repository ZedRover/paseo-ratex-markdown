import type { PluginTheme } from "@getpaseo/plugin";
import { createContext, useContext } from "react";
import type { DocumentStyles } from "./styles";

export type ImageResult = { uri: string } | { error: string };

/** What a hosting panel provides to the documents it shows. */
export type DocumentEnvironment = {
  theme: PluginTheme;
  layout: { compact: boolean; platform: "ios" | "android" | "web" };
  /** Identifies the document, so relative image references are cached per document. */
  documentId: string;
  /** Reads a local image through the daemon; null where the panel cannot reach files. */
  loadImage: ((src: string) => Promise<ImageResult>) | null;
  openLink(href: string): void;
};

export type DocumentContextValue = DocumentEnvironment & { styles: DocumentStyles };

export const DocumentContext = createContext<DocumentContextValue | null>(null);

export function useDocument(): DocumentContextValue {
  const value = useContext(DocumentContext);
  if (!value) throw new Error("Markdown blocks must render inside a MarkdownDocument");
  return value;
}
