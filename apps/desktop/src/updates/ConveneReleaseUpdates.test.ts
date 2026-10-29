import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import {
  HttpClient,
  HttpClientResponse,
  FetchHttpClient,
  HttpRouter,
  HttpServer,
  HttpServerResponse,
} from "effect/http";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopBackendPool from "../backend/DesktopBackendPool.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopTelemetryPublisher from "../telemetry/DesktopTelemetryPublisher.ts";
import * as ConveneReleaseUpdates from "./ConveneReleaseUpdates.ts";
import * as DesktopUpdates from "./DesktopUpdates.ts";
import * as DesktopRemoteUpdates from "./DesktopRemoteUpdates.ts";
import type { ConveneRelease } from "./conveneRelease.ts";
import type {
  DesktopTelemetryRequestDesktopUpdate,
  DesktopUpdateStatusReport,
} from "@t3tools/contracts";

const release = (version: string, build_id = version) => ({
  version,
  build_id,
  packages: [
    { platform: "linux-x64", version_key: `versions/${version}/${build_id}/linux-x64/client.deb` },
  ],
});

const harness = (
  options: {
    release?: typeof ConveneRelease.Type;
    buildId?: string | null;
    open?: boolean;
    blockOpen?: boolean;
    http?: ReturnType<typeof HttpClient.make>;
  } = {},
) =>
  Effect.gen(function* () {
    const source = yield* SubscriptionRef.make<string | null>(null);
    const requested = yield* Deferred.make<void>();
    const releaseA = yield* Deferred.make<void>();
    const blockOld = yield* Ref.make(false);
    const opened: string[] = [];
    const openResult = yield* Ref.make(options.open ?? true);
    const openStarted = yield* Deferred.make<void>();
    const releaseOpen = yield* Deferred.make<boolean>();
    const requests: string[] = [];
    const remoteRequests = yield* Queue.unbounded<DesktopTelemetryRequestDesktopUpdate>();
    const reported = yield* Deferred.make<DesktopUpdateStatusReport>();
    const publisher = DesktopTelemetryPublisher.DesktopTelemetryPublisher.of({
      conveneUpdateSources: SubscriptionRef.changes(source),
      latest: Effect.succeedNone,
      changes: Stream.empty,
      encoded: Stream.empty,
      handleControlForSource: () => Effect.void,
      removeControlSource: () => Effect.void,
      publishUpdateReport: (report) =>
        report.outcome ? Deferred.succeed(reported, report).pipe(Effect.asVoid) : Effect.void,
      updateRequests: Stream.fromQueue(remoteRequests),
      updateCommits: Stream.empty,
      updateCancellations: Stream.empty,
    });
    const http =
      options.http ??
      HttpClient.make((request) =>
        Effect.gen(function* () {
          requests.push(request.url);
          if (request.url.includes("/a/") && (yield* Ref.get(blockOld))) {
            yield* Deferred.succeed(requested, undefined);
            yield* Deferred.await(releaseA);
          }
          return HttpClientResponse.fromWeb(
            request,
            request.url.includes("/broken/")
              ? new Response(null, { status: 503 })
              : Response.json(
                  options.release ??
                    release(request.url.includes("/a/") ? "0.1.0-convene.20" : "0.1.0-convene.10"),
                ),
          );
        }),
      );
    const config = DesktopConfig.layerTest({ T3CODE_HOME: "/tmp/t3-issue31-unit" });
    const environment = DesktopEnvironment.layer({
      dirname: "/repo/apps/desktop/src",
      homeDirectory: "/tmp/t3-issue31-unit-home",
      platform: "linux",
      processArch: "x64",
      appVersion: "0.1.0-convene.2",
      appPath: "/repo",
      isPackaged: true,
      resourcesPath: "/resources",
      runningUnderArm64Translation: false,
    }).pipe(Layer.provide(Layer.merge(config, NodeServices.layer)));
    const deps = Layer.mergeAll(
      Layer.succeed(HttpClient.HttpClient, http),
      config,
      environment,
      Layer.succeed(DesktopTelemetryPublisher.DesktopTelemetryPublisher, publisher),
      Layer.mock(ElectronWindow.ElectronWindow)({ sendAll: () => Effect.void }),
      Layer.mock(ElectronShell.ElectronShell)({
        openExternal: (url) =>
          Effect.gen(function* () {
            opened.push(String(url));
            yield* Deferred.succeed(openStarted, undefined);
            return yield* options.blockOpen ? Deferred.await(releaseOpen) : Ref.get(openResult);
          }),
      }),
      FileSystem.layerNoop({
        readFileString: (path) =>
          Effect.succeed(
            path.endsWith("package-type")
              ? "deb"
              : JSON.stringify({
                  build_id: options.buildId === undefined ? "local" : options.buildId,
                }),
          ),
      }),
    );
    const updates = yield* ConveneReleaseUpdates.make.pipe(Effect.provide(deps));
    return {
      updates,
      source,
      requested,
      releaseA,
      blockOld,
      opened,
      openResult,
      openStarted,
      releaseOpen,
      requests,
      publisher,
      remoteRequests,
      reported,
    };
  });

