import type { EditorId, EnvironmentId, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { useEffect } from "react";
import { useEditorAction, type EditorWorkspace } from "../../editorPreferences";
import { isOpenFavoriteEditorShortcut } from "../../keybindings";
import { toastManager } from "../ui/toast";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useTranslate } from "../../i18n";

export function useOpenFavoriteEditorShortcut({
  enabled,
  environmentId,
  keybindings,
  availableEditors,
  openInCwd,
  workspace,
  isFile = false,
  capture = true,
}: {
  enabled: boolean;
  environmentId: EnvironmentId;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  openInCwd: string | null;
  workspace?: EditorWorkspace | undefined;
  isFile?: boolean;
  capture?: boolean;
}) {
  const action = useEditorAction(environmentId, availableEditors, workspace);
  const t = useTranslate();
  useEffect(() => {
    if (!enabled || !openInCwd) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || !isOpenFavoriteEditorShortcut(event, keybindings)) return;
      event.preventDefault();
      void action.open(openInCwd, { isFile }).then((result) => {
        if (result._tag === "Failure")
          toastManager.add({
            type: "error",
            title: t("chat.editor.open"),
            description: String(squashAtomCommandFailure(result)),
          });
      });
    };
    // File pickers run before the chat fallback and claim the shortcut once.
    window.addEventListener("keydown", handler, capture);
    return () => window.removeEventListener("keydown", handler, capture);
  }, [enabled, keybindings, openInCwd, action, isFile, capture, t]);
}
