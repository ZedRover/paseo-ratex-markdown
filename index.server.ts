import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listMarkdownFiles, readImage, readMarkdownFile } from "./server/files";
import { renderMath } from "./server/render";
import {
  listMarkdownFilesRpc,
  readImageRpc,
  readMarkdownFileRpc,
  renderMathRpc,
} from "./shared/contracts";

export default function contribute(server: PluginServerContext) {
  server.handle(renderMathRpc, renderMath);
  server.handle(listMarkdownFilesRpc, listMarkdownFiles);
  server.handle(readMarkdownFileRpc, readMarkdownFile);
  server.handle(readImageRpc, readImage);
  return () => {};
}
