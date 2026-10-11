import type { ThreadReferenceCopyTarget } from "@t3tools/shared/threadReference";
import * as Schema from "effect/Schema";

import { ClipboardApiUnavailableError, ClipboardWriteError } from "../hooks/useCopyToClipboard";
import { i18n } from "../i18n";

const isClipboardUnavailable = Schema.is(ClipboardApiUnavailableError);
const isClipboardWriteFailure = Schema.is(ClipboardWriteError);

// Called when copying settles, so a language change during the write is respected.
export function threadReferenceCopySuccessToast(
  target: Pick<ThreadReferenceCopyTarget, "kind" | "value">,
) {
  return {
    type: "success" as const,
    title: i18n.t(
      target.kind === "pull-request" ? "pullRequest.link.copied" : "clipboard.thread.copied",
    ),
    description: target.value,
  };
}

export function threadReferenceCopyFailureToast(
  target: Pick<ThreadReferenceCopyTarget, "kind">,
  error: unknown,
) {
  const pullRequest = target.kind === "pull-request";
  return {
    type: "error" as const,
    title: i18n.t(pullRequest ? "pullRequest.link.copyFailed" : "clipboard.thread.failed"),
    description: isClipboardUnavailable(error)
      ? i18n.t(
          pullRequest ? "pullRequest.link.clipboardUnavailable" : "clipboard.thread.unavailable",
        )
      : isClipboardWriteFailure(error)
        ? i18n.t(pullRequest ? "pullRequest.link.clipboardFailed" : "clipboard.thread.writeFailed")
        : error instanceof Error
          ? error.message
          : i18n.t("common.error"),
  };
}
