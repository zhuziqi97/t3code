// @effect-diagnostics nodeBuiltinImport:off - Controlled duplex streams stand in for the desktop's inherited descriptors.
import * as NodeStream from "node:stream";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import { expect, vi } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import * as DesktopBrowserChannel from "./DesktopBrowserChannel.ts";

const descriptors = vi.hoisted(() => new Map<number, import("node:stream").Duplex>());
vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:net")>();
  return {
    ...actual,
    Socket: function (options?: import("node:net").SocketConstructorOpts) {
      return descriptors.get(options?.fd ?? -1) ?? new actual.Socket(options);
    },
  };
});

const key = { threadId: "thread", tabId: "tab" };
const layer = DesktopBrowserChannel.layer.pipe(
  Layer.updateService(ServerConfig.ServerConfig, (config) => ({
    ...config,
    desktopBrowserFd: 33,
    desktopBrowserControlFd: 34,
  })),
  Layer.provide(
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-desktop-channel-" }).pipe(
      Layer.provide(NodeServices.layer),
    ),
  ),
);

const setup = Effect.gen(function* () {
  descriptors.clear();
  const writes = yield* Queue.unbounded<{ line: string; flush: () => void }>();
  const pending = new Set<() => void>();
  const sent: string[] = [];
  let autoFlush = false;
  const input = new NodeStream.PassThrough();
  const output = new NodeStream.Duplex({
    highWaterMark: 1,
    read() {},
    write(chunk: Buffer, _encoding, callback) {
      sent.push(chunk.toString());
      if (autoFlush) queueMicrotask(callback);
      else {
        const flush = () => {
          pending.delete(flush);
          callback();
        };
        pending.add(flush);
        // A descriptor write reports progress after write() returns to its caller.
        queueMicrotask(() => Queue.offerUnsafe(writes, { line: chunk.toString(), flush }));
      }
    },
  });
  descriptors.set(33, input);
  descriptors.set(34, output);
  return {
    input,
    output,
    sent,
    writes,
    finish: () => {
      autoFlush = true;
      for (const flush of pending) flush();
    },
  };
});

it.effect("holds overlapping activity leases until the last release is written", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;
    yield* Effect.gen(function* () {
      const channel = yield* DesktopBrowserChannel.DesktopBrowserChannel;
      const acquiring = yield* channel.acquireActivity(key).pipe(Effect.forkScoped);
      const first = yield* Queue.take(fixture.writes);
      expect(JSON.parse(first.line)).toEqual({ type: "activity", ...key, active: true });
      expect(acquiring.pollUnsafe()).toBeUndefined();
      first.flush();
      const releaseFirst = yield* Fiber.join(acquiring);
      const releaseLast = yield* channel.acquireActivity(key);
      yield* releaseFirst;
      expect(yield* Queue.size(fixture.writes)).toBe(0);
      const releasing = yield* releaseLast.pipe(Effect.forkScoped);
      const last = yield* Queue.take(fixture.writes);
      expect(JSON.parse(last.line)).toEqual({ type: "activity", ...key, active: false });
      last.flush();
      yield* Fiber.join(releasing);
      yield* releaseLast;
      expect(yield* Queue.size(fixture.writes)).toBe(0);
      fixture.finish();
    }).pipe(Effect.ensuring(Effect.sync(fixture.finish)), Effect.provide(layer), Effect.scoped);
  }),
);

it.effect("releases held activity before the channel closes and tolerates a late release", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;
    let release: Effect.Effect<void> = Effect.void;
    yield* Effect.gen(function* () {
      const channel = yield* DesktopBrowserChannel.DesktopBrowserChannel;
      const acquiring = yield* channel.acquireActivity(key).pipe(Effect.forkScoped);
      const first = yield* Queue.take(fixture.writes);
      first.flush();
      release = yield* Fiber.join(acquiring);
      fixture.finish();
    }).pipe(Effect.ensuring(Effect.sync(fixture.finish)), Effect.provide(layer), Effect.scoped);
    expect(fixture.output.destroyed).toBe(true);
    expect(fixture.sent.map((line) => JSON.parse(line))).toEqual([
      { type: "activity", ...key, active: true },
      { type: "release", ...key },
    ]);
    yield* release;
  }),
);

it.effect("closes an endpoint scope after its channel writer has ended", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;
    fixture.finish();
    yield* Effect.gen(function* () {
      const channel = yield* DesktopBrowserChannel.DesktopBrowserChannel;
      fixture.input.write(`${JSON.stringify({ type: "attached", ...key })}\n`);
      expect(yield* channel.awaitAttached(key, "5 seconds")).toBe(true);
      yield* channel.endpoint(key);
    }).pipe(Effect.provide(layer), Effect.scoped);
    expect(fixture.output.destroyed).toBe(true);
  }),
);
it.effect("protects unknown desktop visibility until an explicit hidden report arrives", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;
    fixture.finish();
    yield* Effect.gen(function* () {
      const channel = yield* DesktopBrowserChannel.DesktopBrowserChannel;
      const key = { threadId: "thread-1", tabId: "tab-1" };
      const send = (event: object) =>
        Effect.sync(() => fixture.input.write(`${JSON.stringify(event)}\n`));

      expect(channel.isShown(key)).toBe(true);
      yield* send({ type: "attached", ...key });
      yield* channel.awaitAttached(key, "5 seconds");
      expect(channel.isShown(key)).toBe(true);

      yield* send({ type: "shown", ...key, shown: false });
      yield* send({ type: "attached", threadId: key.threadId, tabId: "sentinel-1" });
      yield* channel.awaitAttached({ threadId: key.threadId, tabId: "sentinel-1" }, "5 seconds");
      expect(channel.isShown(key)).toBe(false);

      yield* send({ type: "shown", ...key, shown: true });
      yield* send({ type: "attached", threadId: key.threadId, tabId: "sentinel-2" });
      yield* channel.awaitAttached({ threadId: key.threadId, tabId: "sentinel-2" }, "5 seconds");
      expect(channel.isShown(key)).toBe(true);

      yield* send({ type: "shown", ...key, shown: false });
      yield* send({ type: "detached", ...key });
      yield* send({ type: "attached", threadId: key.threadId, tabId: "sentinel-3" });
      yield* channel.awaitAttached({ threadId: key.threadId, tabId: "sentinel-3" }, "5 seconds");
      expect(channel.isShown(key)).toBe(true);
    }).pipe(Effect.provide(layer), Effect.scoped);
  }),
);
