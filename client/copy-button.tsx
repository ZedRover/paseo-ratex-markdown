import { copyText, Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable } from "react-native";
import { useDocument } from "./document-context";

const COPIED_MS = 1500;

/**
 * The copy button in a code block's top-right corner, as on Paseo's own code blocks: shown while
 * the pointer is over the block, or always where `visible` says so, with a check after copying.
 */
export function CopyButton({ text, visible }: { text: string; visible: boolean }) {
  const { styles, theme } = useDocument();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(reset.current ?? undefined), []);

  async function copy() {
    try {
      // Without trailing line breaks: pasted into a terminal, they would run the last line.
      await copyText(text.replace(/\n+$/, ""));
    } catch {
      toast.error("Could not copy. Select the text and use Copy.");
      return;
    }
    setCopied(true);
    clearTimeout(reset.current ?? undefined);
    reset.current = setTimeout(() => setCopied(false), COPIED_MS);
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copied ? "Copied" : "Copy code"}
      onPress={copy}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      hitSlop={8}
      style={[styles.copyButton, { opacity: visible ? 1 : 0, pointerEvents: visible ? "auto" : "none" }]}
    >
      <Icon
        name={copied ? "Check" : "Copy"}
        size={14}
        color={hovered ? theme.colors.foreground : theme.colors.foregroundMuted}
      />
    </Pressable>
  );
}
