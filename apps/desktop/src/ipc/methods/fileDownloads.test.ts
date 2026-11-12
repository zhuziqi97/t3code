import * as NodeEvents from "node:events";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import type * as Electron from "electron";
import { vi } from "vite-plus/test";

import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as Channels from "../channels.ts";
import { installFileDownloads } from "./fileDownloads.ts";

const url = "https://environment.example/assets/signed-file";
const input = { id: "download-1", url, name: "folder/大文件.part1.rar" };

const setup = Effect.gen(function* () {
  const handlers = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
  const starts: Array<() => void> = [];
  const session = new NodeEvents.EventEmitter();
  const contents = Object.assign(new NodeEvents.EventEmitter(), {
    id: 1,
    session,
    isDestroyed: () => false,
    send: vi.fn(),
    downloadURL: vi.fn(() => starts.shift()?.()),
  });
  const window = {
    isDestroyed: () => false,
    webContents: contents,
  } as unknown as Electron.BrowserWindow;
  yield* installFileDownloads().pipe(
    Effect.provide(
      Layer.merge(
        DesktopIpc.layerTest({
          handle: (channel, handler) => {
            handlers.set(channel, handler);
          },
          removeHandler: (channel) => {
            handlers.delete(channel);
          },
          removeAllListeners: () => {},
          on: () => {},
        }),
        Layer.mock(ElectronWindow.ElectronWindow)({ main: Effect.succeedSome(window) }),
      ),
    ),
  );
  const invoke = (channel: string, payload: unknown, senderId = 1) =>
    Effect.promise(() =>
      Promise.resolve(handlers.get(channel)!({ sender: { id: senderId } }, payload)),
    );
  const start = Effect.fnUntraced(function* (id = input.id) {
    const entered = Promise.withResolvers<void>();
    starts.push(entered.resolve);
    const result = yield* invoke(Channels.DOWNLOAD_FILE_CHANNEL, { ...input, id }).pipe(
      Effect.forkChild,
    );
    yield* Effect.promise(() => entered.promise);
    return result;
  });
  const makeItem = () => {
    const item = Object.assign(new NodeEvents.EventEmitter(), {
      getURLChain: () => [url],
      getReceivedBytes: () => 7,
      getTotalBytes: () => 100,
      setSaveDialogOptions: vi.fn(),
      cancel: vi.fn(() => {
        item.emit("done", {}, "cancelled");
      }),
    });
    return item;
  };
  return { invoke, start, makeItem, contents, session };
});

it.effect.each(["completed", "interrupted", "recoverable-interruption"] as const)(
  "streams a native file download to %s without reading bytes through IPC",
  (state) =>
    Effect.scoped(
      Effect.gen(function* () {
        const { start, makeItem, session, contents } = yield* setup;
        const result = yield* start();
        const item = makeItem();
        session.emit("will-download", {}, item, contents);
        assert.deepEqual(item.setSaveDialogOptions.mock.calls, [
          [{ defaultPath: "大文件.part1.rar" }],
        ]);
        assert.deepEqual(contents.downloadURL.mock.calls, [[url]]);
        assert.deepEqual(contents.send.mock.calls.at(-1), [
          Channels.FILE_DOWNLOAD_PROGRESS_CHANNEL,
          {
            id: input.id,
            receivedBytes: 7,
            totalBytes: 100,
          },
        ]);
        if (state === "recoverable-interruption") {
          item.emit("updated", {}, "interrupted");
          assert.equal(item.cancel.mock.calls.length, 1);
        } else item.emit("done", {}, state);
        assert.equal(yield* Fiber.join(result), state === "completed" ? "completed" : "failed");
        assert.equal(session.listenerCount("will-download"), 0);
        assert.equal(item.listenerCount("updated"), 0);
        assert.equal(contents.listenerCount("destroyed"), 0);
      }),
    ),
);

it.effect("cancels only the requesting window's download, including before the item arrives", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { start, makeItem, invoke, session, contents } = yield* setup;
      const result = yield* start();
      yield* invoke(Channels.CANCEL_FILE_DOWNLOAD_CHANNEL, input.id, 2);
      const item = makeItem();
      session.emit("will-download", {}, item, contents);
      assert.equal(item.cancel.mock.calls.length, 0);
      yield* invoke(Channels.CANCEL_FILE_DOWNLOAD_CHANNEL, input.id);
      assert.equal(yield* Fiber.join(result), "cancelled");
      const pending = yield* start("pending");
      yield* invoke(Channels.CANCEL_FILE_DOWNLOAD_CHANNEL, "pending");
      const next = makeItem();
      session.emit("will-download", {}, next, contents);
      assert.equal(next.cancel.mock.calls.length, 1);
      assert.equal(yield* Fiber.join(pending), "cancelled");
      assert.equal(session.listenerCount("will-download"), 0);
    }),
  ),
);

it.effect(
  "keeps simultaneous downloads of the same URL independent and cleans up on window close",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { start, makeItem, session, contents } = yield* setup;
        const first = yield* start();
        const second = yield* start("download-2");
        const one = makeItem();
        session.emit("will-download", {}, one, contents);
        assert.equal(one.listenerCount("done"), 1);
        one.emit("done", {}, "completed");
        assert.equal(yield* Fiber.join(first), "completed");
        const two = makeItem();
        session.emit("will-download", {}, two, contents);
        assert.equal(contents.send.mock.calls.at(-1)?.[1].id, "download-2");
        contents.emit("destroyed");
        assert.equal(yield* Fiber.join(second), "cancelled");
        assert.equal(two.cancel.mock.calls.length, 1);
        assert.equal(session.listenerCount("will-download"), 0);
      }),
    ),
);

it.effect("rejects other windows and non-HTTP assets without starting a native download", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { invoke, contents } = yield* setup;
      assert.equal(yield* invoke(Channels.DOWNLOAD_FILE_CHANNEL, input, 2), "failed");
      assert.equal(
        yield* invoke(Channels.DOWNLOAD_FILE_CHANNEL, { ...input, url: "file:///tmp/a" }),
        "failed",
      );
      assert.equal(contents.downloadURL.mock.calls.length, 0);
    }),
  ),
);
