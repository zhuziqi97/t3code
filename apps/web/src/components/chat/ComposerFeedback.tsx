import type { TFunction } from "i18next";
import { i18n } from "../../i18n";
import {
  codexFeedbackNotice,
  type CodexFeedbackSubmission,
} from "@t3tools/client-runtime/state/threads";
import { MessageSquareIcon } from "lucide-react";

import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

export function feedbackBannerItem(
  submission: CodexFeedbackSubmission,
  onDismiss: () => void,
  t: TFunction = i18n.t,
): ComposerBannerStackItem | null {
  const notice = codexFeedbackNotice(submission, t);
  if (!notice) return null;
  return {
    id: `feedback:${submission.id}`,
    variant:
      submission.status === "failed" ? "error" : submission.status === "sent" ? "success" : "info",
    priority: submission.status === "uploading" ? "activity" : "notice",
    icon: <MessageSquareIcon />,
    ...notice,
    actions:
      submission.status === "sent" ? (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            void writeTextToClipboard(submission.feedbackId, t("chat.feedback.threadId")).catch(
              (error: unknown) => {
                toastManager.add({
                  type: "error",
                  title: t("clipboard.thread.failed"),
                  description: error instanceof Error ? error.message : t("common.error"),
                });
              },
            );
          }}
        >
          {t("chat.feedback.copyId")}
        </Button>
      ) : undefined,
    ...(submission.status !== "uploading"
      ? { dismissLabel: t("chat.feedback.dismiss"), onDismiss }
      : {}),
  };
}
