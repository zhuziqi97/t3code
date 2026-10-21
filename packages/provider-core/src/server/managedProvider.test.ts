import { describe, it, assert } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Deferred from "effect/Deferred";
import * as NodeUtil from "node:util";
import type { ManagedServerProvider } from "./snapshot.ts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ProviderHost from "./ProviderHost.ts";
import { makeManagedServerProvider, reportProviderProgress } from "./managedProvider.ts";
import {
  createProviderVersionAdvisory,
  makeCachedProviderMaintenanceResolution,
} from "./maintenanceResolver.ts";

const emptyCapabilities = createModelCapabilities({ optionDescriptors: [] });
const fastModeCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "fastMode",
      label: "Fast Mode",
      type: "boolean",
    },
  ],
});

interface TestSettings {
  readonly enabled: boolean;
}

const maintenanceCapabilities = {
  provider: ProviderDriverKind.make("codex"),
  packageName: "@openai/codex",
  update: {
    command: "npm install -g @openai/codex@latest",

    executable: "npm",

    args: ["install", "-g", "@openai/codex@latest"],

    lockKey: "npm-global",
  },
} as const;

const initialSnapshot: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "warning",
  auth: { status: "unknown" },
  checkedAt: "2026-04-10T00:00:00.000Z",
  message: "Checking provider availability...",
  models: [],
  slashCommands: [],
  skills: [],
};

const refreshedSnapshot: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-04-10T00:00:01.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};

const enrichedSnapshot: ServerProvider = {
  ...refreshedSnapshot,
  checkedAt: "2026-04-10T00:00:02.000Z",
  models: [
    {
      slug: "composer-2",
      name: "Composer 2",
      isCustom: false,
      capabilities: fastModeCapabilities,
    },
  ],
};

const refreshedSnapshotSecond: ServerProvider = {
  ...refreshedSnapshot,
  checkedAt: "2026-04-10T00:00:03.000Z",
  message: "Refreshed provider availability again.",
};

function layerProviderHost(input: {
  readonly runBackgroundWork: boolean;
  readonly settings?: Pick<ProviderHost.ProviderHost["Service"], "settings">["settings"];
}) {
  return Layer.succeed(
    ProviderHost.ProviderHost,
    ProviderHost.ProviderHost.of({
      paths: {
        cwd: process.cwd(),
        baseDir: "/t3",
        stateDir: "/t3/userdata",
        providerStatusCacheDir: "/t3/caches",
        attachmentsDir: "/t3/userdata/attachments",
      },
      settings: input.settings ?? {
        get: Effect.succeed(DEFAULT_SERVER_SETTINGS),
        withSnapshot: (use) => use(DEFAULT_SERVER_SETTINGS),
        changes: Stream.empty,
        subscribe: Effect.succeed(Stream.empty),
      },
      shouldRunBackgroundWork: () => Effect.succeed(input.runBackgroundWork),
      resolveAttachmentPath: () => null,
      credentials: () => Effect.die("unused"),
    }),
  );
}

const layerAlwaysRunTest = layerProviderHost({ runBackgroundWork: true });
const layerNeverRunTest = layerProviderHost({ runBackgroundWork: false });

const enrichedSnapshotSecond: ServerProvider = {
  ...refreshedSnapshotSecond,
  checkedAt: "2026-04-10T00:00:04.000Z",
  models: [
    {
      slug: "gpt-5.4",
      name: "GPT-5.4",
      isCustom: false,
      capabilities: emptyCapabilities,
    },
  ],
};

// These tests compare discovery content; operation transitions have dedicated tests below.
const snapshotContents = (snapshot: ServerProvider): ServerProvider => {
  const { operation: _operation, metadata, ...rest } = snapshot;
  return metadata && Object.keys(metadata).length ? { ...rest, metadata } : rest;
};
const snapshotContentsEffect = (provider: ManagedServerProvider) =>
  provider.getSnapshot.pipe(Effect.map(snapshotContents));
const snapshotChanges = (provider: ManagedServerProvider) =>
  Stream.unwrap(
    provider.getSnapshot.pipe(
      Effect.map((current) => {
        let previous = snapshotContents(current);
        return provider.streamChanges.pipe(
          Stream.map(snapshotContents),
          Stream.filter((next) => {
            const changed = !NodeUtil.isDeepStrictEqual(previous, next);
            previous = next;
            return changed;
          }),
        );
      }),
    ),
  );

