import { EDITORS, type ContextMenuItem, type EnvironmentId } from "@t3tools/contracts";
import {
  useEditorAction,
  usePreferredEditor,
  type ClientEditorId,
  type EditorWorkspace,
} from "./editorPreferences";
import type { TFunction } from "i18next";
import { i18n, useTranslate } from "./i18n";

import { resolveDiffPathForWorkspace } from "./diffFileActions";
import {
  revealInFileExplorerLabelForKind,
  revealInFileExplorerLabelForOs,
} from "~/components/preview/fileExplorerLabel";
import { readLocalApi } from "./localApi";
import { serverEnvironment } from "./state/server";
import { shellEnvironment } from "./state/shell";
import { useAtomCommand } from "./state/use-atom-command";
import { resolvePathLinkTarget, splitFilePathPosition } from "@t3tools/shared/fileLinks";
import { toastManager } from "./components/ui/toast";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";

export type FileContextMenuAction =
  | "reveal-in-folder"
  | "open"
  /** Submenu parent; never the activated id. */
  | "open-with"
  | "open-editor"
  | `editor:${ClientEditorId}`;

export interface FileContextMenuTarget {
  readonly environmentId: EnvironmentId | null;
  /** Repo- or workspace-relative file path, as shown in diffs. */
  readonly filePath: string;
  readonly isFile?: boolean;
  readonly workspaceRoot: string | undefined;
  readonly repositoryRoot?: string | undefined;
}

export function resolveFileContextMenuAbsolutePath(target: FileContextMenuTarget): string | null {
  const workspaceFilePath = resolveDiffPathForWorkspace({
    filePath: target.filePath,
    workspaceRoot: target.workspaceRoot,
    repositoryRoot: target.repositoryRoot,
  });
  if (workspaceFilePath === null) return null;
  if (target.workspaceRoot === undefined) {
    return workspaceFilePath.startsWith("/") || /^[a-zA-Z]:/.test(workspaceFilePath)
      ? workspaceFilePath
      : null;
  }
  return resolvePathLinkTarget(workspaceFilePath, target.workspaceRoot);
}

const EDITOR_LABEL_BY_ID = new Map(EDITORS.map((editor) => [editor.id, editor.label]));

export interface FileContextMenuCapabilities {
  readonly revealLabel: string | undefined;
  readonly canOpenDefault: boolean;
  readonly editorIds: ReadonlyArray<ClientEditorId>;
  readonly canOpenEditor?: boolean;
  readonly editorUnavailableReason?: (editor: ClientEditorId) => string | null;
}

/**
 * Menu items for a resolved file, offering only what the environment's config
 * advertises: default-app open, reveal (with server-provided wording), and an
 * "Open with" submenu of detected editors. Empty when nothing can act.
 */
function buildFileContextMenuItems(
  input: {
    readonly hasAbsolutePath: boolean;
    readonly capabilities: FileContextMenuCapabilities;
  },
  t: TFunction = i18n.t,
): readonly ContextMenuItem<FileContextMenuAction>[] {
  // Without a resolvable absolute path nothing here can act on the file.
  if (!input.hasAbsolutePath) return [];
  const items: ContextMenuItem<FileContextMenuAction>[] = [];
  if (input.capabilities.canOpenEditor)
    items.push({ id: "open-editor", label: t("chat.editor.open"), icon: "pencil" });
  if (input.capabilities.canOpenDefault) {
    items.push({ id: "open", label: t("fileMenu.open"), icon: "pencil" });
  }
  if (input.capabilities.revealLabel !== undefined) {
    items.push({
      id: "reveal-in-folder",
      label: input.capabilities.revealLabel,
      icon: "folder-tree",
    });
  }
  const editorIds = input.capabilities.editorIds.filter((id) => id !== "file-manager");
  if (editorIds.length > 0) {
    items.push({
      id: "open-with",
      label: t("fileMenu.openWith"),
      children: editorIds.map((editorId) => {
        const reason = input.capabilities.editorUnavailableReason?.(editorId);
        const label =
          editorId === "browser"
            ? t("chat.editor.browser")
            : (EDITOR_LABEL_BY_ID.get(editorId) ?? editorId);
        return {
          id: `editor:${editorId}` as FileContextMenuAction,
          label: reason ? `${label}: ${reason}` : label,
          ...(reason ? { disabled: true } : {}),
        };
      }),
    });
  }
  return items;
}

