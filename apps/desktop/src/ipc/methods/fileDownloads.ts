import {
  DesktopFileDownloadInput,
  DesktopFileDownloadResult,
  type DesktopFileDownloadProgress,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Electron from "electron";

import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as Channels from "../channels.ts";

export const installFileDownloads = Effect.fn("desktop.ipc.installFileDownloads")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const windows = yield* ElectronWindow.ElectronWindow;
  const active = new Map<string, { senderId: number; cancel: () => void; close: () => void }>();
  const claimed = new WeakSet<Electron.DownloadItem>();
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const download of active.values()) download.close();
    }),
  );
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: Channels.DOWNLOAD_FILE_CHANNEL,
      payload: DesktopFileDownloadInput,
      result: DesktopFileDownloadResult,
      handler: Effect.fn("desktop.ipc.downloadFile")(function* (input, event) {
        const main = yield* windows.main;
        if (
          !event ||
          Option.isNone(main) ||
          main.value.isDestroyed() ||
          main.value.webContents.id !== event.sender.id ||
          !/^https?:$/.test(URL.parse(input.url)?.protocol ?? "") ||
          active.has(input.id)
        )
          return "failed" as const;
        const contents = main.value.webContents;
        const session = contents.session;
        return yield* Effect.callback<DesktopFileDownloadResult>((resume) => {
          let item: Electron.DownloadItem | undefined;
          let cancelled = false;
          let finished = false;
          const finish = (result: DesktopFileDownloadResult) => {
            if (finished) return;
            finished = true;
            active.delete(input.id);
            session.off("will-download", onDownload);
            contents.off("destroyed", onDestroyed);
            item?.off("updated", onProgress);
            item?.off("done", onDone);
            resume(Effect.succeed(result));
          };
          const onProgress = (_event?: Electron.Event, state?: string) => {
            if (state === "interrupted") {
              finish("failed");
              item?.cancel();
              return;
            }
            if (contents.isDestroyed() || !item) return;
            const progress: DesktopFileDownloadProgress = {
              id: input.id,
              receivedBytes: item.getReceivedBytes(),
              totalBytes: item.getTotalBytes(),
            };
            contents.send(Channels.FILE_DOWNLOAD_PROGRESS_CHANNEL, progress);
          };
          const onDone = (_event: Electron.Event, state: string) => {
            finish(state === "completed" || state === "cancelled" ? state : "failed");
          };
          const onDestroyed = () => {
            item?.cancel();
            finish("cancelled");
          };
          const onDownload = (
            _event: Electron.Event,
            candidate: Electron.DownloadItem,
            source: Electron.WebContents,
          ) => {
            if (
              source?.id !== contents.id ||
              claimed.has(candidate) ||
              !candidate.getURLChain().includes(input.url)
            )
              return;
            claimed.add(candidate);
            item = candidate;
            session.off("will-download", onDownload);
            item.setSaveDialogOptions({
              defaultPath: input.name.split(/[\\/]/).at(-1) ?? input.name,
            });
            item.on("updated", onProgress);
            item.once("done", onDone);
            if (cancelled) item.cancel();
            else onProgress();
          };
          active.set(input.id, {
            senderId: contents.id,
            cancel: () => {
              cancelled = true;
              item?.cancel();
            },
            close: onDestroyed,
          });
          session.on("will-download", onDownload);
          contents.once("destroyed", onDestroyed);
          try {
            contents.downloadURL(input.url);
          } catch {
            finish("failed");
          }
          return Effect.sync(() => {
            item?.cancel();
            finish("cancelled");
          });
        });
      }),
    }),
  );
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: Channels.CANCEL_FILE_DOWNLOAD_CHANNEL,
      payload: Schema.String,
      result: Schema.Void,
      handler: Effect.fn("desktop.ipc.cancelFileDownload")((id, event) =>
        Effect.sync(() => {
          const download = active.get(id);
          if (event && download?.senderId === event.sender.id) download.cancel();
        }),
      ),
    }),
  );
});