describe("makeManagedServerProvider", () => {
  it.effect("owns independent workspace scans and only cancels the selected scan", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const enteredA = yield* Deferred.make<void>();
        const enteredB = yield* Deferred.make<void>();
        const releasedA = yield* Deferred.make<void>();
        const finishB = yield* Deferred.make<void>();
        const calls = yield* Ref.make(0);
        const provider = yield* makeManagedServerProvider({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: () => false,
          initialSnapshot: () => Effect.succeed(initialSnapshot),
          checkProvider: Effect.succeed(refreshedSnapshot),
          refreshInterval: "1 hour",
        });
        yield* provider.refresh;
        const first = yield* provider.startRefresh({
          cwd: "/qa/a",
          work: () =>
            Ref.update(calls, (n) => n + 1).pipe(
              Effect.andThen(Deferred.succeed(enteredA, undefined)),
              Effect.andThen(Effect.never),
              Effect.ensuring(Deferred.succeed(releasedA, undefined)),
            ),
        });
        yield* Deferred.await(enteredA);
        const repeated = yield* provider.startRefresh({
          cwd: "/qa/a",
          work: () => Ref.update(calls, (n) => n + 1),
        });
        const second = yield* provider.startRefresh({
          cwd: "/qa/b",
          work: () =>
            Deferred.succeed(enteredB, undefined).pipe(Effect.andThen(Deferred.await(finishB))),
        });
        yield* Deferred.await(enteredB);
        const a = first.metadataOperations!.find((op) => op.cwd === "/qa/a")!;
        const b = second.metadataOperations!.find((op) => op.cwd === "/qa/b")!;
        assert.strictEqual(repeated.metadataOperations!.find((op) => op.cwd === "/qa/a")!.id, a.id);
        assert.strictEqual(yield* Ref.get(calls), 1);
        yield* provider.cancelRefresh(a.id);
        yield* Deferred.await(releasedA);
        const snapshot = yield* provider.getSnapshot;
        assert.strictEqual(snapshot.status, "ready");
        assert.strictEqual(
          snapshot.metadataOperations!.find((op) => op.id === a.id)!.state,
          "cancelled",
        );
        assert.strictEqual(
          snapshot.metadataOperations!.find((op) => op.id === b.id)!.state,
          "running",
        );
        yield* provider.cancelRefresh("superseded-operation");
        assert.strictEqual(
          (yield* provider.getSnapshot).metadataOperations!.find((op) => op.id === b.id)!.state,
          "running",
        );
        yield* Deferred.succeed(finishB, undefined);
      }),
    ).pipe(Effect.provide(layerAlwaysRunTest)),
  );
  it.effect("cancels a joining discovery without terminating the shared initial preparation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const closed = yield* Deferred.make<void>();
        const provider = yield* makeManagedServerProvider({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: () => false,
          initialSnapshot: () =>
            Effect.succeed({ ...initialSnapshot, installed: null, status: "checking" as const }),
          checkProvider: Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Deferred.succeed(closed, undefined)),
          ),
          refreshInterval: "1 hour",
        });
        const pending = yield* provider.startRefresh({ kind: "models", work: (check) => check });
        yield* Deferred.await(entered);
        yield* provider.cancelRefresh(pending.metadataOperations![0]!.id);
        const stillPreparing = yield* provider.getSnapshot;
        assert.strictEqual(stillPreparing.status, "checking");
        assert.strictEqual(stillPreparing.operation!.state, "running");
        yield* provider.cancelRefresh(stillPreparing.operation!.id);
        yield* Deferred.await(closed);
        const cancelled = yield* provider.getSnapshot;
        assert.strictEqual(cancelled.status, "cancelled");
        assert.strictEqual(cancelled.installed, null);
      }),
    ).pipe(Effect.provide(layerAlwaysRunTest)),
  );

  it.effect("reuses the native check across consumers in one discovery operation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const calls = yield* Ref.make(0);
        const finished = yield* Deferred.make<void>();
        const provider = yield* makeManagedServerProvider({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: () => false,
          initialSnapshot: () => Effect.succeed(initialSnapshot),
          checkProvider: Ref.update(calls, (n) => n + 1).pipe(Effect.as(refreshedSnapshot)),
          refreshInterval: "1 hour",
        });
        yield* provider.refresh;
        const before = yield* Ref.get(calls);
        yield* provider.startRefresh({
          kind: "models",
          work: (check) =>
            Effect.all([check, check], { concurrency: "unbounded" }).pipe(
              Effect.andThen(Deferred.succeed(finished, undefined)),
            ),
        });
        yield* Deferred.await(finished);
        assert.strictEqual((yield* Ref.get(calls)) - before, 1);
      }),
    ).pipe(Effect.provide(layerAlwaysRunTest)),
  );

  it.effect("keeps one preparation beyond the old budgets and accepts its late success", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const finish = yield* Deferred.make<void>();
        const calls = yield* Ref.make(0);
        const provider = yield* makeManagedServerProvider({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: () => false,
          initialSnapshot: () =>
            Effect.succeed({ ...initialSnapshot, installed: null, status: "checking" as const }),
          checkProvider: Ref.update(calls, (n) => n + 1).pipe(
            Effect.andThen(Deferred.succeed(entered, undefined)),
            Effect.andThen(Deferred.await(finish)),
            Effect.as(refreshedSnapshot),
          ),
          refreshInterval: "1 hour",
        });
        yield* Deferred.await(entered);
        const first = yield* provider.startRefresh();
        const second = yield* provider.startRefresh();
        assert.strictEqual(first.operation?.id, second.operation?.id);
        yield* TestClock.adjust("61 seconds");
        assert.strictEqual((yield* provider.getSnapshot).status, "checking");
        assert.strictEqual(yield* Ref.get(calls), 1);
        const nextCompleted = yield* provider.streamChanges.pipe(
          Stream.filter((snapshot) => snapshot.operation?.state === "completed"),
          Stream.take(1),
          Stream.runCollect,
          Effect.forkChild({ startImmediately: true }),
        );
        yield* Deferred.succeed(finish, undefined);
        const ready = (yield* Fiber.join(nextCompleted))[0]!;
        assert.strictEqual(ready.status, "ready");
        assert.strictEqual(ready.operation?.state, "completed");
        assert.strictEqual(yield* Ref.get(calls), 1);
      }),
    ).pipe(Effect.provide(layerAlwaysRunTest)),
  );

  it.effect(
    "cancels owned preparation, skips periodic restart and permits explicit reconnect",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>();
          const released = yield* Deferred.make<void>();
          const finish = yield* Deferred.make<void>();
          const calls = yield* Ref.make(0);
          const provider = yield* makeManagedServerProvider({
            resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
            getSettings: Effect.succeed({ enabled: true }),
            streamSettings: Stream.empty,
            haveSettingsChanged: () => false,
            initialSnapshot: () =>
              Effect.succeed({ ...initialSnapshot, installed: null, status: "checking" as const }),
            checkProvider: Ref.update(calls, (n) => n + 1).pipe(
              Effect.andThen(Deferred.succeed(entered, undefined)),
              Effect.andThen(Deferred.await(finish)),
              Effect.as(refreshedSnapshot),
              Effect.ensuring(Deferred.succeed(released, undefined)),
            ),
            refreshInterval: "1 minute",
          });
          yield* Deferred.await(entered);
          const pending = yield* provider.getSnapshot;
          assert.isDefined(pending.operation);
          yield* provider.cancelRefresh(pending.operation!.id);
          yield* Deferred.await(released);
          assert.strictEqual((yield* provider.getSnapshot).status, "cancelled");
          yield* TestClock.adjust("2 minutes");
          assert.strictEqual(yield* Ref.get(calls), 1);
          yield* provider.startRefresh();
          yield* Deferred.succeed(finish, undefined);
          assert.strictEqual((yield* provider.refresh).status, "ready");
          assert.strictEqual(yield* Ref.get(calls), 2);
        }),
      ).pipe(Effect.provide(layerAlwaysRunTest)),
  );

  it.effect("publishes readiness while metadata is pending and cancellation keeps readiness", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const ready = yield* Deferred.make<void>();
        const provider = yield* makeManagedServerProvider({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: () => false,
          initialSnapshot: () =>
            Effect.succeed({ ...initialSnapshot, installed: null, status: "checking" as const }),
          checkProvider: reportProviderProgress({
            installed: true,
            status: "ready",
            metadata: { models: { state: "loading" } },
          }).pipe(Effect.andThen(Deferred.succeed(ready, undefined)), Effect.andThen(Effect.never)),
          refreshInterval: "1 hour",
        });
        yield* Deferred.await(ready);
        const snapshot = yield* provider.getSnapshot;
        assert.strictEqual(snapshot.status, "ready");
        assert.strictEqual(snapshot.metadata?.models?.state, "loading");
        yield* provider.cancelRefresh(snapshot.operation!.id);
        assert.strictEqual((yield* provider.getSnapshot).status, "ready");
        assert.strictEqual((yield* provider.getSnapshot).operation?.state, "cancelled");
      }),
    ).pipe(Effect.provide(layerAlwaysRunTest)),
  );
  it.effect(
    "rereads installer metadata before explicit refresh while background checks stay cached",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const latestVersion = yield* Ref.make("1.0.0");
          const published = yield* Queue.unbounded<ServerProvider>();
          const resolveMaintenance = yield* makeCachedProviderMaintenanceResolution(
            Ref.get(latestVersion).pipe(
              Effect.map((version) => ({ ...maintenanceCapabilities, latestVersion: version })),
            ),
          );
          const provider = yield* makeManagedServerProvider<TestSettings>({
            resolveMaintenance,
            getSettings: Effect.succeed({ enabled: true }),
            streamSettings: Stream.empty,
            haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
            initialSnapshot: () => Effect.succeed(initialSnapshot),
            checkProvider: Effect.gen(function* () {
              const capabilities = yield* resolveMaintenance();
              return {
                ...refreshedSnapshot,
                versionAdvisory: createProviderVersionAdvisory({
                  driver: refreshedSnapshot.driver,
                  currentVersion: refreshedSnapshot.version,
                  latestVersion: capabilities.latestVersion ?? null,
                  maintenanceCapabilities: capabilities,
                }),
              };
            }),
            enrichSnapshot: ({ snapshot }) => Queue.offer(published, snapshot).pipe(Effect.asVoid),
            refreshInterval: "1 minute",
          });
          assert.strictEqual((yield* Queue.take(published)).versionAdvisory?.status, "current");

          yield* Ref.set(latestVersion, "2.0.0");
          yield* TestClock.adjust("1 minute");
          assert.strictEqual(
            (yield* Queue.take(published)).versionAdvisory?.latestVersion,
            "1.0.0",
          );

          const refreshed = yield* provider.refresh;
          assert.strictEqual(refreshed.versionAdvisory?.latestVersion, "2.0.0");
          assert.strictEqual(refreshed.versionAdvisory?.status, "behind_latest");
          assert.deepStrictEqual(yield* provider.getSnapshot, refreshed);
        }),
      ).pipe(Effect.provide(Layer.mergeAll(layerAlwaysRunTest, TestClock.layer()))),
  );

  it.effect(
    "runs the initial provider check in the background and streams the refreshed snapshot",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const checkCalls = yield* Ref.make(0);
          const releaseCheck = yield* Deferred.make<void>();
          const checkStarted = yield* Deferred.make<void>();
          const provider = yield* makeManagedServerProvider<TestSettings>({
            resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
            getSettings: Effect.succeed({ enabled: true }),
            streamSettings: Stream.empty,
            haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
            initialSnapshot: () => Effect.succeed(initialSnapshot),
            checkProvider: Ref.update(checkCalls, (count) => count + 1).pipe(
              Effect.andThen(Deferred.succeed(checkStarted, undefined)),
              Effect.flatMap(() => Deferred.await(releaseCheck)),
              Effect.as(refreshedSnapshot),
            ),
            refreshInterval: "1 hour",
          });

          const initial = yield* snapshotContentsEffect(provider);
          assert.deepStrictEqual(initial, initialSnapshot);

          const updatesFiber = yield* Stream.take(snapshotChanges(provider), 1).pipe(
            Stream.runCollect,
            Effect.forkChild({ startImmediately: true }),
          );
          yield* Deferred.await(checkStarted);
          assert.strictEqual(yield* Ref.get(checkCalls), 1);

          yield* Deferred.succeed(releaseCheck, undefined);

          const updates = Array.from(yield* Fiber.join(updatesFiber));
          const latest = yield* snapshotContentsEffect(provider);

          assert.deepStrictEqual(updates, [refreshedSnapshot]);
          assert.deepStrictEqual(latest, refreshedSnapshot);
          assert.strictEqual(yield* Ref.get(checkCalls), 1);
        }),
      ).pipe(Effect.provide(layerAlwaysRunTest)),
  );

  it.effect("does not enrich a disabled provider's snapshot", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let enrichmentCalls = 0;
        const provider = yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: false }),
          streamSettings: Stream.empty,
          haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
          refreshOnInterval: false,
          initialSnapshot: () => Effect.succeed({ ...initialSnapshot, enabled: false }),
          checkProvider: Effect.succeed({ ...refreshedSnapshot, enabled: false }),
          enrichSnapshot: () => {
            enrichmentCalls += 1;
            return Effect.void;
          },
        });

        yield* provider.refresh;

        assert.strictEqual(enrichmentCalls, 0);
      }),
    ).pipe(Effect.provide(layerAlwaysRunTest)),
  );

  it.effect("skips periodic provider refreshes without foreground provider-status demand", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const checkCalls = yield* Ref.make(0);
        const initialCheckDone = yield* Deferred.make<void>();
        yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
          initialSnapshot: () => Effect.succeed(initialSnapshot),
          checkProvider: Ref.updateAndGet(checkCalls, (count) => count + 1).pipe(
            Effect.tap((count) =>
              count === 1
                ? Deferred.succeed(initialCheckDone, undefined).pipe(Effect.ignore)
                : Effect.void,
            ),
            Effect.as(refreshedSnapshot),
          ),
          refreshInterval: "1 second",
        });

        yield* Deferred.await(initialCheckDone);
        yield* TestClock.adjust("1 second");
        yield* Effect.yieldNow;

        assert.strictEqual(yield* Ref.get(checkCalls), 1);
      }),
    ).pipe(Effect.provide(Layer.mergeAll(layerNeverRunTest, TestClock.layer()))),
  );

  it.effect("skips periodic checks while disabled and resumes them once enabled", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const settingsRef = yield* Ref.make<TestSettings>({ enabled: false });
        const settingsChanges = yield* PubSub.unbounded<TestSettings>();
        const checkCalls = yield* Ref.make(0);
        const releaseInitialCheck = yield* Deferred.make<void>();
        const updates = yield* Queue.unbounded<ServerProvider>();
        const provider = yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Ref.get(settingsRef),
          streamSettings: Stream.fromPubSub(settingsChanges),
          haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
          initialSnapshot: () => Effect.succeed({ ...initialSnapshot, enabled: false }),
          checkProvider: Ref.updateAndGet(checkCalls, (count) => count + 1).pipe(
            Effect.tap((count) =>
              count === 1 ? Deferred.await(releaseInitialCheck) : Effect.void,
            ),
            Effect.andThen(Ref.get(settingsRef)),
            Effect.map(({ enabled }) => ({ ...refreshedSnapshot, enabled })),
          ),
          refreshInterval: "5 minutes",
        });
        yield* provider.streamChanges.pipe(
          Stream.filter((snapshot) => snapshot.operation?.state !== "running"),
          Stream.runForEach((snapshot) => Queue.offer(updates, snapshot)),
          Effect.forkScoped,
        );
        yield* Effect.yieldNow;
        yield* Deferred.succeed(releaseInitialCheck, undefined);
        yield* Queue.take(updates);

        yield* TestClock.adjust("5 minutes");
        yield* TestClock.adjust("5 minutes");
        yield* Effect.yieldNow;
        assert.strictEqual(yield* Ref.get(checkCalls), 1);
        assert.strictEqual(yield* Queue.size(updates), 0);

        yield* provider.refresh;
        yield* Queue.take(updates);
        assert.strictEqual(yield* Ref.get(checkCalls), 2);

        yield* Ref.set(settingsRef, { enabled: true });
        yield* PubSub.publish(settingsChanges, { enabled: true });
        assert.strictEqual((yield* Queue.take(updates)).enabled, true);
        assert.strictEqual(yield* Ref.get(checkCalls), 3);

        yield* TestClock.adjust("5 minutes");
        yield* Queue.take(updates);
        assert.strictEqual(yield* Ref.get(checkCalls), 4);
      }),
    ).pipe(Effect.provide(Layer.mergeAll(layerAlwaysRunTest, TestClock.layer()))),
  );

  it.effect("disables periodic provider refreshes when the explicit interval is zero", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const checkCalls = yield* Ref.make(0);
        const initialCheckDone = yield* Deferred.make<void>();
        yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
          initialSnapshot: () => Effect.succeed(initialSnapshot),
          checkProvider: Ref.updateAndGet(checkCalls, (count) => count + 1).pipe(
            Effect.tap(() => Deferred.succeed(initialCheckDone, undefined).pipe(Effect.ignore)),
            Effect.as(refreshedSnapshot),
          ),
          refreshInterval: 0,
        });

        yield* Deferred.await(initialCheckDone);
        yield* TestClock.adjust("5 minutes");
        yield* Effect.yieldNow;

        assert.strictEqual(yield* Ref.get(checkCalls), 1);
      }),
    ).pipe(Effect.provide(Layer.mergeAll(layerAlwaysRunTest, TestClock.layer()))),
  );

  it.effect("keeps manual refresh when interval refresh is disabled", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const checkCalls = yield* Ref.make(0);
        const initialCheckDone = yield* Deferred.make<void>();
        const provider = yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
          initialSnapshot: () => Effect.succeed(initialSnapshot),
          checkProvider: Ref.updateAndGet(checkCalls, (count) => count + 1).pipe(
            Effect.tap((count) =>
              count === 1
                ? Deferred.succeed(initialCheckDone, undefined).pipe(Effect.ignore)
                : Effect.void,
            ),
            Effect.as(refreshedSnapshot),
          ),
          refreshInterval: "1 second",
          refreshOnInterval: false,
        });

        yield* Deferred.await(initialCheckDone);
        yield* TestClock.adjust("5 minutes");
        yield* Effect.yieldNow;
        assert.strictEqual(yield* Ref.get(checkCalls), 1);

        yield* provider.refresh;
        assert.strictEqual(yield* Ref.get(checkCalls), 2);
      }),
    ).pipe(Effect.provide(Layer.mergeAll(layerAlwaysRunTest, TestClock.layer()))),
  );

  it.effect("wakes a sleeping provider refresh loop when its interval changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const initialServerSettings = {
          ...DEFAULT_SERVER_SETTINGS,
          providerHealthRefreshInterval: Duration.hours(1),
        };
        const serverSettingsRef = yield* Ref.make(initialServerSettings);
        const serverSettingsChanges = yield* PubSub.unbounded<typeof initialServerSettings>();
        const hostSettings: ProviderHost.ProviderHost["Service"]["settings"] = {
          get: Ref.get(serverSettingsRef),
          withSnapshot: (use) => Ref.get(serverSettingsRef).pipe(Effect.flatMap(use)),
          changes: Stream.empty,
          subscribe: PubSub.subscribe(serverSettingsChanges).pipe(
            Effect.map((subscription) => Stream.fromSubscription(subscription)),
          ),
        };
        const checkCalls = yield* Ref.make(0);
        const initialCheckDone = yield* Deferred.make<void>();
        const periodicCheckDone = yield* Deferred.make<void>();

        yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
          initialSnapshot: () => Effect.succeed(initialSnapshot),
          checkProvider: Ref.updateAndGet(checkCalls, (count) => count + 1).pipe(
            Effect.tap((count) =>
              count === 1
                ? Deferred.succeed(initialCheckDone, undefined).pipe(Effect.ignore)
                : Deferred.succeed(periodicCheckDone, undefined).pipe(Effect.ignore),
            ),
            Effect.as(refreshedSnapshot),
          ),
        }).pipe(
          Effect.provide(layerProviderHost({ runBackgroundWork: true, settings: hostSettings })),
        );

        yield* Deferred.await(initialCheckDone);
        const nextServerSettings = {
          ...initialServerSettings,
          providerHealthRefreshInterval: Duration.seconds(1),
        };
        yield* Ref.set(serverSettingsRef, nextServerSettings);
        yield* PubSub.publish(serverSettingsChanges, nextServerSettings);
        yield* Effect.yieldNow;

        yield* TestClock.adjust("999 millis");
        assert.strictEqual(yield* Ref.get(checkCalls), 1);
        yield* TestClock.adjust("1 millis");
        yield* Deferred.await(periodicCheckDone);
        assert.strictEqual(yield* Ref.get(checkCalls), 2);
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("reruns the provider check when streamed settings change", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const settingsRef = yield* Ref.make<TestSettings>({ enabled: true });
        const settingsChanges = yield* PubSub.unbounded<TestSettings>();
        const checkCalls = yield* Ref.make(0);
        const releaseInitialCheck = yield* Deferred.make<void>();
        const releaseSettingsCheck = yield* Deferred.make<void>();
        const provider = yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Ref.get(settingsRef),
          streamSettings: Stream.fromPubSub(settingsChanges),
          haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
          initialSnapshot: () => Effect.succeed(initialSnapshot),
          checkProvider: Ref.updateAndGet(checkCalls, (count) => count + 1).pipe(
            Effect.flatMap((count) =>
              count === 1
                ? Deferred.await(releaseInitialCheck).pipe(Effect.as(refreshedSnapshot))
                : Deferred.await(releaseSettingsCheck).pipe(Effect.as(refreshedSnapshotSecond)),
            ),
          ),
          refreshInterval: "1 hour",
        });

        const updatesFiber = yield* Stream.take(snapshotChanges(provider), 2).pipe(
          Stream.runCollect,
          Effect.forkChild({ startImmediately: true }),
        );
        yield* Effect.yieldNow;

        yield* Deferred.succeed(releaseInitialCheck, undefined);
        yield* Ref.set(settingsRef, { enabled: false });
        yield* PubSub.publish(settingsChanges, { enabled: false });
        yield* Deferred.succeed(releaseSettingsCheck, undefined);

        const updates = Array.from(yield* Fiber.join(updatesFiber));
        const latest = yield* snapshotContentsEffect(provider);

        assert.deepStrictEqual(updates, [refreshedSnapshot, refreshedSnapshotSecond]);
        assert.deepStrictEqual(latest, refreshedSnapshotSecond);
        assert.strictEqual(yield* Ref.get(checkCalls), 2);
      }),
    ).pipe(Effect.provide(layerAlwaysRunTest)),
  );

  it.effect("can update settings and disable periodic checks without probing again", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const settingsChanges = yield* PubSub.unbounded<TestSettings>();
        const checkCalls = yield* Ref.make(0);
        const initialCheckDone = yield* Deferred.make<void>();
        const enrichmentCalls = yield* Ref.make(0);
        const settingsEnriched = yield* Deferred.make<void>();
        yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.fromPubSub(settingsChanges),
          haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
          checkProviderOnSettingsChange: () => false,
          refreshOnInterval: false,
          initialSnapshot: () => Effect.succeed(initialSnapshot),
          checkProvider: Ref.updateAndGet(checkCalls, (count) => count + 1).pipe(
            Effect.tap(() => Deferred.succeed(initialCheckDone, undefined).pipe(Effect.ignore)),
            Effect.as(refreshedSnapshot),
          ),
          enrichSnapshot: ({ settings }) =>
            Ref.update(enrichmentCalls, (count) => count + 1).pipe(
              Effect.andThen(
                settings.enabled ? Effect.void : Deferred.succeed(settingsEnriched, undefined),
              ),
            ),
          refreshInterval: "1 second",
        });

        yield* Deferred.await(initialCheckDone);
        yield* PubSub.publish(settingsChanges, { enabled: false });
        yield* Effect.yieldNow;
        yield* TestClock.adjust("1 second");
        yield* Effect.yieldNow;

        assert.strictEqual(yield* Ref.get(checkCalls), 1);
        yield* Deferred.await(settingsEnriched);
        assert.isAtLeast(yield* Ref.get(enrichmentCalls), 1);
      }),
    ).pipe(Effect.provide(Layer.mergeAll(layerAlwaysRunTest, TestClock.layer()))),
  );

  it.effect("streams supplemental snapshot updates after the base provider check completes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const releaseEnrichment = yield* Deferred.make<void>();
        const releaseCheck = yield* Deferred.make<void>();
        const provider = yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
          initialSnapshot: () => Effect.succeed(initialSnapshot),
          checkProvider: Deferred.await(releaseCheck).pipe(Effect.as(refreshedSnapshot)),
          enrichSnapshot: ({ publishSnapshot }) =>
            Deferred.await(releaseEnrichment).pipe(
              Effect.flatMap(() => publishSnapshot(enrichedSnapshot)),
            ),
          refreshInterval: "1 hour",
        });

        const updatesFiber = yield* Stream.take(snapshotChanges(provider), 2).pipe(
          Stream.runCollect,
          Effect.forkChild({ startImmediately: true }),
        );
        yield* Effect.yieldNow;

        yield* Deferred.succeed(releaseCheck, undefined);

        yield* Deferred.succeed(releaseEnrichment, undefined);

        const updates = Array.from(yield* Fiber.join(updatesFiber));
        const latest = yield* snapshotContentsEffect(provider);

        assert.deepStrictEqual(updates, [refreshedSnapshot, enrichedSnapshot]);
        assert.deepStrictEqual(latest, enrichedSnapshot);
      }),
    ).pipe(Effect.provide(layerAlwaysRunTest)),
  );

  it.effect("ignores stale enrichment callbacks after a newer refresh advances generation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const publishCallbacks: Array<(snapshot: ServerProvider) => Effect.Effect<void>> = [];
        const refreshCount = yield* Ref.make(0);
        const firstCallbackReady = yield* Deferred.make<void>();
        const secondCallbackReady = yield* Deferred.make<void>();
        const allowFirstRefresh = yield* Deferred.make<void>();
        const provider = yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
          initialSnapshot: () => Effect.succeed(initialSnapshot),
          checkProvider: Ref.updateAndGet(refreshCount, (count) => count + 1).pipe(
            Effect.flatMap((count) =>
              count === 1
                ? Deferred.await(allowFirstRefresh).pipe(Effect.as(refreshedSnapshot))
                : Effect.succeed(refreshedSnapshotSecond),
            ),
          ),
          enrichSnapshot: ({ publishSnapshot }) =>
            Effect.gen(function* () {
              publishCallbacks.push(publishSnapshot);
              if (publishCallbacks.length === 1) {
                yield* Deferred.succeed(firstCallbackReady, undefined).pipe(Effect.ignore);
              } else if (publishCallbacks.length === 2) {
                yield* Deferred.succeed(secondCallbackReady, undefined).pipe(Effect.ignore);
              }
            }),
          refreshInterval: "1 hour",
        });

        const updatesFiber = yield* Stream.take(snapshotChanges(provider), 3).pipe(
          Stream.runCollect,
          Effect.forkChild({ startImmediately: true }),
        );
        yield* Effect.yieldNow;

        yield* Deferred.succeed(allowFirstRefresh, undefined);
        yield* Deferred.await(firstCallbackReady);

        yield* provider.refresh;
        yield* Deferred.await(secondCallbackReady);

        yield* publishCallbacks[0]!(enrichedSnapshot);
        yield* publishCallbacks[1]!(enrichedSnapshotSecond);

        const updates = Array.from(yield* Fiber.join(updatesFiber));
        const latest = yield* snapshotContentsEffect(provider);

        assert.deepStrictEqual(updates, [
          refreshedSnapshot,
          refreshedSnapshotSecond,
          enrichedSnapshotSecond,
        ]);
        assert.deepStrictEqual(latest, enrichedSnapshotSecond);
      }),
    ).pipe(Effect.provide(layerAlwaysRunTest)),
  );

  it.effect("applies runtime usage updates onto the published snapshot", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const provider = yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
          initialSnapshot: () => Effect.succeed(initialSnapshot),
          checkProvider: Effect.succeed({
            ...refreshedSnapshot,
            usageLimits: {
              checkedAt: "2026-04-10T00:00:01.000Z",
              windows: [
                { id: "five_hour", kind: "session", label: "Session", usedPercent: 10 },
                {
                  id: "seven_day",
                  kind: "weekly",
                  label: "Weekly",
                  usedPercent: 20,
                  resetsAt: "2026-04-17T00:00:00.000Z",
                },
              ],
            },
          } satisfies ServerProvider),
          refreshInterval: "1 hour",
        });
        yield* Stream.take(snapshotChanges(provider), 1).pipe(Stream.runDrain);

        const updatesFiber = yield* Stream.take(snapshotChanges(provider), 1).pipe(
          Stream.runCollect,
          Effect.forkChild({ startImmediately: true }),
        );
        yield* Effect.yieldNow;

        yield* provider.applyUsageLimits({
          checkedAt: "2026-04-10T00:05:00.000Z",
          windows: [{ id: "seven_day", kind: "weekly", label: "Weekly", usedPercent: 25 }],
        });
        yield* provider.applyUsageLimits({ checkedAt: "2026-04-10T00:06:00.000Z", windows: [] });

        const [update] = Array.from(yield* Fiber.join(updatesFiber));
        assert.deepStrictEqual(update?.usageLimits, {
          checkedAt: "2026-04-10T00:05:00.000Z",
          windows: [
            { id: "five_hour", kind: "session", label: "Session", usedPercent: 10 },
            {
              id: "seven_day",
              kind: "weekly",
              label: "Weekly",
              usedPercent: 25,
              resetsAt: "2026-04-17T00:00:00.000Z",
            },
          ],
        });
        assert.deepStrictEqual(yield* snapshotContentsEffect(provider), update);
      }),
    ).pipe(Effect.provide(layerAlwaysRunTest)),
  );

  it.effect("keeps live usage windows across a failed probe and a stale enrichment", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const releaseEnrichment = yield* Deferred.make<void>();
        const refreshCount = yield* Ref.make(0);
        const probedLimits = {
          checkedAt: "2026-04-10T00:00:01.000Z",
          windows: [{ id: "primary", kind: "session", label: "Session", usedPercent: 10 }],
        } as const;
        const provider = yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
          initialSnapshot: () => Effect.succeed(initialSnapshot),
          checkProvider: Ref.updateAndGet(refreshCount, (count) => count + 1).pipe(
            Effect.map((count) =>
              count === 1
                ? {
                    ...refreshedSnapshot,
                    auth: { ...refreshedSnapshot.auth, workspaceId: "ws-a" },
                    usageLimits: probedLimits,
                  }
                : {
                    ...refreshedSnapshotSecond,
                    ...(count === 3
                      ? { auth: { ...refreshedSnapshotSecond.auth, workspaceId: "ws-b" } }
                      : {}),
                    usageLimits: {
                      checkedAt: "2026-04-10T00:00:03.000Z",
                      windows: [],
                      unavailable: { reason: "probeFailed" },
                    },
                  },
            ),
          ),
          enrichSnapshot: ({ snapshot, publishSnapshot }) =>
            Deferred.await(releaseEnrichment).pipe(
              Effect.flatMap(() =>
                publishSnapshot({
                  ...enrichedSnapshot,
                  ...snapshot,
                  models: enrichedSnapshot.models,
                }),
              ),
            ),
          refreshInterval: "1 hour",
        });
        yield* Stream.take(snapshotChanges(provider), 1).pipe(Stream.runDrain);

        const liveWindow = {
          id: "primary",
          kind: "session",
          label: "Session",
          usedPercent: 60,
        } as const;
        yield* provider.applyUsageLimits({
          checkedAt: "2026-04-10T00:00:02.000Z",
          windows: [liveWindow],
        });

        yield* Deferred.succeed(releaseEnrichment, undefined);
        const enriched = yield* Stream.take(snapshotChanges(provider), 1).pipe(
          Stream.runCollect,
          Effect.map((chunk) => Array.from(chunk)[0]!),
        );
        assert.deepStrictEqual(enriched.models, enrichedSnapshot.models);
        assert.deepStrictEqual(enriched.usageLimits?.windows, [liveWindow]);

        const refreshed = yield* provider.refresh;
        assert.strictEqual(refreshed.message, refreshedSnapshotSecond.message);
        assert.deepStrictEqual(refreshed.usageLimits?.windows, [liveWindow]);
        assert.strictEqual(refreshed.auth.workspaceId, "ws-a");

        const switched = yield* provider.refresh;
        assert.strictEqual(switched.auth.workspaceId, "ws-b");
        assert.strictEqual(switched.usageLimits?.unavailable?.reason, "probeFailed");
      }),
    ).pipe(Effect.provide(layerAlwaysRunTest)),
  );

  it.effect("keeps sparse usage unavailable after probe failure until a full probe recovers", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const failedLimits = {
          checkedAt: "2026-04-10T00:00:01.000Z",
          windows: [],
          unavailable: { reason: "probeFailed", message: "Usage probe timed out." },
        } as const;
        const probeSnapshot = yield* Ref.make<ServerProvider>({
          ...refreshedSnapshot,
          usageLimits: failedLimits,
        });
        const provider = yield* makeManagedServerProvider<TestSettings>({
          resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
          getSettings: Effect.succeed({ enabled: true }),
          streamSettings: Stream.empty,
          haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
          initialSnapshot: () => Effect.succeed(initialSnapshot),
          checkProvider: Ref.get(probeSnapshot),
          refreshOnInterval: false,
        });
        yield* provider.refresh;

        const weekly = {
          id: "seven_day",
          kind: "weekly",
          label: "Weekly",
          usedPercent: 20,
        } as const;
        yield* provider.applyUsageLimits({
          checkedAt: "2026-04-10T00:00:02.000Z",
          windows: [weekly],
        });
        const partial = yield* provider.getSnapshot;
        assert.deepStrictEqual(partial.usageLimits, {
          checkedAt: "2026-04-10T00:00:02.000Z",
          windows: [weekly],
          unavailable: failedLimits.unavailable,
        });
        yield* provider.applyUsageLimits({
          checkedAt: "2026-04-10T00:00:03.000Z",
          windows: [{ ...weekly }],
        });
        assert.strictEqual(yield* provider.getSnapshot, partial);
        assert.deepStrictEqual((yield* provider.refresh).usageLimits, failedLimits);

        const completeLimits = {
          checkedAt: "2026-04-10T00:00:04.000Z",
          windows: [
            { id: "five_hour", kind: "session", label: "Session", usedPercent: 10 },
            { ...weekly, usedPercent: 25 },
          ],
        } as const;
        yield* Ref.set(probeSnapshot, { ...refreshedSnapshot, usageLimits: completeLimits });
        assert.deepStrictEqual((yield* provider.refresh).usageLimits, completeLimits);
      }),
    ).pipe(Effect.provide(layerAlwaysRunTest)),
  );
});