it.effect(
  "drops a late old-platform result, downloads the exact new-platform build and clears on unpair",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness();
        yield* h.updates.configure;
        assert.isFalse((yield* h.updates.check("manual")).checked);
        const { changes } = yield* h.updates.subscribe;
        const initial = yield* changes.pipe(
          Stream.filter((s) => s.status === "available"),
          Stream.runHead,
          Effect.forkChild,
        );
        yield* SubscriptionRef.set(h.source, "https://platform.example/a");
        yield* Fiber.join(initial);
        yield* Ref.set(h.blockOld, true);
        const oldCheck = yield* h.updates.check("manual").pipe(Effect.forkChild);
        yield* Deferred.await(h.requested);
        const ready = yield* changes.pipe(
          Stream.filter(
            (s) => s.status === "available" && s.convene?.baseUrl?.endsWith("/b") === true,
          ),
          Stream.runHead,
          Effect.forkChild,
        );
        yield* SubscriptionRef.set(h.source, "https://platform.example/b");
        const current = Option.getOrThrow(yield* Fiber.join(ready));
        assert.equal(current.availableVersion, "0.1.0-convene.10");
        yield* Deferred.succeed(h.releaseA, undefined);
        assert.isFalse((yield* Fiber.join(oldCheck)).checked);
        assert.equal((yield* h.updates.getState).availableVersion, "0.1.0-convene.10");
        assert.isTrue((yield* h.updates.download).completed);
        assert.deepEqual(h.opened, [
          "https://platform.example/b/downloads/file/versions/0.1.0-convene.10/0.1.0-convene.10/linux-x64/client.deb",
        ]);
        assert.isFalse((yield* h.updates.install).accepted);
        const cleared = yield* changes.pipe(
          Stream.filter((s) => s.convene?.baseUrl === null),
          Stream.runHead,
          Effect.forkChild,
        );
        yield* SubscriptionRef.set(h.source, null);
        assert.isNull(Option.getOrThrow(yield* Fiber.join(cleared)).availableVersion);
        assert.isFalse((yield* h.updates.download).accepted);
      }),
    ),
);

it.effect(
  "checks after binding and on the poll interval, reports real HTTP failure and can recover manually",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness();
        yield* h.updates.configure;
        const { changes } = yield* h.updates.subscribe;
        const failed = yield* changes.pipe(
          Stream.filter((s) => s.status === "error"),
          Stream.runHead,
          Effect.forkChild,
        );
        yield* SubscriptionRef.set(h.source, "https://platform.example/broken");
        assert.equal(Option.getOrThrow(yield* Fiber.join(failed)).errorContext, "check");
        assert.isTrue((yield* h.updates.check("manual")).checked);
        assert.equal((yield* h.updates.getState).status, "error");
        const checked = yield* changes.pipe(
          Stream.filter((s) => s.status === "available"),
          Stream.runHead,
          Effect.forkChild,
        );
        yield* SubscriptionRef.set(h.source, "https://platform.example/b");
        yield* Fiber.join(checked);
        const before = h.requests.length;
        yield* TestClock.adjust("4 minutes");
        assert.isAbove(h.requests.length, before);
      }),
    ),
);

