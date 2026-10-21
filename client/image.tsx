import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { useDocument } from "./document-context";
import { isRemoteImage } from "./links";

/** An image block: remote URLs load on the client, local paths through the daemon. */
export function DocumentImage({ src, alt, title }: { src: string; alt: string; title: string | null }) {
  const { styles, theme, layout, loadImage, documentId } = useDocument();
  const remote = isRemoteImage(src);
  // The daemon ignores ?query and #fragment, so "a.png?1" and "a.png?2" are one read.
  const file = src.replace(/[?#].*$/, "");
  const local = useQuery({
    queryKey: ["ratex-markdown", "image", documentId, file],
    queryFn: () => loadImage!(file),
    enabled: !remote && loadImage !== null && file !== "",
    staleTime: 60 * 1000,
    structuralSharing: false,
  });
  const uri = remote ? src : local.data && "uri" in local.data ? local.data.uri : null;
  // React Native's native image loaders cannot decode SVG.
  const drawable = uri !== null && (layout.platform === "web" || !/^data:image\/svg|\.svg(?:[?#]|$)/i.test(uri));
  const [size, setSize] = useState<{ uri: string; width: number; height: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!uri || !drawable) return;
    let active = true;
    Image.getSize(
      uri,
      (width, height) => {
        if (active) setSize({ uri, width, height });
      },
      () => {
        if (active) setFailed(uri);
      },
    );
    return () => {
      active = false;
    };
  }, [uri, drawable]);

  const caption = title ? <Text style={styles.caption}>{title}</Text> : null;
  if (uri && drawable && size?.uri === uri && failed !== uri && size.width > 0 && size.height > 0) {
    return (
      <View style={{ gap: 4 }}>
        <Image
          source={{ uri }}
          accessibilityLabel={alt || title || undefined}
          resizeMode="contain"
          style={[styles.image, { width: size.width, aspectRatio: size.width / size.height }]}
        />
        {caption}
      </View>
    );
  }

  const problem =
    local.data && "error" in local.data
      ? local.data.error
      : local.isError
        ? "The image could not be read."
        : failed === uri || (uri && !drawable)
          ? "The image cannot be shown here."
          : null;
  return (
    <View style={styles.imagePlaceholder} accessibilityLabel={problem ?? alt}>
      <Icon name="Image" size={16} color={theme.colors.foregroundMuted} />
      <Text selectable style={styles.caption}>
        {alt || src}
        {problem ? ` (${problem})` : ""}
      </Text>
    </View>
  );
}
