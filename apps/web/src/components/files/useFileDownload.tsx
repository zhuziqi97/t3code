import type { DesktopFileDownloadProgress } from "@t3tools/contracts";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { useRef, useState } from "react";

import { i18n, useTranslate } from "~/i18n";
import { randomUUID } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { formatFilePreviewErrorMessage } from "./filePreviewMode";

type DownloadState =
  | { phase: "idle" | "preparing" | "started" | "completed" | "cancelled" | "failed" }
  | { phase: "downloading"; progress: DesktopFileDownloadProgress };

function startBrowserDownload(url: string, name: string) {
  // An error response must not replace the file preview, including on cross-origin downloads.
  const frameId = "t3-file-download";
  if (!document.getElementById(frameId)) {
    const frame = document.createElement("iframe");
    frame.id = frameId;
    frame.name = frameId;
    frame.hidden = true;
    frame.title = "File download";
    document.body.append(frame);
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.target = frameId;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export function useFileDownload() {
  const [state, setState] = useState<DownloadState>({ phase: "idle" });
  const active = useRef<{ id: string; cancel: () => Promise<void> } | null>(null);
  const busy = state.phase === "preparing" || state.phase === "downloading";
  const start = (input: {
    name: string;
    file?: Blob | null | undefined;
    prepare: () => Promise<string | null>;
  }) => {
    if (active.current) return;
    const id = randomUUID();
    active.current = { id, cancel: async () => {} };
    setState({ phase: "preparing" });
    void (async () => {
      const name = input.name.split(/[\\/]/).at(-1) || input.name;
      if (input.file) {
        const url = URL.createObjectURL(input.file);
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
        startBrowserDownload(url, name);
        setState({ phase: "started" });
        return;
      }
      const url = await input.prepare();
      if (!url) throw new Error("Reconnect to the environment and try again.");
      const bridge = window.desktopBridge;
      if (bridge) {
        active.current = { id, cancel: () => bridge.cancelFileDownload(id) };
        const result = await bridge.downloadFile({ id, url, name }, (progress) => {
          setState({ phase: "downloading", progress });
        });
        setState({ phase: result });
        if (result === "failed") throw new Error(i18n.t("filePreview.downloadFailed"));
      } else {
        startBrowserDownload(url, name);
        setState({ phase: "started" });
      }
    })()
      .catch((cause: unknown) => {
        setState({ phase: "failed" });
        toastManager.add({
          type: "error",
          title: i18n.t("filePreview.saveFailed"),
          description:
            cause instanceof Error
              ? formatFilePreviewErrorMessage(cause.message)
              : i18n.t("restore.tryAgain"),
        });
      })
      .finally(() => {
        active.current = null;
      });
  };
  const cancel = () => {
    void active.current?.cancel().catch((cause: unknown) => {
      toastManager.add({
        type: "error",
        title: i18n.t("filePreview.saveFailed"),
        description: cause instanceof Error ? cause.message : i18n.t("restore.tryAgain"),
      });
    });
  };
  return { state, busy, start, cancel };
}

export function FileDownloadStatus(props: { download: ReturnType<typeof useFileDownload> }) {
  const t = useTranslate();
  const { state, cancel } = props.download;
  if (state.phase === "idle") return null;
  const message =
    state.phase === "downloading"
      ? t(
          state.progress.totalBytes > 0
            ? "filePreview.downloadProgress"
            : "filePreview.downloadProgressUnknown",
          {
            received: formatAttachmentSize(state.progress.receivedBytes),
            total: formatAttachmentSize(state.progress.totalBytes),
          },
        )
      : t(
          state.phase === "preparing"
            ? "filePreview.preparing"
            : state.phase === "started"
              ? "filePreview.downloadStarted"
              : state.phase === "completed"
                ? "filePreview.downloadComplete"
                : state.phase === "cancelled"
                  ? "filePreview.downloadCancelled"
                  : "filePreview.downloadFailed",
        );
  return (
    <div className="flex items-center gap-2 border-b px-3 py-1 text-xs text-muted-foreground">
      <span role="status" className="min-w-0 flex-1">
        {message}
      </span>
      {state.phase === "downloading" ? (
        <Button variant="ghost" size="sm" onClick={cancel}>
          {t("filePreview.cancelDownload")}
        </Button>
      ) : null}
    </div>
  );
}