it.effect.each([
  ["same build", release("0.1.0-convene.2", "local"), "up-to-date", "same", "local"],
  [
    "same version revision",
    release("0.1.0-convene.2", "revision"),
    "available",
    "different-build",
    "local",
  ],
  ["older release", release("0.1.0-convene.1"), "up-to-date", "older", "local"],
  ["unknown local build", release("0.1.0-convene.2"), "idle", "unknown-build", null],
  [
    "no matching package",
    { ...release("0.1.0-convene.10"), packages: [] },
    "available",
    "newer",
    "local",
  ],
] as const)(
  "reports %s consistently for automatic and manual checks",
  ([_name, published, expectedStatus, expectedRelation, buildId]) =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness({ release: published, buildId });
        yield* h.updates.configure;
        const { changes } = yield* h.updates.subscribe;
        const checked = yield* changes.pipe(
          Stream.filter((s) => s.checkedAt !== null && s.status !== "checking"),
          Stream.runHead,
          Effect.forkChild,
        );
        yield* SubscriptionRef.set(h.source, "https://platform.example/b");
        const automatic = Option.getOrThrow(yield* Fiber.join(checked));
        const manual = (yield* h.updates.check("manual")).state;
        for (const state of [automatic, manual]) {
          assert.equal(state.status, expectedStatus);
          assert.equal(state.convene?.relation, expectedRelation);
          if (published.packages.length === 0) {
            assert.isNull(state.convene?.downloadUrl);
            assert.include(state.message, "no matching package");
          }
        }
        if (published.packages.length === 0) {
          assert.isTrue((yield* h.updates.download).completed);
          assert.deepEqual(h.opened, ["https://platform.example/b/downloads/latest"]);
        }
      }),
    ),
);

it.effect.each([
  {
    name: "newer release",
    published: release("0.1.0-convene.10"),
    message: "install it when you are ready",
  },
  {
    name: "same-version revision",
    published: release("0.1.0-convene.2", "revision"),
    message: "different build",
  },
  {
    name: "no matching package",
    published: { ...release("0.1.0-convene.10"), packages: [] },
    message: "no matching package",
  },
])(
  "clears an external-open error after retry for $name without entering install state",
  ({ published, message }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness({ open: false, release: published });
        yield* h.updates.configure;
        const { changes } = yield* h.updates.subscribe;
        const checked = yield* changes.pipe(
          Stream.filter((s) => s.status === "available"),
          Stream.runHead,
          Effect.forkChild,
        );
        yield* SubscriptionRef.set(h.source, "https://platform.example/b");
        yield* Fiber.join(checked);
        const action = yield* h.updates.download;
        assert.isFalse(action.completed);
        assert.equal(action.state.errorContext, "download");
        assert.isNull(action.state.downloadedVersion);
        assert.isFalse((yield* h.updates.install).accepted);
        yield* Ref.set(h.openResult, true);
        const retry = yield* h.updates.download;
        assert.isTrue(retry.completed);
        assert.equal(retry.state.status, "available");
        assert.isNull(retry.state.errorContext);
        assert.isFalse(retry.state.canRetry);
        assert.include(retry.state.message, message);
        assert.isNull(retry.state.downloadedVersion);
      }),
    ),
);

