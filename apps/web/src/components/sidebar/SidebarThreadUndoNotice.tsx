import { useTranslate } from "../../i18n";
import { useAtomValue } from "@effect/atom-react";

import { undoLatestThreadAction, useThreadUndoNotice } from "../../hooks/showThreadUndoNotice";
import { shortcutLabelForCommand } from "../../keybindings";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Alert, AlertDescription } from "../ui/alert";
import { InlineButton } from "../ui/button";

export function SidebarThreadUndoNotice() {
  const t = useTranslate();
  const notice = useThreadUndoNotice((state) => state.notice);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);

  if (!notice) return null;
  const shortcut = shortcutLabelForCommand(keybindings, "thread.undo");

  return (
    <Alert role="status" variant="sidebar">
      <AlertDescription>
        {t(`thread.undo.${notice.action}`, { count: notice.count })}{" "}
        <InlineButton onClick={undoLatestThreadAction}>
          {shortcut ? t("thread.undo.shortcut", { shortcut }) : t("common.undo")}
        </InlineButton>
      </AlertDescription>
    </Alert>
  );
}
