import { i18n } from "../../i18n";
import type { ContextMenuItem } from "@t3tools/contracts";
import {
  type SourceControlClientDefinition,
  UNKNOWN_SOURCE_CONTROL_CLIENT,
} from "@t3tools/client-runtime/source-control-clients";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { readLocalApi } from "~/localApi";

import { toastManager } from "../ui/toast";

export type PullRequestLinkContextMenuAction = "copy-link" | "open-external";

/** Named for the host rather than "externally": the point is where you will land. */
export const openOnHostLabel = (host: SourceControlClientDefinition): string =>
  host === UNKNOWN_SOURCE_CONTROL_CLIENT
    ? i18n.t("pullRequest.link.openOnUnknownHost")
    : i18n.t("pullRequest.link.openOnHost", { host: host.label });

/** Copy first: it is the reason to right-click a number rather than click it. */
function pullRequestLinkContextMenuItems(
  openLabel: string,
): readonly ContextMenuItem<PullRequestLinkContextMenuAction>[] {
  return [
    { id: "copy-link", label: i18n.t("pullRequest.link.copy"), icon: "copy" },
    { id: "open-external", label: openLabel },
  ];
}

/**
 * The right-click on a change request's number. Everywhere else that number is written it is a
 * link, and the gesture that copies a link is the one hand reaches for — so without this the
 * platform's own edit menu opens over a control that has nothing to cut, paste or select.
 *
 * The host is named by the caller rather than guessed here: the same number belongs to GitHub,
 * GitLab, Bitbucket or Azure DevOps depending on where it was read, and the `url` the contract
 * carries is already whichever of them it came from.
 */
export async function showPullRequestLinkContextMenu({
  url,
  openLabel,
  position,
}: {
  readonly url: string;
  readonly openLabel: string;
  readonly position: { readonly x: number; readonly y: number };
}): Promise<void> {
  const api = readLocalApi();
  if (!api) return;
  let action: PullRequestLinkContextMenuAction | null = null;
  try {
    action = await api.contextMenu.show(pullRequestLinkContextMenuItems(openLabel), position);
  } catch {
    // A menu that could not be shown has already cost the reader their right-click; there is
    // nothing to say about it that a second popup would not make worse.
    return;
  }
  try {
    if (action === "copy-link") await writeTextToClipboard(url, "link");
    else if (action === "open-external") await openPullRequestExternal(url);
  } catch {
    toastManager.add({
      type: "error",
      title: i18n.t(
        action === "copy-link" ? "pullRequest.link.couldNotCopy" : "pullRequest.link.couldNotOpen",
      ),
    });
  }
}

export async function openPullRequestExternal(url: string): Promise<void> {
  const api = readLocalApi();
  if (!api) return;
  try {
    await api.shell.openExternal(url);
  } catch (error) {
    toastManager.add({
      type: "error",
      title: i18n.t("pullRequest.link.couldNotOpen"),
      ...(error instanceof Error ? { description: error.message } : {}),
    });
  }
}
