import { formatDesktopUpdateMessage } from "@t3tools/client-runtime/i18n";
import type { DesktopBridge, DesktopUpdateState } from "@t3tools/contracts";
import { ArrowRightIcon } from "lucide-react";

import {
  getDesktopUpdateDownloadedVersion,
  getDesktopUpdateReleaseUrl,
  shouldToastDesktopUpdateActionResult,
} from "./desktopUpdate.logic";
import { DesktopUpdateText } from "./DesktopUpdateText";
import { stackedThreadToast, toastManager } from "./ui/toast";

type DesktopUpdateShell = Pick<DesktopBridge, "openExternal">;

export async function openDesktopUpdateDownload(
  bridge: Pick<DesktopBridge, "downloadUpdate">,
): Promise<void> {
  try {
    const result = await bridge.downloadUpdate();
    if (shouldToastDesktopUpdateActionResult(result)) {
      showDesktopUpdateErrorToast("about.updateDownload.error", result.state.message);
    }
  } catch (error) {
    showDesktopUpdateErrorToast(
      "about.updateDownload.error",
      error instanceof Error ? error.message : null,
    );
  }
}

export function showDesktopUpdateAvailableToast(
  bridge: Pick<DesktopBridge, "downloadUpdate">,
  state: DesktopUpdateState,
) {
  const id = toastManager.add(
    stackedThreadToast({
      type: "info",
      title: (
        <DesktopUpdateText
          render={(t) =>
            t(
              state.convene?.relation === "different-build"
                ? "update.client.revision"
                : "update.client.available",
              { version: state.availableVersion },
            )
          }
        />
      ),
      description: (
        <DesktopUpdateText
          render={(t) =>
            state.message
              ? formatDesktopUpdateMessage(state.message, t)
              : t("update.platform.manualInstall")
          }
        />
      ),
      actionProps: {
        children: (
          <DesktopUpdateText
            render={(t) =>
              t(
                state.convene?.downloadUrl
                  ? "update.platform.download"
                  : "update.platform.downloads",
              )
            }
          />
        ),
        onClick: () => {
          toastManager.close(id);
          void openDesktopUpdateDownload(bridge);
        },
      },
    }),
  );
  return id;
}

export async function openDesktopUpdateReleaseNotes(
  shell: DesktopUpdateShell | undefined,
  releaseUrl: string,
): Promise<void> {
  try {
    if (shell && (await shell.openExternal(releaseUrl))) return;
  } catch {
    // Surface rejected IPC calls through the same user-visible fallback.
  }
  toastManager.add({
    type: "error",
    title: <DesktopUpdateText render={(t) => t("update.notes.openFailed")} />,
  });
}

function ReleaseNotesLink({
  shell,
  releaseUrl,
}: {
  shell: DesktopUpdateShell;
  releaseUrl: string;
}) {
  return (
    <button
      className="ml-2 inline cursor-pointer text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
      onClick={() => {
        void openDesktopUpdateReleaseNotes(shell, releaseUrl);
      }}
      type="button"
    >
      <DesktopUpdateText render={(t) => t("update.notes.readMore")} />
      <ArrowRightIcon
        aria-hidden
        className="ml-1 inline size-3 -rotate-45 align-[-0.125em]"
        strokeWidth={2.25}
      />
    </button>
  );
}

export function showDesktopUpdateDownloadedToast(
  shell: DesktopUpdateShell,
  state: DesktopUpdateState,
): void {
  if (state.convene) return;
  const releaseUrl = getDesktopUpdateReleaseUrl(getDesktopUpdateDownloadedVersion(state), state);
  toastManager.add({
    type: "success",
    title: <DesktopUpdateText render={(t) => t("update.toast.downloaded")} />,
    description: (
      <>
        <DesktopUpdateText render={(t) => t("update.toast.restart")} />
        {releaseUrl ? <ReleaseNotesLink releaseUrl={releaseUrl} shell={shell} /> : null}
      </>
    ),
  });
}

export function showDesktopUpdateErrorToast(
  titleKey: string,
  message: string | null,
  fallbackKey = "update.unexpected",
): void {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: <DesktopUpdateText render={(t) => t(titleKey)} />,
      description: (
        <DesktopUpdateText
          render={(t) =>
            message === null ? t(fallbackKey) : formatDesktopUpdateMessage(message, t)
          }
        />
      ),
    }),
  );
}
