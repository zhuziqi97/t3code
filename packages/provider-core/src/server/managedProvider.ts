import {
  DEFAULT_PROVIDER_HEALTH_REFRESH_INTERVAL,
  type ServerProvider,
  ServerSettingsError,
} from "@t3tools/contracts";
import { resolveServerBackgroundActivitySettings } from "@t3tools/shared/backgroundActivitySettings";
import * as Duration from "effect/Duration";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Context from "effect/Context";
import * as Exit from "effect/Exit";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Semaphore from "effect/Semaphore";

import * as ProviderHost from "./ProviderHost.ts";
import { applyUsageLimitsUpdate, resolveUsageLimitsAfterProbe } from "./usageLimits.ts";
import type { ManagedServerProvider } from "./snapshot.ts";
import { randomUuidV4 } from "./randomUuid.ts";

type SnapshotProgress = Partial<
  Pick<
    ServerProvider,
    | "installed"
    | "version"
    | "status"
    | "auth"
    | "models"
    | "skills"
    | "slashCommands"
    | "usageLimits"
    | "metadata"
  >
>;

class ProviderSnapshotProgress extends Context.Service<
  ProviderSnapshotProgress,
  {
    readonly publish: (patch: SnapshotProgress) => Effect.Effect<void>;
  }
>()("@t3tools/provider-core/server/managedProvider/ProviderSnapshotProgress") {}

/** Progress belongs to the managed instance; standalone probes need no publisher. */
export const reportProviderProgress = (patch: SnapshotProgress) =>
  Effect.serviceOption(ProviderSnapshotProgress).pipe(
    Effect.flatMap((publisher) =>
      publisher._tag === "Some" ? publisher.value.publish(patch) : Effect.void,
    ),
  );

interface ProviderSnapshotState {
  readonly snapshot: ServerProvider;
  readonly enrichmentGeneration: number;
}

function withUsageLimits(
  snapshot: ServerProvider,
  usageLimits: ServerProvider["usageLimits"],
): ServerProvider {
  if (snapshot.usageLimits === usageLimits) {
    return snapshot;
  }
  const { usageLimits: _previous, ...rest } = snapshot;
  return usageLimits ? { ...rest, usageLimits } : rest;
}

