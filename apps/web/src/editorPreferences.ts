import {
  AuthOrchestrationOperateScope,
  buildRemoteOpenUrl,
  EDITORS,
  EditorId,
  EnvironmentAuthorizationError,
  EnvironmentId,
} from "@t3tools/contracts";
import { mapAtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/reactivity";
import { getLocalStorageItem, useLocalStorage } from "./hooks/useLocalStorage";
import { shellEnvironment } from "./state/shell";
import { useAtomCommand } from "./state/use-atom-command";
import { readEnvironmentScope, useEnvironmentScope } from "./state/session";

import { splitFilePathPosition } from "@t3tools/shared/fileLinks";
import { useBrowserEditorAction, type EditorWorkspace } from "./browserEditorAction";
import {
  openRemoteEditorUrl,
  useRemoteCapableEditors,
  useRemoteOpenResolution,
} from "./remoteOpen";
import { i18n } from "./i18n";

export const ClientEditorId = Schema.Union([EditorId, Schema.Literal("browser")]);
export type ClientEditorId = typeof ClientEditorId.Type;
export type { EditorWorkspace };

const StoredEditorPreference = Schema.NullOr(ClientEditorId);

const LAST_EDITOR_KEY = "t3code:last-editor";

export class PreferredEditorEnvironmentRequiredError extends Schema.TaggedError<PreferredEditorEnvironmentRequiredError>()(
  "PreferredEditorEnvironmentRequiredError",
  {
    targetPath: Schema.String,
  },
) {
  override get message(): string {
    return `Cannot open ${this.targetPath} because no environment is selected.`;
  }
}

export class PreferredEditorUnavailableError extends Schema.TaggedError<PreferredEditorUnavailableError>()(
  "PreferredEditorUnavailableError",
  {
    environmentId: EnvironmentId,
    targetPath: Schema.String,
    availableEditorIds: Schema.Array(EditorId),
  },
) {
  override get message(): string {
    return `No available editor can open ${this.targetPath} in environment ${this.environmentId}.`;
  }
}

export function usePreferredEditor(_availableEditors?: ReadonlyArray<EditorId>) {
  const [lastEditor, setLastEditor] = useLocalStorage<ClientEditorId | null, string | null>(
    LAST_EDITOR_KEY,
    null,
    StoredEditorPreference,
  );
  return [lastEditor ?? "browser", setLastEditor] as const;
}

export function readPreferredEditor(): ClientEditorId {
  return getLocalStorageItem(LAST_EDITOR_KEY, ClientEditorId) ?? "browser";
}

export function useEditorAction(
  environmentId: EnvironmentId | null,
  availableEditors: readonly EditorId[],
  workspace?: EditorWorkspace,
) {
  const browser = useBrowserEditorAction(environmentId, workspace);
  const remoteResolution = useRemoteOpenResolution(environmentId);
  const remote = remoteResolution.state;
  const canOperateHost = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const remoteEditors = useRemoteCapableEditors();
  const editorIds = remote.mode === "local-exec" ? availableEditors : remoteEditors;
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const unavailableReason = (editor: ClientEditorId, canOperate = canOperateHost) =>
    editor === "browser"
      ? browser.unavailableReason
      : !remoteResolution.isResolved
        ? i18n.t("chat.editor.resolving")
        : remote.mode === "remote-unavailable"
          ? i18n.t("chat.editor.remoteUnavailable")
          : !editorIds.includes(editor)
            ? i18n.t("chat.editor.nativeUnavailable")
            : remote.mode === "local-exec" && !canOperate
              ? i18n.t("chat.editor.nativeDenied")
              : null;
  const open = async (
    targetPath: string,
    options: { editor?: ClientEditorId; isFile?: boolean; reveal?: boolean } = {},
  ) => {
    if (environmentId === null)
      return AsyncResult.failure(
        Cause.fail(new PreferredEditorEnvironmentRequiredError({ targetPath })),
      );
    // Application configuration and logs have no project workspace. Their native
    // fallback must not replace the user's project editor preference.
    const preferred = options.editor ?? readPreferredEditor();
    const editor =
      !workspace && options.editor === undefined && preferred === "browser"
        ? EDITORS.find((candidate) => editorIds.includes(candidate.id))?.id
        : preferred;
    if (!editor)
      return AsyncResult.failure(
        Cause.fail(
          new PreferredEditorUnavailableError({
            environmentId,
            targetPath,
            availableEditorIds: editorIds,
          }),
        ),
      );
    if (
      editor !== "browser" &&
      remote.mode === "local-exec" &&
      !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)
    )
      return AsyncResult.failure(
        Cause.fail(
          new EnvironmentAuthorizationError({
            requiredScope: AuthOrchestrationOperateScope,
            message: i18n.t("chat.editor.nativeDenied"),
          }),
        ),
      );
    const reason = unavailableReason(editor, true);
    if (reason) return AsyncResult.failure(Cause.fail(new Error(reason)));
    if (editor === "browser") {
      try {
        await browser.open(targetPath, options.isFile ?? true);
        return AsyncResult.success(editor);
      } catch (error) {
        return AsyncResult.failure(
          Cause.fail(error instanceof Error ? error : new Error(String(error))),
        );
      }
    }
    if (remote.mode === "remote-links") {
      const position = splitFilePathPosition(targetPath);
      const url = buildRemoteOpenUrl({
        editor,
        ...remote.host,
        absolutePath: position.path,
        isFile: options.isFile ?? true,
        ...(position.line !== undefined ? { line: position.line } : {}),
        ...(position.column !== undefined ? { column: position.column } : {}),
      });
      if (!url || !(await openRemoteEditorUrl(url)))
        return AsyncResult.failure(Cause.fail(new Error(i18n.t("chat.editor.nativeUnavailable"))));
      return AsyncResult.success(editor);
    }
    const result = await openInEditor({
      environmentId,
      input: {
        cwd: editor === "file-manager" ? splitFilePathPosition(targetPath).path : targetPath,
        editor,
        ...(options.reveal ? { reveal: true } : {}),
      },
    });
    return mapAtomCommandResult(result, () => editor);
  };
  return { open, editorIds, unavailableReason };
}

export function useOpenInPreferredEditor(
  environmentId: EnvironmentId | null,
  availableEditors: readonly EditorId[],
  workspace?: EditorWorkspace,
) {
  return useEditorAction(environmentId, availableEditors, workspace).open;
}
