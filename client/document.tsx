import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import type { Align, Block, FrontMatter, Inline, ListItem } from "./markdown/ast";
import { parseMarkdown } from "./markdown/parse";
import { DocumentContext, useDocument, type DocumentContextValue, type DocumentEnvironment } from "./document-context";
import { DocumentImage } from "./image";
import { Formula, FormulaLoaderProvider } from "./math/formula";
import { BODY_FONT_SIZE, documentStyles, headingSize } from "./styles";

const BULLETS = ["•", "◦", "▪"];

/** A Markdown document with its math typeset by RaTeX. The hosting panel owns scrolling. */
export function MarkdownDocument({ source, environment }: { source: string; environment: DocumentEnvironment }) {
  const tree = useMemo(() => parseMarkdown(source), [source]);
  const { theme, layout } = environment;
  const styles = useMemo(() => documentStyles(theme.colors, layout.compact), [theme, layout.compact]);
  const context = useMemo<DocumentContextValue>(() => ({ ...environment, styles }), [environment, styles]);
  return (
    <FormulaLoaderProvider>
      <DocumentContext.Provider value={context}>
        <View style={styles.document}>
          {tree.frontMatter ? <FrontMatterView frontMatter={tree.frontMatter} /> : null}
          <Blocks blocks={tree.blocks} depth={0} />
        </View>
      </DocumentContext.Provider>
    </FormulaLoaderProvider>
  );
}

function Blocks({ blocks, depth, tight = false }: { blocks: Block[]; depth: number; tight?: boolean }) {
  const { styles } = useDocument();
  return (
    <View style={tight ? styles.tightBlocks : styles.blocks}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} depth={depth} />
      ))}
    </View>
  );
}

function BlockView({ block, depth }: { block: Block; depth: number }) {
  const context = useDocument();
  const { styles, theme, layout } = context;
  switch (block.type) {
    case "heading":
      return (
        <View>
          <Text selectable accessibilityRole="header" style={styles.heading(block.level)}>
            {renderInlines(block.children, context, headingSize(block.level))}
          </Text>
          {block.level <= 2 ? <View style={styles.headingRule} /> : null}
        </View>
      );
    case "paragraph":
      return (
        <Text selectable style={styles.paragraph}>
          {renderInlines(block.children, context, BODY_FONT_SIZE)}
        </Text>
      );
    case "math":
      return (
        <Formula
          latex={block.latex}
          source={block.source}
          display
          fontSize={BODY_FONT_SIZE}
          color={theme.colors.foreground}
          platform={layout.platform}
          styles={styles}
        />
      );
    case "image":
      return <DocumentImage src={block.src} alt={block.alt} title={block.title} />;
    case "code":
      return <CodeBlock language={block.language} text={block.text} />;
    case "blockquote":
      return (
        <View style={styles.blockquote}>
          <Blocks blocks={block.children} depth={depth} />
        </View>
      );
    case "list":
      return (
        <View style={block.loose ? styles.blocks : styles.tightBlocks}>
          {block.items.map((item, index) => (
            <View key={index} style={styles.listItem}>
              <ListMarker item={item} label={block.ordered ? `${block.start + index}.` : BULLETS[depth % BULLETS.length]} />
              <View style={styles.listContent}>
                <Blocks blocks={item.children} depth={depth + 1} tight={!block.loose} />
              </View>
            </View>
          ))}
        </View>
      );
    case "table":
      return <TableView align={block.align} header={block.header} rows={block.rows} />;
    case "html":
      return (
        <Text selectable style={styles.html}>
          {block.text}
        </Text>
      );
    case "rule":
      return <View style={styles.rule} />;
    case "footnotes":
      return (
        <View style={styles.footnotes}>
          <View style={styles.rule} />
          {block.items.map((item) => (
            <View key={item.label} style={styles.footnote}>
              <Text style={styles.footnoteLabel}>{item.label}.</Text>
              <View style={styles.listContent}>
                <Blocks blocks={item.children} depth={depth} tight />
              </View>
            </View>
          ))}
        </View>
      );
  }
}

function ListMarker({ item, label }: { item: ListItem; label: string }) {
  const { styles, theme } = useDocument();
  return (
    <View style={styles.listMarker}>
      {item.checked === null ? (
        <Text style={styles.listMarkerText}>{label}</Text>
      ) : (
        <View style={{ paddingTop: 4 }} accessibilityLabel={item.checked ? "Done" : "Not done"}>
          <Icon
            name={item.checked ? "SquareCheck" : "Square"}
            size={16}
            color={item.checked ? theme.colors.accent : theme.colors.foregroundMuted}
          />
        </View>
      )}
    </View>
  );
}

