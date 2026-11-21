import type { ThreadReferenceCopyTarget } from "@t3tools/client-runtime/thread-reference";
import {
  COMPOSER_CONTEXT_CLIPBOARD_MIME,
  encodeComposerContextFragment,
} from "@t3tools/shared/composerContextClipboard";
import { msg } from "gt-react";

import {
  threadReferenceCopyFailureToast,
  threadReferenceCopySuccessToast,
} from "./threadReferenceCopyToasts";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";

export async function copyThreadReference(target: ThreadReferenceCopyTarget): Promise<void> {
  const fragment = target.fragment ? encodeComposerContextFragment(target.fragment) : null;
  try {
    const didCopy = await writeTextToClipboard(
      target.value,
      target.kind === "pull-request"
        ? {
            target: target.clipboardTarget,
            unavailableMessage: msg(
              "Clipboard API is unavailable while copying pull request link.",
            ),
            failureMessage: msg("Failed to copy pull request link to the clipboard."),
          }
        : {
            target: target.clipboardTarget,
            unavailableMessage: msg("Clipboard API is unavailable while copying thread."),
            failureMessage: msg("Failed to copy thread to the clipboard."),
          },
      fragment ? { [COMPOSER_CONTEXT_CLIPBOARD_MIME]: fragment } : undefined,
    );
    if (!didCopy) return;
    toastManager.add(threadReferenceCopySuccessToast(target));
  } catch (error) {
    console.error(error);
    toastManager.add(stackedThreadToast(threadReferenceCopyFailureToast(target, error)));
  }
}
