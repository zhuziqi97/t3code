import type { ThreadReferenceCopyTarget } from "@t3tools/client-runtime/thread-reference";
import {
  COMPOSER_CONTEXT_CLIPBOARD_MIME,
  encodeComposerContextFragment,
} from "@t3tools/shared/composerContextClipboard";

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
      target.clipboardTarget,
      fragment ? { [COMPOSER_CONTEXT_CLIPBOARD_MIME]: fragment } : undefined,
    );
    if (!didCopy) return;
    toastManager.add(threadReferenceCopySuccessToast(target));
  } catch (error) {
    console.error(error);
    toastManager.add(stackedThreadToast(threadReferenceCopyFailureToast(target, error)));
  }
}