function CodeBlock({ language, text }: { language: string; text: string }) {
  const { styles } = useDocument();
  return (
    <View style={styles.codeBlock}>
      {language ? <Text style={styles.codeLanguage}>{language}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <Text selectable style={styles.codeText}>
          {text}
        </Text>
      </ScrollView>
    </View>
  );
}

function TableView({ align, header, rows }: { align: Align[]; header: Inline[][]; rows: Inline[][][] }) {
  const context = useDocument();
  const { styles } = context;
  const widths = useMemo(() => columnWidths(header, rows), [header, rows]);
  const cell = (content: Inline[], column: number, heading: boolean, first: boolean) => (
    <View
      key={column}
      style={[
        styles.tableCell,
        { width: widths[column] },
        first && { borderTopWidth: 0 },
        column === header.length - 1 && { borderRightWidth: 0 },
      ]}
    >
      <Text selectable style={[heading ? styles.tableHeaderText : styles.paragraph, { textAlign: align[column] ?? "left" }]}>
        {renderInlines(content, context, BODY_FONT_SIZE)}
      </Text>
    </View>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View style={styles.table}>
        <View style={styles.tableHeaderRow}>{header.map((content, column) => cell(content, column, true, true))}</View>
        {rows.map((row, index) => (
          <View key={index} style={styles.tableRow}>
            {header.map((_, column) => cell(row[column] ?? [], column, false, false))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function FrontMatterView({ frontMatter }: { frontMatter: FrontMatter }) {
  const { styles } = useDocument();
  if (!frontMatter.rows) return <CodeBlock language="yaml" text={frontMatter.raw} />;
  if (frontMatter.rows.length === 0) return null;
  return (
    <View style={styles.frontMatter}>
      {frontMatter.rows.map((row, index) => (
        <View key={index} style={[styles.frontMatterRow, index === 0 && { borderTopWidth: 0 }]}>
          <View style={styles.frontMatterKey}>
            <Text selectable style={styles.frontMatterKeyText}>
              {row.key}
            </Text>
          </View>
          <View style={styles.frontMatterValue}>
            <Text selectable style={styles.paragraph}>
              {row.value}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function renderInlines(nodes: Inline[], context: DocumentContextValue, fontSize: number): ReactNode[] {
  const { styles, theme, layout } = context;
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "softbreak":
        return " ";
      case "break":
        return "\n";
      case "strong":
      case "em":
      case "del":
        return (
          <Text key={index} style={styles[node.type]}>
            {renderInlines(node.children, context, fontSize)}
          </Text>
        );
      case "code":
        return (
          <Text key={index} style={styles.inlineCode}>
            {node.text}
          </Text>
        );
      case "link":
        return (
          <Text key={index} style={styles.link} accessibilityRole="link" onPress={() => context.openLink(node.href)}>
            {renderInlines(node.children, context, fontSize)}
          </Text>
        );
      case "image":
        // Images nested in links or text (badges, icons) keep their place as their label.
        return (
          <Text key={index} style={styles.muted}>
            {`[${node.alt || "image"}]`}
          </Text>
        );
      case "math":
        return (
          <Formula
            key={index}
            latex={node.latex}
            source={node.source}
            display={false}
            fontSize={fontSize}
            color={theme.colors.foreground}
            platform={layout.platform}
            styles={styles}
          />
        );
      case "footnoteRef":
        return (
          <Text key={index} style={styles.footnoteRef}>
            {`[${node.label}]`}
          </Text>
        );
    }
  });
}

/** Columns sized from their longest cell, within limits; a wide table scrolls sideways. */
function columnWidths(header: Inline[][], rows: Inline[][][]): number[] {
  const widths = header.map(() => 0);
  for (const row of [header, ...rows]) {
    row.forEach((cell, column) => {
      if (column < widths.length) widths[column] = Math.max(widths[column], textLength(cell));
    });
  }
  return widths.map((length) => Math.min(Math.max(length * 7.5 + 24, 64), 320));
}

function textLength(nodes: Inline[]): number {
  let length = 0;
  for (const node of nodes) {
    if (node.type === "text") length += node.text.length;
    else if (node.type === "code") length += node.text.length * 1.1;
    else if (node.type === "math") length += node.latex.length * 0.6;
    else if (node.type === "image") length += node.alt.length + 2;
    else if ("children" in node) length += textLength(node.children);
    else length += 1;
  }
  return length;
}
