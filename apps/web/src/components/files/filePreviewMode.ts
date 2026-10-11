import type { AssetResource, ProjectReadFileError, ScopedThreadRef } from "@t3tools/contracts";
import { isAbsolutePath, workspaceRelativeFilePath } from "@t3tools/shared/path";
import type { TFunction } from "i18next";
import { i18n } from "~/i18n";

/** Resolve workspace links before choosing between the explorer and a file preview. */
export function resolveFilePreviewPath(path: string | null, cwd: string): string | null {
  if (path === null) return null;
  return path === "." || workspaceRelativeFilePath(path, cwd) === "." ? null : path;
}

export const isMarkdownPreviewFile = (path: string): boolean => /\.(?:md|mdx)$/i.test(path);

/** Describe existing failure codes without exposing the underlying platform cause. */
export function filePreviewReadErrorMessage(
  error: ProjectReadFileError,
  t: TFunction = i18n.t,
): string {
  switch (error.failure) {
    case "path_not_file":
      return t("filePreview.error.notFile");
    case "binary_file":
      return t("filePreview.error.binary");
    case "workspace_path_outside_root":
      return t("filePreview.error.outsideWorkspace");
    case "resolved_path_outside_root":
      return t("filePreview.error.resolvedOutsideWorkspace");
    case "operation_failed":
      // A realpath failure can mean a missing path, permissions, or another I/O error.
      return error.operation === "realpath-workspace-root"
        ? t("filePreview.error.workspaceAccess")
        : t("filePreview.error.fileAccess");
    default:
      return error.message;
  }
}

export function renderedToggleLabel(
  mode: "markdown" | "html" | "table",
  rendered: boolean,
  t: TFunction = i18n.t,
): string {
  if (mode === "markdown")
    return t(rendered ? "filePreview.markdownSource" : "filePreview.markdownRendered");
  if (mode === "table") return t(rendered ? "filePreview.source" : "filePreview.table");
  return t(rendered ? "filePreview.htmlSource" : "filePreview.htmlRendered");
}

const FILE_PREVIEW_ERROR_KEYS = new Map([
  ["Reconnect to the environment and try again.", "filePreview.error.reconnect"],
  ["The attachment is unavailable.", "filePreview.error.attachmentUnavailable"],
  ["Could not load this file.", "filePreview.error.load"],
  ["The file could not be loaded. Try again.", "filePreview.error.loadRetry"],
  ["The file could not be loaded. Reconnect and try again.", "filePreview.error.loadReconnect"],
  [
    "Streaming file previews are unavailable in this runtime.",
    "filePreview.error.streamingUnavailable",
  ],
  ["Preview cancelled.", "filePreview.error.cancelled"],
  ["This file contains binary data and cannot be shown as text.", "filePreview.error.binaryData"],
  [
    "This file is not UTF-8 text. Open it in another app to view its contents.",
    "filePreview.error.notUtf8",
  ],
  ["Unable to load audio.", "filePreview.error.audio"],
  ["Unable to load video.", "filePreview.error.video"],
  ["Unable to load image.", "filePreview.error.image"],
  ["This connection cannot read host files.", "filePreview.error.readPermission"],
  ["This environment is not connected.", "filePreview.error.disconnected"],
]);

/** Stored errors remain verbatim; translate only messages owned by this preview path. */
export function formatFilePreviewErrorMessage(message: string, t: TFunction = i18n.t): string {
  const key = FILE_PREVIEW_ERROR_KEYS.get(message);
  return key === undefined ? message : t(key);
}

export function shouldShowFileExplorer(input: {
  readonly relativePath: string | null;
  readonly explorerOpen: boolean;
  readonly attachmentOpen: boolean;
}): boolean {
  if (input.attachmentOpen || (input.relativePath && isAbsolutePath(input.relativePath))) {
    return false;
  }
  return input.explorerOpen || input.relativePath === null;
}

export function setMarkdownTaskChecked(
  markdown: string,
  markerOffset: number,
  checked: boolean,
): string {
  if (
    markerOffset < 0 ||
    markdown[markerOffset] !== "[" ||
    !/[ xX]/.test(markdown[markerOffset + 1] ?? "") ||
    markdown[markerOffset + 2] !== "]"
  ) {
    return markdown;
  }

  return `${markdown.slice(0, markerOffset + 1)}${checked ? "x" : " "}${markdown.slice(markerOffset + 2)}`;
}

/**
 * The asset for a file the panel shows. A draft has no thread on the server
 * yet, so it names its workspace root instead of a thread to resolve one from.
 */
export function workspaceAssetResource(input: {
  readonly kind: "workspace-file" | "media-file";
  readonly threadRef: ScopedThreadRef;
  readonly draft: boolean;
  readonly workspaceRoot: string;
  readonly absolutePath: string;
}): AssetResource {
  if (input.draft) {
    return { _tag: "draft-workspace-file", cwd: input.workspaceRoot, path: input.absolutePath };
  }
  return { _tag: input.kind, threadId: input.threadRef.threadId, path: input.absolutePath };
}
