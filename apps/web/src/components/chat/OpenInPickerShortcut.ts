import type { EditorId, EnvironmentId, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { useEffect } from "react";
import {
  readPreferredEditor,
  useEditorAction,
  type EditorWorkspace,
} from "../../editorPreferences";
import { editorLabelForPlatform } from "../../editorLabels";
import { isOpenFavoriteEditorShortcut } from "../../keybindings";
import { announce } from "../../lib/announce";
import { toastManager } from "../ui/toast";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useTranslate } from "../../i18n";
import { registerCommands } from "../../shortcuts/dispatcher";

/** Marks an OpenInPicker's primary button as the target of `editor.openFavorite`. */
export const OPEN_FAVORITE_EDITOR_ATTRIBUTE = "data-open-favorite-editor";

/**
 * `editor.openFavorite` presses the marked OpenInPicker primary button, so the shortcut opens
 * exactly what the button on screen would. A missing or disabled button leaves the chord to the
 * bubble-phase fallback below. Capture phase, so a focused terminal does not swallow the chord.
 */
export function registerOpenFavoriteEditorCommand(): () => void {
  return registerCommands(
    {
      "editor.openFavorite": (event) => {
        if (event.repeat) return false;
        const button = [
          ...document.querySelectorAll<HTMLButtonElement>(`[${OPEN_FAVORITE_EDITOR_ATTRIBUTE}]`),
        ].at(-1);
        if (button === undefined || button.disabled) return false;
        event.preventDefault();
        button.click();
      },
    },
    { capture: true },
  );
}

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
      const preferredEditor = readPreferredEditor();
      const label =
        preferredEditor === "browser"
          ? t("chat.editor.browser")
          : editorLabelForPlatform(preferredEditor, navigator.platform);
      void action.open(openInCwd, { isFile }).then((result) => {
        if (result._tag === "Failure")
          toastManager.add({
            type: "error",
            title: t("chat.editor.open"),
            description: String(squashAtomCommandFailure(result)),
          });
        if (result._tag === "Success") announce(`Opened in ${label}`);
      });
    };
    // File pickers run before the chat fallback and claim the shortcut once.
    window.addEventListener("keydown", handler, capture);
    return () => window.removeEventListener("keydown", handler, capture);
  }, [enabled, keybindings, openInCwd, action, isFile, capture, t]);
}
