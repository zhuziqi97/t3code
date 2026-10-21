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

export const openOnHostLabel = (host: SourceControlClientDefinition): string =>
  host === UNKNOWN_SOURCE_CONTROL_CLIENT
    ? i18n.t("pullRequest.link.openOnUnknownHost")
    : i18n.t("pullRequest.link.openOnHost", { host: host.label });

function pullRequestLinkContextMenuItems(
  openLabel: string,
): readonly ContextMenuItem<PullRequestLinkContextMenuAction>[] {
  return [
    { id: "copy-link", label: i18n.t("pullRequest.link.copy"), icon: "copy" },
    { id: "open-external", label: openLabel },
  ];
}

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