export const makeManagedServerProvider = Effect.fn("makeManagedServerProvider")(function* <
  Settings,
>(input: {
  readonly resolveMaintenance: ManagedServerProvider["resolveMaintenance"];
  readonly getSettings: Effect.Effect<Settings, ServerSettingsError>;
  readonly streamSettings: Stream.Stream<Settings>;
  readonly haveSettingsChanged: (previous: Settings, next: Settings) => boolean;
  readonly initialSnapshot: (settings: Settings) => Effect.Effect<ServerProvider>;
  readonly checkProvider: Effect.Effect<ServerProvider, ServerSettingsError>;
  readonly enrichSnapshot?: (input: {
    readonly settings: Settings;
    readonly snapshot: ServerProvider;
    readonly getSnapshot: Effect.Effect<ServerProvider>;
    readonly publishSnapshot: (snapshot: ServerProvider) => Effect.Effect<void>;
  }) => Effect.Effect<void>;
  readonly refreshInterval?: Duration.Input;
  readonly refreshOnInterval?: boolean;
  readonly checkProviderOnSettingsChange?: (previous: Settings, next: Settings) => boolean;
}): Effect.fn.Return<
  ManagedServerProvider,
  ServerSettingsError,
  Scope.Scope | ProviderHost.ProviderHost
> {
  const host = yield* ProviderHost.ProviderHost;
  const refreshSemaphore = yield* Semaphore.make(1);
  const changesPubSub = yield* Effect.acquireRelease(
    PubSub.unbounded<ServerProvider>(),
    PubSub.shutdown,
  );
  const initialSettings = yield* input.getSettings;
  const initialSnapshot = yield* input.initialSnapshot(initialSettings);
  const snapshotStateRef = yield* Ref.make<ProviderSnapshotState>({
    snapshot: initialSnapshot,
    enrichmentGeneration: 0,
  });
  const settingsRef = yield* Ref.make(initialSettings);
  const enrichmentFiberRef = yield* Ref.make<Fiber.Fiber<void, unknown> | null>(null);
  const scope = yield* Effect.scope;
  const activeRefresh = yield* Ref.make<{
    readonly id: string;
    readonly completion: Deferred.Deferred<ServerProvider>;
    readonly fiber: Fiber.Fiber<void, never>;
  } | null>(null);
  const initialPreparationCancelled = yield* Ref.make(false);

  const publishProgress = (patch: SnapshotProgress) =>
    Effect.gen(function* () {
      const next = yield* Ref.updateAndGet(snapshotStateRef, (state) => ({
        ...state,
        snapshot: {
          ...state.snapshot,
          ...patch,
          metadata: { ...state.snapshot.metadata, ...patch.metadata },
        },
      }));
      yield* PubSub.publish(changesPubSub, next.snapshot);
    });

  const publishEnrichedSnapshot = Effect.fn("publishEnrichedSnapshot")(function* (
    generation: number,
    nextSnapshot: ServerProvider,
  ) {
    const snapshotToPublish = yield* Ref.modify(snapshotStateRef, (state) => {
      if (state.enrichmentGeneration !== generation) {
        return [null, state] as const;
      }
      // Enrichment derives from the snapshot it was handed; a runtime usage
      // update that landed since must not be reverted by it.
      const { operation: _previousOperation, ...enriched } = nextSnapshot;
      const merged = withUsageLimits(
        {
          ...enriched,
          ...(state.snapshot.operation ? { operation: state.snapshot.operation } : {}),
        },
        state.snapshot.usageLimits,
      );
      if (Equal.equals(state.snapshot, merged)) {
        return [null, state] as const;
      }
      return [merged, { ...state, snapshot: merged }] as const;
    });
    if (snapshotToPublish === null) {
      return;
    }
    yield* PubSub.publish(changesPubSub, snapshotToPublish);
  });

  const restartSnapshotEnrichment = Effect.fn("restartSnapshotEnrichment")(function* (
    settings: Settings,
    snapshot: ServerProvider,
    generation: number,
  ) {
    const previousFiber = yield* Ref.getAndSet(enrichmentFiberRef, null);
    if (previousFiber) {
      yield* Fiber.interrupt(previousFiber).pipe(Effect.ignore);
    }

    // Enrichment resolves binaries and package-manager state, which a disabled
    // provider has no use for.
    if (!input.enrichSnapshot || !snapshot.enabled) {
      return;
    }

    const fiber = yield* input
      .enrichSnapshot({
        settings,
        snapshot,
        getSnapshot: Ref.get(snapshotStateRef).pipe(Effect.map((state) => state.snapshot)),
        publishSnapshot: (nextSnapshot) => publishEnrichedSnapshot(generation, nextSnapshot),
      })
      .pipe(Effect.ignoreCause({ log: true }), Effect.forkIn(scope));

    yield* Ref.set(enrichmentFiberRef, fiber);
  });

  const applySnapshotBase = Effect.fn("applySnapshot")(function* (
    nextSettings: Settings,
    options?: { readonly forceRefresh?: boolean },
  ) {
    const forceRefresh = options?.forceRefresh === true;
    const previousSettings = yield* Ref.get(settingsRef);
    if (!forceRefresh && !input.haveSettingsChanged(previousSettings, nextSettings)) {
      yield* Ref.set(settingsRef, nextSettings);
      return yield* Ref.get(snapshotStateRef).pipe(Effect.map((state) => state.snapshot));
    }

    if (
      !forceRefresh &&
      input.checkProviderOnSettingsChange?.(previousSettings, nextSettings) === false
    ) {
      const state = yield* Ref.get(snapshotStateRef);
      const nextGeneration = state.enrichmentGeneration + 1;
      yield* Ref.set(snapshotStateRef, {
        ...state,
        enrichmentGeneration: nextGeneration,
      });
      yield* Ref.set(settingsRef, nextSettings);
      yield* restartSnapshotEnrichment(nextSettings, state.snapshot, nextGeneration);
      return state.snapshot;
    }

    const probedSnapshot = yield* input.checkProvider.pipe(
      Effect.provideService(ProviderSnapshotProgress, { publish: publishProgress }),
    );
    const { snapshot: nextSnapshot, generation: nextGeneration } = yield* Ref.modify(
      snapshotStateRef,
      (state) => {
        const generation = input.enrichSnapshot
          ? state.enrichmentGeneration + 1
          : state.enrichmentGeneration;
        // A failed read keeps the last good limits only for the same account,
        // and they keep the workspace they were read for.
        const previous = state.snapshot.auth;
        const differs = (a: string | undefined, b: string | undefined) =>
          a !== undefined && b !== undefined && a !== b;
        // Limits read without a workspace cannot be attributed to a new one.
        const switchedAccount =
          differs(probedSnapshot.auth.email?.toLowerCase(), previous.email?.toLowerCase()) ||
          (probedSnapshot.auth.workspaceId !== undefined &&
            probedSnapshot.auth.workspaceId !== previous.workspaceId);
        const usageLimits = switchedAccount
          ? probedSnapshot.usageLimits
          : resolveUsageLimitsAfterProbe({
              published: state.snapshot.usageLimits,
              probed: probedSnapshot.usageLimits,
            });
        const workspaceId =
          usageLimits === probedSnapshot.usageLimits ? undefined : state.snapshot.auth.workspaceId;
        const enrichedProbe = {
          ...probedSnapshot,
          ...(state.snapshot.operation ? { operation: state.snapshot.operation } : {}),
          metadata: { ...state.snapshot.metadata, ...probedSnapshot.metadata },
        };
        const snapshot = withUsageLimits(
          workspaceId && !probedSnapshot.auth.workspaceId
            ? { ...enrichedProbe, auth: { ...probedSnapshot.auth, workspaceId } }
            : enrichedProbe,
          usageLimits,
        );
        return [
          { snapshot, generation },
          { snapshot, enrichmentGeneration: generation },
        ] as const;
      },
    );
    yield* Ref.set(settingsRef, nextSettings);
    yield* PubSub.publish(changesPubSub, nextSnapshot);
    yield* restartSnapshotEnrichment(nextSettings, nextSnapshot, nextGeneration);
    return nextSnapshot;
  });
  const startSnapshot = (nextSettings: Settings, options?: { readonly forceRefresh?: boolean }) =>
    refreshSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const active = yield* Ref.get(activeRefresh);
        if (active) return active.completion;
        const completion = yield* Deferred.make<ServerProvider>();
        const id = yield* randomUuidV4;
        const launched = yield* Deferred.make<void>();
        const startedAt = DateTime.formatIso(yield* DateTime.now);
        yield* Ref.set(initialPreparationCancelled, false);
        const state = yield* Ref.updateAndGet(snapshotStateRef, (current) => ({
          ...current,
          snapshot: {
            ...current.snapshot,
            operation: { id, state: "running" as const, startedAt },
            ...(current.snapshot.installed === null || current.snapshot.status === "cancelled"
              ? { status: "checking" as const }
              : {}),
          },
        }));
        yield* PubSub.publish(changesPubSub, state.snapshot);
        const fiber = yield* Deferred.await(launched).pipe(
          Effect.andThen(applySnapshotBase(nextSettings, options)),
          Effect.onExit((exit) =>
            Effect.gen(function* () {
              const next = yield* Ref.updateAndGet(snapshotStateRef, (current) => {
                const cancelled = Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause);
                const completed = Exit.isSuccess(exit) && current.snapshot.status !== "error";
                return {
                  ...current,
                  enrichmentGeneration: cancelled
                    ? current.enrichmentGeneration + 1
                    : current.enrichmentGeneration,
                  snapshot: {
                    ...current.snapshot,
                    operation: {
                      id,
                      startedAt,
                      state: cancelled
                        ? ("cancelled" as const)
                        : completed
                          ? ("completed" as const)
                          : ("failed" as const),
                    },
                    ...(cancelled && current.snapshot.metadata
                      ? {
                          metadata: Object.fromEntries(
                            Object.entries(current.snapshot.metadata).map(([key, value]) => [
                              key,
                              value?.state === "loading" ? { state: "cancelled" as const } : value,
                            ]),
                          ),
                        }
                      : {}),
                    ...(!completed && (!cancelled || current.snapshot.status === "checking")
                      ? { status: cancelled ? ("cancelled" as const) : ("error" as const) }
                      : {}),
                  },
                };
              });
              if (next.snapshot.status === "cancelled")
                yield* Ref.set(initialPreparationCancelled, true);
              yield* Ref.set(activeRefresh, null);
              yield* PubSub.publish(changesPubSub, next.snapshot);
              yield* Deferred.succeed(completion, next.snapshot);
            }),
          ),
          Effect.ignoreCause({ log: true }),
          Effect.forkIn(scope),
        );
        yield* Ref.set(activeRefresh, { id, completion, fiber });
        yield* Deferred.succeed(launched, undefined);
        return completion;
      }),
    );

  const applySnapshot = (
    settings: Settings,
    options?: { readonly forceRefresh?: boolean },
  ): Effect.Effect<ServerProvider, ServerSettingsError> =>
    Effect.gen(function* () {
      if (!options?.forceRefresh) {
        const active = yield* Ref.get(activeRefresh);
        const previous = yield* Ref.get(settingsRef);
        if (active && input.haveSettingsChanged(previous, settings)) {
          yield* Deferred.await(active.completion);
          return yield* applySnapshot(settings, options);
        }
        if (
          !input.haveSettingsChanged(previous, settings) ||
          input.checkProviderOnSettingsChange?.(previous, settings) === false
        )
          return yield* applySnapshotBase(settings, options);
      }
      return yield* startSnapshot(settings, options).pipe(Effect.flatMap(Deferred.await));
    });

  /**
   * Runtime usage updates arrive between probes. They patch only
   * `usageLimits` on whatever snapshot is published and leave the enrichment
   * generation alone, so an in-flight enrichment still lands.
   */
  const applyUsageLimits: ManagedServerProvider["applyUsageLimits"] = (update) =>
    Effect.gen(function* () {
      const snapshotToPublish = yield* Ref.modify(snapshotStateRef, (state) => {
        const usageLimits = applyUsageLimitsUpdate({
          previous: state.snapshot.usageLimits,
          update,
          checkedAt: update.checkedAt,
        });
        // `applyUsageLimitsUpdate` hands back the same object when nothing
        // moved, which is the common case for Codex's per-tick notification.
        if (usageLimits === state.snapshot.usageLimits) {
          return [null, state] as const;
        }
        const snapshot = withUsageLimits(state.snapshot, usageLimits);
        return [snapshot, { ...state, snapshot }] as const;
      });
      if (snapshotToPublish !== null) {
        yield* PubSub.publish(changesPubSub, snapshotToPublish);
      }
    });

  const refreshSnapshot = Effect.fn("refreshSnapshot")(function* () {
    const nextSettings = yield* input.getSettings;
    return yield* applySnapshot(nextSettings, { forceRefresh: true });
  });

  const hasProviderStatusDemand = Effect.gen(function* () {
    const state = yield* Ref.get(snapshotStateRef);
    const instanceId = state.snapshot.instanceId;
    const [genericDemand, instanceDemand] = yield* Effect.all([
      host.shouldRunBackgroundWork({ type: "provider-status" }),
      host.shouldRunBackgroundWork({ type: "provider-status", instanceId }),
    ]);
    return genericDemand || instanceDemand;
  });

  const getRefreshInterval =
    input.refreshInterval !== undefined
      ? Effect.succeed(input.refreshInterval)
      : host.settings.get.pipe(
          Effect.map(
            (settings) =>
              resolveServerBackgroundActivitySettings(settings).providerHealthRefreshInterval,
          ),
          Effect.orElseSucceed(() => DEFAULT_PROVIDER_HEALTH_REFRESH_INTERVAL),
        );

  const refreshIntervalChanges = yield* Queue.sliding<void>(1);
  if (input.refreshInterval === undefined) {
    const serverSettingsChanges = yield* host.settings.subscribe;
    yield* serverSettingsChanges.pipe(
      Stream.map((settings) =>
        Duration.toMillis(
          resolveServerBackgroundActivitySettings(settings).providerHealthRefreshInterval,
        ),
      ),
      Stream.changes,
      Stream.runForEach(() => Queue.offer(refreshIntervalChanges, undefined).pipe(Effect.asVoid)),
      Effect.forkScoped,
    );
  }

  yield* Stream.runForEach(input.streamSettings, (nextSettings) =>
    Effect.asVoid(applySnapshot(nextSettings)),
  ).pipe(Effect.forkScoped);

  yield* Effect.forever(
    getRefreshInterval.pipe(
      Effect.flatMap((refreshInterval) =>
        // @effect-diagnostics-next-line raceFirstWithSleepToTimeout:off - races the interval against a settings-change signal, not a timeout
        Effect.raceFirst(
          Effect.sleep(
            Duration.toMillis(Duration.fromInputUnsafe(refreshInterval)) <= 0
              ? "60 seconds"
              : refreshInterval,
          ).pipe(Effect.as(true)),
          Queue.take(refreshIntervalChanges).pipe(Effect.as(false)),
        ).pipe(
          Effect.flatMap((intervalElapsed) =>
            input.refreshOnInterval !== false &&
            intervalElapsed &&
            Duration.toMillis(Duration.fromInputUnsafe(refreshInterval)) > 0
              ? hasProviderStatusDemand.pipe(
                  Effect.flatMap((shouldRefresh) =>
                    shouldRefresh
                      ? Ref.get(initialPreparationCancelled).pipe(
                          Effect.flatMap((cancelled) =>
                            cancelled ? Effect.void : refreshSnapshot().pipe(Effect.asVoid),
                          ),
                        )
                      : Effect.void,
                  ),
                )
              : Effect.void,
          ),
        ),
      ),
      Effect.ignoreCause({ log: true }),
    ),
  ).pipe(Effect.forkScoped);

  yield* applySnapshot(initialSettings, { forceRefresh: true }).pipe(
    Effect.ignoreCause({ log: true }),
    Effect.forkScoped,
  );

  return {
    resolveMaintenance: input.resolveMaintenance,
    getSnapshot: Ref.get(snapshotStateRef).pipe(Effect.map((state) => state.snapshot)),
    refresh: refreshSnapshot().pipe(Effect.tapError(Effect.logError), Effect.orDie),
    startRefresh: input.getSettings.pipe(
      Effect.flatMap((settings) => startSnapshot(settings, { forceRefresh: true })),
      Effect.andThen(Ref.get(snapshotStateRef)),
      Effect.map((state) => state.snapshot),
      Effect.orDie,
    ),
    cancelRefresh: (operationId) =>
      Ref.get(activeRefresh).pipe(
        Effect.flatMap((active) =>
          active?.id === operationId
            ? Fiber.interrupt(active.fiber).pipe(Effect.asVoid)
            : Effect.void,
        ),
      ),
    applyUsageLimits,
    get streamChanges() {
      return Stream.fromPubSub(changesPubSub);
    },
  } satisfies ManagedServerProvider;
});