export function useFileContextMenu(
  environmentId: EnvironmentId | null,
  workspace?: EditorWorkspace,
) {
  const t = useTranslate();
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));

  const availableEditors = serverConfig?.availableEditors ?? [];
  const editorAction = useEditorAction(environmentId, availableEditors, workspace);
  const [, setPreferredEditor] = usePreferredEditor();
  const capabilities: FileContextMenuCapabilities = {
    // WSL can reveal in Windows Explorer despite reporting Linux; use server wording.
    revealLabel:
      environmentId !== null &&
      serverConfig?.shellRevealInFileManager === true &&
      serverConfig.availableEditors.includes("file-manager")
        ? serverConfig.shellRevealInFileManagerKind === undefined
          ? revealInFileExplorerLabelForOs(serverConfig.environment.platform.os, t)
          : revealInFileExplorerLabelForKind(serverConfig.shellRevealInFileManagerKind, t)
        : undefined,
    canOpenDefault: availableEditors.includes("file-manager"),
    editorIds: workspace ? ["browser", ...editorAction.editorIds] : editorAction.editorIds,
    canOpenEditor: workspace !== undefined,
    editorUnavailableReason: editorAction.unavailableReason,
  };

  const activate = async (
    action: FileContextMenuAction,
    target: FileContextMenuTarget,
  ): Promise<void> => {
    const absolutePath = resolveFileContextMenuAbsolutePath(target);
    if (absolutePath === null || environmentId === null || target.environmentId !== environmentId)
      return;

    const reveal = action === "reveal-in-folder";
    if (action === "open-with") return;
    const editor =
      action === "open" || reveal
        ? ("file-manager" as const)
        : action === "open-editor"
          ? undefined
          : (action.slice("editor:".length) as ClientEditorId);
    if (
      editor !== undefined &&
      action !== "open" &&
      !reveal &&
      !capabilities.editorIds.includes(editor)
    )
      return;
    if (action.startsWith("editor:") && editor) setPreferredEditor(editor);
    const result =
      action === "open" || reveal
        ? await openInEditor({
            environmentId,
            input: {
              cwd: splitFilePathPosition(absolutePath).path,
              editor: "file-manager",
              ...(reveal ? { reveal: true } : {}),
            },
          })
        : await editorAction.open(absolutePath, {
            ...(editor ? { editor } : {}),
            isFile: target.isFile ?? true,
          });
    if (result._tag !== "Failure") return;
    toastManager.add({
      type: "error",
      title:
        action === "open"
          ? i18n.t("fileMenu.openFailed")
          : reveal
            ? i18n.t("fileMenu.revealFailed")
            : i18n.t("fileMenu.editorFailed", {
                editor:
                  editor === "browser"
                    ? i18n.t("chat.editor.browser")
                    : editor
                      ? (EDITOR_LABEL_BY_ID.get(editor) ?? editor)
                      : i18n.t("chat.editor.generic"),
              }),
      description:
        action === "open" || reveal ? absolutePath : String(squashAtomCommandFailure(result)),
    });
  };

  const show = async (
    target: FileContextMenuTarget,
    position?: { x: number; y: number },
  ): Promise<void> => {
    const api = readLocalApi();
    const items = buildFileContextMenuItems(
      {
        hasAbsolutePath: resolveFileContextMenuAbsolutePath(target) !== null,
        capabilities,
      },
      t,
    );
    if (items.length === 0 || api === undefined) return;
    const clicked = await api.contextMenu.show(items, position);
    if (clicked === null) return;
    await activate(clicked as FileContextMenuAction, target);
  };

  return {
    buildItems: (target: FileContextMenuTarget) =>
      buildFileContextMenuItems(
        {
          hasAbsolutePath: resolveFileContextMenuAbsolutePath(target) !== null,
          capabilities,
        },
        t,
      ),
    capabilities,
    activate,
    show,
  };
}

export function useFileContextMenuHandler(
  environmentId: EnvironmentId | null,
  workspace?: EditorWorkspace,
) {
  const contextMenu = useFileContextMenu(environmentId, workspace);
  return (target: FileContextMenuTarget, event?: { clientX: number; clientY: number }) => {
    void contextMenu.show(target, event ? { x: event.clientX, y: event.clientY } : undefined);
  };
}
