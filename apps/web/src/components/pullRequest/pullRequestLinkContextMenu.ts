import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import type { ContextMenuItem } from "@t3tools/contracts";
import {
  type SourceControlDefinition,
  UNKNOWN_SOURCE_CONTROL_CLIENT,
} from "@t3tools/client-runtime/source-control-clients";

import { msg } from "gt-react";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { i18n } from "~/i18n";
import { m, type MessageResolver } from "~/i18n/messages";
import { readLocalApi } from "~/localApi";

import { toastManager } from "../ui/toast";

export type PullRequestLinkContextMenuAction = "copy-link" | "open-external";

export const openOnHostLabel = (
  host: SourceControlDefinition,
  resolve?: MessageResolver,
): string =>
  host === UNKNOWN_SOURCE_CONTROL_CLIENT
    ? (resolve?.(msg("Open on host")) ?? i18n.t("pullRequest.link.openOnUnknownHost"))
    : (resolve?.(msg("Open on {host}", { host: host.label })) ??
      i18n.t("pullRequest.link.openOnHost", { host: host.label }));

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
    if (action === "copy-link")
      await writeTextToClipboard(url, {
        target: "link",
        unavailableMessage: msg("Clipboard API is unavailable while copying link."),
        failureMessage: msg("Failed to copy link to the clipboard."),
      });
    else if (action === "open-external") await openPullRequestExternal(url);
  } catch (error) {
    toastManager.add({
      type: "error",
      title: i18n.t("pullRequest.link.couldNotCopy"),
      description: thrownErrorMessage(error, m),
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
      description: thrownErrorMessage(error, m),
    });
  }
}