it.effect(
  "rejects remote automatic installation without opening a download or preparing an install",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness();
        yield* h.updates.configure;
        const { changes } = yield* h.updates.subscribe;
        const checked = yield* changes.pipe(
          Stream.filter((s) => s.status === "available"),
          Stream.runHead,
          Effect.forkChild,
        );
        yield* SubscriptionRef.set(h.source, "https://platform.example/b");
        yield* Fiber.join(checked);
        yield* DesktopRemoteUpdates.listen.pipe(
          Effect.provideService(DesktopUpdates.DesktopUpdates, h.updates),
          Effect.provideService(DesktopTelemetryPublisher.DesktopTelemetryPublisher, h.publisher),
          Effect.provide(Layer.mock(DesktopBackendPool.DesktopBackendPool)({})),
        );
        yield* Queue.offer(h.remoteRequests, {
          version: 1,
          type: "requestDesktopUpdate",
          requestId: "manual-only",
        });
        const report = yield* Deferred.await(h.reported);
        assert.equal(report.outcome, "failed");
        assert.include(report.reason, "install it when you are ready");
        assert.deepEqual(h.opened, []);
        assert.isNull(report.state.downloadedVersion);
        assert.isFalse(yield* h.updates.isInstallActive);
      }),
    ),
);

it.live(
  "reads an isolated real HTTP release and opens its immutable build URL without preparing an install",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const manifest = release("0.1.0-convene.10", "http-build");
        const route = HttpRouter.add(
          "GET",
          "/tenant/downloads/release.json",
          HttpServerResponse.json(manifest),
        );
        const serverContext = yield* Layer.build(
          HttpRouter.serve(route, { disableListenLog: true }).pipe(
            Layer.provideMerge(NodeHttpServer.layerTest),
          ),
        );
        const server = Context.get(serverContext, HttpServer.HttpServer);
        const clientContext = yield* Layer.build(FetchHttpClient.layer);
        const h = yield* harness({ http: Context.get(clientContext, HttpClient.HttpClient) });
        yield* h.updates.configure;
        const { changes } = yield* h.updates.subscribe;
        const ready = yield* changes.pipe(
          Stream.filter((state) => state.status === "available"),
          Stream.runHead,
          Effect.forkChild,
        );
        const baseUrl = `${HttpServer.formatAddress(server.address)}/tenant`;
        yield* SubscriptionRef.set(h.source, baseUrl);
        assert.equal(
          Option.getOrThrow(yield* Fiber.join(ready)).convene?.releaseBuildId,
          "http-build",
        );
        assert.isTrue((yield* h.updates.check("web-ui")).checked);
        assert.isTrue((yield* h.updates.download).completed);
        assert.deepEqual(h.opened, [
          `${baseUrl}/downloads/file/versions/0.1.0-convene.10/http-build/linux-x64/client.deb`,
        ]);
        assert.isFalse((yield* h.updates.install).accepted);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("does not restore the old platform when its OS open fails after switching sources", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const h = yield* harness({ blockOpen: true });
      yield* h.updates.configure;
      const { changes } = yield* h.updates.subscribe;
      const first = yield* changes.pipe(
        Stream.filter((s) => s.status === "available"),
        Stream.runHead,
        Effect.forkChild,
      );
      yield* SubscriptionRef.set(h.source, "https://platform.example/a");
      yield* Fiber.join(first);
      const opening = yield* h.updates.download.pipe(Effect.forkChild);
      yield* Deferred.await(h.openStarted);
      const second = yield* changes.pipe(
        Stream.filter(
          (s) => s.status === "available" && s.convene?.baseUrl?.endsWith("/b") === true,
        ),
        Stream.runHead,
        Effect.forkChild,
      );
      yield* SubscriptionRef.set(h.source, "https://platform.example/b");
      yield* Fiber.join(second);
      yield* Deferred.succeed(h.releaseOpen, false);
      const result = yield* Fiber.join(opening);
      assert.isFalse(result.accepted);
      assert.isFalse(result.completed);
      assert.equal(result.state.convene?.baseUrl, "https://platform.example/b");
      assert.equal(result.state.availableVersion, "0.1.0-convene.10");
      assert.equal(result.state.status, "available");
      assert.isNull(result.state.errorContext);
    }),
  ),
);
