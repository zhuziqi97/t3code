import { AgentScope } from "@t3tools/shared/AgentScope";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import {
  ModelSelection,
  OrchestrationV2DomainEvent,
  OrchestrationV2ProviderSession,
  type OrchestrationV2ProviderThread,
  OrchestrationV2RuntimeRequest,
  ProviderInstanceId,
  ProviderSessionId,
  ThreadId,
  type ProviderThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FiberSet from "effect/FiberSet";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { normalizeModelMetricLabel } from "../observability/Attributes.ts";
import {
  providerSessionsTotal,
  providerTurnDuration,
  providerTurnsTotal,
  withMetrics,
} from "../observability/Metrics.ts";
import { ProviderWorkspaceMissingError } from "../provider/Errors.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ConveneMcp from "../convene/ConveneMcp.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import * as EventSink from "./EventSink.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProviderEventIngestor from "./ProviderEventIngestor.ts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_MAX_IDLE_PIN_MS = 4 * 60 * 60 * 1000;
const RELEASE_SCOPE_CLOSE_TIMEOUT_MS = 30 * 1000;

const busyTurnPrefix = (providerThreadId: ProviderThreadId) => `${providerThreadId}#`;
/** The identity a turn's start and its `turn.terminal` share. */
const busyTurnKey = (providerThreadId: ProviderThreadId, runOrdinal: number) =>
  `${busyTurnPrefix(providerThreadId)}${runOrdinal}`;
const UNLOAD_THREAD_TIMEOUT_MS = 10 * 1000;

export const ProviderSessionReleaseReason = Schema.Literals([
  "idle_timeout",
  "runtime_error",
  "manual_shutdown",
  "server_shutdown",
]);
export type ProviderSessionReleaseReason = typeof ProviderSessionReleaseReason.Type;

/**
 * ProviderSessionManager owns live session residency: open sessions, idle release,
 * explicit shutdown, and release-on-runtime-failure.
 *
 * It intentionally does not resurrect persisted sessions. Process-loss recovery
 * terminalizes provider-bound work and retires non-replayable effects; a later
 * user command or durable replay-safe operation opens a session lazily.
 */
export class ProviderSessionOpenError extends Schema.TaggedError<ProviderSessionOpenError>()(
  "ProviderSessionOpenError",
  {
    instanceId: ProviderInstanceId,
    providerSessionId: ProviderSessionId,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to open provider instance ${this.instanceId} session ${this.providerSessionId}.`;
  }
}

export class ProviderSessionLookupError extends Schema.TaggedError<ProviderSessionLookupError>()(
  "ProviderSessionLookupError",
  {
    providerSessionId: ProviderSessionId,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to look up provider session ${this.providerSessionId}.`;
  }
}

export class ProviderSessionCloseError extends Schema.TaggedError<ProviderSessionCloseError>()(
  "ProviderSessionCloseError",
  {
    providerSessionId: ProviderSessionId,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to close provider session ${this.providerSessionId}.`;
  }
}

export class ProviderSessionReleaseError extends Schema.TaggedError<ProviderSessionReleaseError>()(
  "ProviderSessionReleaseError",
  {
    providerSessionId: ProviderSessionId,
    reason: ProviderSessionReleaseReason,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to release provider session ${this.providerSessionId}.`;
  }
}

export class ProviderSessionActivityError extends Schema.TaggedError<ProviderSessionActivityError>()(
  "ProviderSessionActivityError",
  {
    providerSessionId: ProviderSessionId,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to update provider session activity for ${this.providerSessionId}.`;
  }
}

const isProviderSessionActivityError = Schema.is(ProviderSessionActivityError);
const isProviderSessionOpenError = Schema.is(ProviderSessionOpenError);

export const ProviderSessionManagerV2Error = Schema.Union([
  ProviderSessionOpenError,
  ProviderWorkspaceMissingError,
  ProviderSessionLookupError,
  ProviderSessionCloseError,
  ProviderSessionReleaseError,
  ProviderSessionActivityError,
]);
export type ProviderSessionManagerV2Error = typeof ProviderSessionManagerV2Error.Type;

export interface ProviderSessionManagerV2Shape {
  readonly shutdown: Effect.Effect<void>;
  readonly open: (input: {
    readonly threadId: ThreadId;
    readonly providerSessionId: ProviderSessionId;
    readonly modelSelection: ModelSelection;
    readonly runtimePolicy: ProviderAdapter.ProviderAdapterV2RuntimePolicy;
    readonly resumeFromSession?: OrchestrationV2ProviderSession;
    readonly initialNativeThreadId?: string;
    readonly initialProviderItemIdentityVersion?: 2;
  }) => Effect.Effect<
    ProviderAdapter.ProviderAdapterV2SessionRuntime,
    ProviderSessionManagerV2Error
  >;
  readonly get: (
    providerSessionId: ProviderSessionId,
  ) => Effect.Effect<
    Option.Option<ProviderAdapter.ProviderAdapterV2SessionRuntime>,
    ProviderSessionManagerV2Error
  >;
  /** Whether the session's runtime is running. Unlike `get`, not activity. */
  readonly isLive: (providerSessionId: ProviderSessionId) => Effect.Effect<boolean>;
  readonly close: (
    providerSessionId: ProviderSessionId,
  ) => Effect.Effect<void, ProviderSessionManagerV2Error>;
  /** Refuses new opens while draining this instance's pending and live sessions. */
  readonly closeInstance: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<void, ProviderSessionManagerV2Error>;
  readonly release: (input: {
    readonly providerSessionId: ProviderSessionId;
    readonly reason: ProviderSessionReleaseReason;
    readonly detail?: string;
  }) => Effect.Effect<void, ProviderSessionManagerV2Error>;
  readonly detach: (input: {
    readonly providerSessionId: ProviderSessionId;
    readonly threadId: ThreadId;
    readonly detail?: string;
    /**
     * True for terminal detaches (thread archived or deleted): the thread's
     * MCP credentials are revoked immediately instead of surviving for a
     * potential re-attach.
     */
    readonly revokeMcpCredential?: boolean;
  }) => Effect.Effect<void, ProviderSessionManagerV2Error>;
}

export class ProviderSessionManagerV2 extends Context.Service<
  ProviderSessionManagerV2,
  ProviderSessionManagerV2Shape
>()("t3/orchestration-v2/ProviderSessionManager/ProviderSessionManagerV2") {}

interface LiveSessionEntry {
  readonly attachedThreadIds: ReadonlySet<ThreadId>;
  readonly loadedProviderThreadKeyByThread: ReadonlyMap<ThreadId, string>;
  /**
   * MCP credential session id issued for each attached thread. Revocation on
   * detach/release is scoped to these ids so tearing down a superseded
   * session cannot revoke a replacement session's credential for the same
   * thread (the workspace-handoff sequence opens the replacement before the
   * outbox executes the old session's detach).
   */
  readonly mcpCredentialIdByThread: ReadonlyMap<ThreadId, string>;
  readonly supportsMultipleProviderThreads: boolean;
  readonly runtime: ProviderAdapter.ProviderAdapterV2SessionRuntime;
  readonly exposedRuntime: ProviderAdapter.ProviderAdapterV2SessionRuntime;
  readonly eventSubscribers: Ref.Ref<
    ReadonlyMap<number, Queue.Queue<ProviderSessionEventSignal, Cause.Done>>
  >;
  readonly requestEventPermit: Semaphore.Semaphore;
  readonly scope: Scope.Closeable;
  readonly idleGeneration: number;
  /**
   * Turns this session is running, keyed by `busyTurnKey`. A turn's start adds
   * it and its `turn.terminal` (or a failed start) removes it, so a turn can
   * only clear itself and the session is idle when the set is empty.
   */
  readonly busyTurns: ReadonlySet<string>;
  readonly lastActivityAtMs: number;
  readonly idleFiber: Fiber.Fiber<void, never> | null;
  /** Set when idle release is deferred for pending background work; bounds total deferral. */
  readonly pinnedSinceMs: number | null;
  /**
   * Shared runtimes only: the provider thread each attached app thread last
   * started a turn on, and the timer that unloads it once it has been idle
   * for `idleTimeoutMs`.
   */
  readonly idleThreadUnloads: ReadonlyMap<ThreadId, IdleThreadUnload>;
}

interface IdleThreadUnload {
  readonly providerThread: OrchestrationV2ProviderThread;
  readonly generation: number;
  readonly fiber: Fiber.Fiber<void, never> | null;
}

type ProviderSessionEventSignal =
  | { readonly type: "event"; readonly event: ProviderAdapter.ProviderAdapterV2Event }
  | {
      readonly type: "failure";
      readonly cause: Cause.Cause<ProviderAdapter.ProviderAdapterV2Error>;
    };

export interface ProviderSessionManagerV2LayerOptions {
  readonly idleTimeoutMs?: number;
  /** Cap on how long idle release may be deferred for pending background work. */
  readonly maxIdlePinMs?: number;
  /** Test replay harnesses can omit T3's MCP server from provider protocol fixtures. */
  readonly configureMcp?: boolean;
}

function releaseStatusFor(
  reason: ProviderSessionReleaseReason,
): OrchestrationV2ProviderSession["status"] {
  return reason === "runtime_error" ? "error" : "stopped";
}

function releasedRuntimeRequestStatusFor(
  reason: ProviderSessionReleaseReason,
): OrchestrationV2RuntimeRequest["status"] {
  return reason === "manual_shutdown" || reason === "server_shutdown" ? "cancelled" : "expired";
}

function sessionKey(providerSessionId: ProviderSessionId): string {
  return String(providerSessionId);
}

/**
 * Runtime requests with no provider turn belong to the live session itself.
 * Their node and transcript item are runless too, so they bypass the normal
 * per-run subscriber and are persisted by the session event pump.
 */
function sessionScopedRuntimeRequestThreadId(
  event: ProviderAdapter.ProviderAdapterV2Event,
): ThreadId | undefined {
  switch (event.type) {
    case "runtime_request.updated":
      return event.runtimeRequest.providerTurnId === null ? event.threadId : undefined;
    case "node.updated":
      return event.node.runId === null && event.node.runtimeRequestId !== null
        ? event.node.threadId
        : undefined;
    case "turn_item.updated":
      return event.turnItem.runId === null &&
        (event.turnItem.type === "approval_request" || event.turnItem.type === "user_input_request")
        ? event.turnItem.threadId
        : undefined;
    default:
      return undefined;
  }
}

function providerThreadRuntimeKey(
  providerThread: Parameters<
    ProviderAdapter.ProviderAdapterV2SessionRuntime["resumeThread"]
  >[0]["providerThread"],
): string {
  const nativeThreadRef = providerThread.nativeThreadRef;
  return nativeThreadRef === null
    ? String(providerThread.id)
    : `${nativeThreadRef.driver}:${nativeThreadRef.nativeId}`;
}

function providerThreadLoadKey(input: {
  readonly providerThread: Parameters<
    ProviderAdapter.ProviderAdapterV2SessionRuntime["resumeThread"]
  >[0]["providerThread"];
  readonly modelSelection?: ModelSelection;
  readonly runtimePolicy?: ProviderAdapter.ProviderAdapterV2RuntimePolicy;
}): string {
  return JSON.stringify({
    providerThread: providerThreadRuntimeKey(input.providerThread),
    modelSelection: input.modelSelection ?? null,
    runtimePolicy: input.runtimePolicy ?? null,
  });
}

export const layerWithOptions = (
  options: ProviderSessionManagerV2LayerOptions = {},
): Layer.Layer<
  ProviderSessionManagerV2,
  never,
  | EventSink.EventSinkV2
  | FileSystem.FileSystem
  | IdAllocator.IdAllocatorV2
  | McpProviderSessions.McpProviderSessions
  | McpSessionRegistry.McpSessionRegistry
  | ProjectionStore.ProjectionStoreV2
  | ProviderEventIngestor.ProviderEventIngestorV2
  | ProviderAdapterRegistry.ProviderAdapterRegistryV2
> =>
  Layer.effect(
    ProviderSessionManagerV2,
    Effect.gen(function* () {
      const registry = yield* ProviderAdapterRegistry.ProviderAdapterRegistryV2;
      const fileSystem = yield* FileSystem.FileSystem;
      const mcpSessionRegistry = yield* McpSessionRegistry.McpSessionRegistry;
      const mcpSessions = yield* McpProviderSessions.McpProviderSessions;
      /**
       * Optional so the many focused tests that assemble this layer by hand do
       * not each need a settings stub; the production composition always
       * provides it. When present, an unreadable settings file withholds
       * browser access rather than granting it — an explicit "off" silently
       * becoming "on" would violate the user's stated choice, whereas the
       * reverse costs an agent one toolset and is visible immediately (#7083).
       */
      const serverSettings = yield* Effect.serviceOption(ServerSettings.ServerSettingsService);
      const projectService = yield* Effect.serviceOption(ProjectService.ProjectService);
      const eventSink = yield* EventSink.EventSinkV2;
      const idAllocator = yield* IdAllocator.IdAllocatorV2;
      const providerEventIngestor = yield* ProviderEventIngestor.ProviderEventIngestorV2;
      const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
      const agentScope = yield* AgentScope;
      const agentAccessSettings = Effect.fn("ProviderSessionManagerV2.agentAccessSettings")(
        function* (threadId: ThreadId) {
          if (Option.isNone(serverSettings)) return { browser: true, device: false };
          return yield* Effect.gen(function* () {
            const settings = yield* serverSettings.value.getSettings;
            const thread = yield* projectionStore.getThread(threadId);
            const entries = Object.values(settings.projectSettingsOverrides);
            const browserOverridden = entries.some(
              (entry) => entry.enableAgentBrowserAccess !== undefined,
            );
            const deviceOverridden = entries.some(
              (entry) => entry.enableAgentDeviceAccess !== undefined,
            );
            if (browserOverridden || deviceOverridden) {
              const project = Option.isSome(projectService)
                ? yield* projectService.value.getById(thread.projectId)
                : Option.none();
              if (Option.isNone(project))
                return {
                  browser: browserOverridden ? false : settings.enableAgentBrowserAccess,
                  device: deviceOverridden ? false : settings.enableAgentDeviceAccess,
                };
            }
            const effective = resolveProjectSettings(settings, thread.projectId).settings;
            return {
              browser: effective.enableAgentBrowserAccess,
              device: effective.enableAgentDeviceAccess,
            };
          }).pipe(
            Effect.catch((cause) =>
              Effect.logWarning(
                "Could not resolve agent access; withholding browser and device tools.",
                { threadId, cause },
              ).pipe(Effect.as({ browser: false, device: false })),
            ),
          );
        },
      );
      const layerScope = yield* Effect.scope;
      // Ctrl+C, or a stop that signals the whole process group, reaches the
      // provider CLIs with the server. They report their own background work
      // stopped before shutdown captures restart continuations, so provider
      // events after the signal are dropped; restart recovery owns that state.
      const shutdownSignal = { received: false };
      const onShutdownSignal = () => {
        shutdownSignal.received = true;
      };
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          process.on("SIGINT", onShutdownSignal);
          process.on("SIGTERM", onShutdownSignal);
        }),
        () =>
          Effect.sync(() => {
            process.off("SIGINT", onShutdownSignal);
            process.off("SIGTERM", onShutdownSignal);
          }),
      );
      const conveneMcp = yield* Effect.serviceOption(ConveneMcp.ConveneMcp);
      const sessions = yield* Ref.make(new Map<string, LiveSessionEntry>());
      // One retry per released entry, so a later release with the same id
      // cannot drop cleanup for threads only the earlier session served.
      const releaseRecordRetries = yield* FiberSet.make();
      const nextSubscriberId = yield* Ref.make(0);
      const sessionOpen = yield* KeyedLock.make<ProviderSessionId>();
      // Orders a thread's attach against a detach unloading it on the same session.
      const threadAttachment = yield* KeyedLock.make<string>();
      const threadAttachmentKey = (input: {
        readonly providerSessionId: ProviderSessionId;
        readonly threadId: ThreadId;
      }) => `${input.providerSessionId}\u0000${input.threadId}`;
      const idleTimeoutMs = Math.max(1, options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS);
      const maxIdlePinMs = Math.max(0, options.maxIdlePinMs ?? DEFAULT_MAX_IDLE_PIN_MS);
      // An acquisition reserves its exact credential until a runtime commits
      // ownership, or the acquisition's finalizer retires an unused credential.
      const mcpCredentialReservations = new Map<string, number>();
      const mcpReservationKey = (threadId: ThreadId, mcpCredentialId: string) =>
        `${threadId}\0${mcpCredentialId}`;
      const reserveMcpCredential = (threadId: ThreadId, mcpCredentialId: string) => {
        const key = mcpReservationKey(threadId, mcpCredentialId);
        mcpCredentialReservations.set(key, (mcpCredentialReservations.get(key) ?? 0) + 1);
      };
      const dropMcpCredentialReservation = (threadId: ThreadId, mcpCredentialId: string) => {
        const key = mcpReservationKey(threadId, mcpCredentialId);
        const count = mcpCredentialReservations.get(key) ?? 0;
        if (count <= 1) {
          mcpCredentialReservations.delete(key);
        } else {
          mcpCredentialReservations.set(key, count - 1);
        }
      };
      const isMcpCredentialReserved = (threadId: ThreadId, mcpCredentialId: string) =>
        (mcpCredentialReservations.get(mcpReservationKey(threadId, mcpCredentialId)) ?? 0) > 0;
      /** Revoke the native credential and its project leases as one local operation.
       * A rotation retires the thread's old credentials; a session finalizer
       * supplies its exact id so a newer credential/configuration survives.
       */
      const clearMcpSession = (threadId: ThreadId, mcpCredentialId?: string) =>
        Effect.gen(function* () {
          if (mcpCredentialId === undefined) {
            yield* mcpSessionRegistry.revokeThread(threadId);
            yield* mcpSessions.clear(threadId);
          } else {
            yield* mcpSessionRegistry.revokeProviderSession(mcpCredentialId);
            if ((yield* mcpSessions.read(threadId))?.providerSessionId === mcpCredentialId)
              yield* mcpSessions.clear(threadId);
          }
          if (Option.isSome(conveneMcp)) yield* conveneMcp.value.release(threadId, mcpCredentialId);
        }).pipe(Effect.uninterruptible);

      // Only an owner of this exact credential can keep it alive. A thread
      // attached elsewhere with a newer credential does not own the old one.
      const clearUnusedMcpSession = (threadId: ThreadId, mcpCredentialId: string) =>
        Ref.get(sessions).pipe(
          Effect.flatMap((current) =>
            isMcpCredentialReserved(threadId, mcpCredentialId) ||
            Array.from(current.values()).some(
              (entry) => entry.mcpCredentialIdByThread.get(threadId) === mcpCredentialId,
            )
              ? Effect.void
              : clearMcpSession(threadId, mcpCredentialId),
          ),
        );

      const mcpPrepareLock = yield* KeyedLock.make<ThreadId>();
      /** The reservation covers lookup, project preparation and runtime adoption.
       * Every exit drops it and checks actual owners, whether fresh or reused.
       */
      const withMcpSession = <A, E, R>(
        threadId: ThreadId,
        providerInstanceId: ProviderInstanceId,
        use: (mcpCredentialId: string | undefined) => Effect.Effect<A, E, R>,
      ) =>
        Effect.uninterruptibleMask((restore) => {
          let reservedId: string | undefined;
          const releaseReservation = Effect.suspend(() => {
            const credentialId = reservedId;
            if (credentialId === undefined) return Effect.void;
            reservedId = undefined;
            dropMcpCredentialReservation(threadId, credentialId);
            return clearUnusedMcpSession(threadId, credentialId);
          });
          const reserve = (credentialId: string) => {
            reserveMcpCredential(threadId, credentialId);
            reservedId = credentialId;
            return credentialId;
          };
          const prepare =
            options.configureMcp === false
              ? mcpSessions.clear(threadId).pipe(Effect.as(undefined))
              : mcpPrepareLock.withLock(
                  threadId,
                  Effect.uninterruptibleMask((restorePrepare) =>
                    Effect.gen(function* () {
                      const { browser: browserToolsAvailable, device: deviceToolsAvailable } =
                        yield* restorePrepare(agentAccessSettings(threadId));
                      const capabilities = new Set<
                        import("../mcp/McpInvocationContext.ts").McpCapability
                      >(["orchestration", "worktree", "pull-requests"]);
                      if (browserToolsAvailable) capabilities.add("preview");
                      if (deviceToolsAvailable) capabilities.add("device");
                      const existing = yield* mcpSessions.read(threadId);
                      if (existing !== undefined) {
                        // Provider processes retain their configured token across
                        // detach/re-attach. Reserve before cancellable validation.
                        reserve(existing.providerSessionId);
                        const resolved = yield* restorePrepare(
                          mcpSessionRegistry.resolve(
                            existing.authorizationHeader.replace(/^Bearer\s+/, ""),
                          ),
                        );
                        if (
                          resolved !== undefined &&
                          resolved.thread.threadId === threadId &&
                          resolved.thread.providerInstanceId === providerInstanceId &&
                          resolved.capabilities.has("preview") === browserToolsAvailable &&
                          resolved.capabilities.has("device") === deviceToolsAvailable
                        )
                          return existing.providerSessionId;
                        yield* releaseReservation;
                      }
                      // Rotation retires both kinds of authorization before the
                      // current config or a runtime's old record is overwritten.
                      yield* clearMcpSession(threadId);
                      const credential = yield* mcpSessionRegistry.issue({
                        threadId,
                        providerInstanceId,
                        browserToolsAvailable,
                        capabilities,
                      });
                      yield* mcpSessions.set(credential.config);
                      return reserve(credential.config.providerSessionId);
                    }),
                  ),
                );
          return restore(
            Effect.gen(function* () {
              const credentialId = yield* prepare;
              if (Option.isSome(conveneMcp) && credentialId !== undefined) {
                const additionalServers = yield* conveneMcp.value.prepare(threadId, credentialId);
                yield* Effect.gen(function* () {
                  const current = yield* mcpSessions.read(threadId);
                  if (current?.providerSessionId === credentialId)
                    yield* mcpSessions.set({ ...current, additionalServers });
                }).pipe(Effect.uninterruptible);
              }
              return yield* use(credentialId);
            }),
          ).pipe(Effect.ensuring(releaseReservation));
        });

      const publishToSubscribers = (
        subscribers: Ref.Ref<
          ReadonlyMap<number, Queue.Queue<ProviderSessionEventSignal, Cause.Done>>
        >,
        signal: ProviderSessionEventSignal,
      ) =>
        Ref.get(subscribers).pipe(
          Effect.flatMap((current) =>
            Effect.forEach(current.values(), (queue) => Queue.offer(queue, signal), {
              discard: true,
            }),
          ),
        );

      const failSubscribers = (entry: LiveSessionEntry, detail: string) =>
        Effect.gen(function* () {
          const error = new ProviderAdapter.ProviderAdapterEventStreamError({
            driver: entry.runtime.driver,
            providerSessionId: entry.runtime.providerSessionId,
            cause: detail,
          });
          const subscribers = yield* Ref.getAndSet(entry.eventSubscribers, new Map());
          yield* Effect.forEach(
            subscribers.values(),
            (queue) =>
              Queue.offer(queue, {
                type: "failure",
                cause: Cause.fail(error),
              }),
            { discard: true },
          );
        });

      // Server shutdown interrupts subscribers rather than ending them: a
      // cleanly ended stream without a terminal fails its run, while an
      // interrupted one leaves run settlement to restart recovery.
      const interruptSubscribers = (entry: LiveSessionEntry) =>
        Effect.gen(function* () {
          const subscribers = yield* Ref.getAndSet(entry.eventSubscribers, new Map());
          yield* Effect.forEach(
            subscribers.values(),
            (queue) => Queue.clear(queue).pipe(Effect.andThen(Queue.interrupt(queue))),
            { discard: true },
          );
        });

      // Preserve already-published terminal events while ending subscriptions.
      // Server shutdown intentionally clears them; a provider-announced Stop
      // must let consumers drain them before the stream completes.
      const endSubscribers = (entry: LiveSessionEntry) =>
        Effect.gen(function* () {
          const subscribers = yield* Ref.getAndSet(entry.eventSubscribers, new Map());
          yield* Effect.forEach(subscribers.values(), (queue) => Queue.end(queue), {
            discard: true,
          });
        });

      const cancelIdleFiber = (fiber: Fiber.Fiber<void, never> | null) =>
        fiber === null ? Effect.void : Fiber.interrupt(fiber).pipe(Effect.ignore);

      const writeProviderSessionEvents = (input: {
        readonly runtime: ProviderAdapter.ProviderAdapterV2SessionRuntime;
        readonly threadIds: Iterable<ThreadId>;
        readonly type: "provider-session.attached" | "provider-session.updated";
        readonly payload: OrchestrationV2ProviderSession;
      }) =>
        Effect.gen(function* () {
          const now = yield* DateTime.now;
          const events = yield* Effect.forEach(input.threadIds, (threadId) =>
            Effect.gen(function* () {
              return {
                id: yield* idAllocator.allocate.event({
                  threadId,
                  providerSessionId: input.runtime.providerSessionId,
                }),
                type: input.type,
                threadId,
                driver: input.runtime.driver,
                providerInstanceId: input.runtime.instanceId,
                occurredAt: now,
                payload: input.payload,
              } satisfies OrchestrationV2DomainEvent;
            }),
          );
          if (events.length > 0) {
            yield* eventSink.write({ events });
          }
        });

      const writeReleasedSessionEvents = (input: {
        readonly entry: LiveSessionEntry;
        readonly reason: ProviderSessionReleaseReason;
        readonly detail?: string;
      }) =>
        Effect.gen(function* () {
          const now = yield* DateTime.now;
          const payload: OrchestrationV2ProviderSession = {
            ...input.entry.runtime.providerSession,
            status: releaseStatusFor(input.reason),
            updatedAt: now,
            lastError:
              input.reason === "runtime_error"
                ? (input.detail ?? "Provider runtime failed.")
                : null,
          };
          yield* writeProviderSessionEvents({
            runtime: input.entry.runtime,
            threadIds: input.entry.attachedThreadIds,
            type: "provider-session.updated",
            payload,
          });
        });

      const writeReleasedRuntimeRequestEvents = (input: {
        readonly entry: LiveSessionEntry;
        readonly reason: ProviderSessionReleaseReason;
        /** Requests created later belong to a replacement session with the same id. */
        readonly releasedAt: DateTime.Utc;
      }) =>
        Effect.gen(function* () {
          const providerSessionId = input.entry.runtime.providerSessionId;
          const now = yield* DateTime.now;
          const status = releasedRuntimeRequestStatusFor(input.reason);
          const reason =
            input.reason === "runtime_error"
              ? "Provider session failed before this runtime request was resolved."
              : "Provider session was closed before this runtime request was resolved.";

          const events: Array<OrchestrationV2DomainEvent> = [];
          for (const threadId of input.entry.attachedThreadIds) {
            const projection = yield* projectionStore.getThreadRecords(
              threadId,
              ["runtimeRequests", "nodes", "turnItems"],
              { turnItemTypes: ["approval_request", "user_input_request"] },
            );
            const releasedRequests = projection.runtimeRequests.filter(
              (request) =>
                request.status === "pending" &&
                request.responseCapability.type === "live" &&
                request.responseCapability.providerSessionId === providerSessionId &&
                DateTime.isLessThanOrEqualTo(request.createdAt, input.releasedAt),
            );

            for (const request of releasedRequests) {
              events.push({
                id: yield* idAllocator.allocate.event({
                  threadId,
                  providerSessionId,
                }),
                type: "runtime-request.updated",
                threadId,
                nodeId: request.nodeId,
                driver: input.entry.runtime.driver,
                occurredAt: now,
                payload: {
                  ...request,
                  status,
                  responseCapability: {
                    type: "not_resumable",
                    reason,
                  },
                  resolvedAt: now,
                },
              });

              const requestNode = projection.nodes.find((node) => node.id === request.nodeId);
              if (requestNode !== undefined) {
                events.push({
                  id: yield* idAllocator.allocate.event({
                    threadId,
                    providerSessionId,
                  }),
                  type: "node.updated",
                  threadId,
                  ...(requestNode.runId === null ? {} : { runId: requestNode.runId }),
                  nodeId: requestNode.id,
                  driver: input.entry.runtime.driver,
                  occurredAt: now,
                  payload: {
                    ...requestNode,
                    status: input.reason === "runtime_error" ? "failed" : "cancelled",
                    completedAt: now,
                  },
                });
              }

              const turnItem = projection.turnItems.find(
                (item) =>
                  (item.type === "approval_request" || item.type === "user_input_request") &&
                  item.requestId === request.id,
              );
              if (turnItem !== undefined) {
                events.push({
                  id: yield* idAllocator.allocate.event({
                    threadId,
                    providerSessionId,
                  }),
                  type: "turn-item.updated",
                  threadId,
                  ...(turnItem.runId === null ? {} : { runId: turnItem.runId }),
                  ...(turnItem.nodeId === null ? {} : { nodeId: turnItem.nodeId }),
                  driver: input.entry.runtime.driver,
                  occurredAt: now,
                  payload: {
                    ...turnItem,
                    status: input.reason === "runtime_error" ? "failed" : "cancelled",
                    completedAt: now,
                    updatedAt: now,
                  },
                });
              }
            }
          }

          if (events.length > 0) {
            yield* eventSink.write({ events });
          }
        });

      // Reads the background tasks a released session's process left on its
      // provider threads. Read as soon as the session leaves the live map:
      // after that, a replacement session with the same id can open and report
      // tasks of its own on the same provider threads. Server shutdown keeps
      // rosters, since startup recovery clears them and records the cancelled
      // work. Only runtimes whose tasks end with their process opt in (Claude,
      // Muse). OpenCode's background subagents run on a server shared by its
      // sessions and can outlive this one, so their roster stays.
      const readReleasedBackgroundTasks = (input: {
        readonly entry: LiveSessionEntry;
        readonly reason: ProviderSessionReleaseReason;
        readonly detachedThreadId?: ThreadId;
      }) =>
        Effect.gen(function* () {
          if (
            input.reason === "server_shutdown" ||
            input.entry.runtime.backgroundTasksEndWithProcess !== true
          ) {
            return [];
          }
          const providerSessionId = input.entry.runtime.providerSessionId;
          // A detach that released the session already removed its thread
          // from the attached set.
          const threadIds = new Set(input.entry.attachedThreadIds);
          if (input.detachedThreadId !== undefined) threadIds.add(input.detachedThreadId);
          const released = [];
          for (const threadId of threadIds) {
            const projection = yield* projectionStore.getThreadRecords(threadId, [
              "providerThreads",
            ]);
            for (const providerThread of projection.providerThreads) {
              const tasks = providerThread.pendingBackgroundTasks ?? [];
              if (providerThread.providerSessionId !== providerSessionId || tasks.length === 0) {
                continue;
              }
              released.push({
                threadId,
                providerSessionId,
                providerThreadId: providerThread.id,
                taskIds: new Set(tasks.map((task) => task.taskId)),
              });
            }
          }
          return released;
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("orchestration-v2.provider-session-release-roster-read-failed", {
              providerSessionId: input.entry.runtime.providerSessionId,
              cause,
            }).pipe(Effect.as([])),
          ),
        );
      type ReleasedBackgroundTasks = Effect.Success<
        ReturnType<typeof readReleasedBackgroundTasks>
      >[number];

      // Removes the tasks `readReleasedBackgroundTasks` found from their
      // rosters. Their process is gone, so nothing will report them ending,
      // and a leftover roster keeps the thread Waiting (#15239). Tasks a
      // replacement session reported since are left in place. The write
      // commits only if the stored row still equals what was read, and is
      // retried a few times when a provider update lands in between.
      const writeReleasedBackgroundWorkEvents = (
        released: ReadonlyArray<ReleasedBackgroundTasks>,
      ) =>
        Effect.forEach(
          released,
          ({ threadId, providerSessionId, providerThreadId, taskIds }) =>
            Effect.gen(function* () {
              for (let attempt = 0; attempt < 3; attempt++) {
                const projection = yield* projectionStore.getThreadRecords(threadId, [
                  "providerThreads",
                ]);
                const providerThread = projection.providerThreads.find(
                  (candidate) => candidate.id === providerThreadId,
                );
                const tasks = providerThread?.pendingBackgroundTasks ?? [];
                const remaining = tasks.filter((task) => !taskIds.has(task.taskId));
                if (providerThread === undefined || remaining.length === tasks.length) return;
                const now = yield* DateTime.now;
                const { committed } = yield* eventSink.writeIfProviderThreadUnchanged({
                  expected: providerThread,
                  events: [
                    {
                      id: yield* idAllocator.allocate.event({ threadId, providerSessionId }),
                      type: "provider-thread.updated",
                      threadId,
                      driver: providerThread.driver,
                      providerInstanceId: providerThread.providerInstanceId,
                      occurredAt: now,
                      payload: {
                        ...providerThread,
                        pendingBackgroundTasks: remaining,
                        updatedAt: now,
                      },
                    },
                  ],
                });
                if (committed) return;
              }
              yield* Effect.logWarning(
                "orchestration-v2.provider-session-release-roster-conflict",
                {
                  providerSessionId,
                  providerThreadId,
                },
              );
            }),
          { discard: true },
        );

      // Records a released session as stopped and resolves the live runtime
      // requests and background-task rosters it left. Each write runs even if
      // another fails. Once a replacement session opens with the same id, it
      // owns the session status, so only the requests are settled.
      const writeReleaseRecords = (input: {
        readonly entry: LiveSessionEntry;
        readonly reason: ProviderSessionReleaseReason;
        readonly detail?: string;
        readonly releasedBackgroundTasks: ReadonlyArray<ReleasedBackgroundTasks>;
        readonly releasedAt: DateTime.Utc;
        readonly replaced: boolean;
      }) =>
        Effect.all(
          [
            input.replaced
              ? Effect.succeed(Exit.void)
              : Effect.exit(writeReleasedSessionEvents(input)),
            Effect.exit(
              writeReleasedRuntimeRequestEvents(input).pipe(
                input.entry.requestEventPermit.withPermits(1),
              ),
            ),
            Effect.exit(writeReleasedBackgroundWorkEvents(input.releasedBackgroundTasks)),
          ],
          { concurrency: 1 },
        ).pipe(Effect.flatMap(Exit.asVoidAll));

      // The session already left the live map, so a later release finds
      // nothing to do. Without a retry the UI would keep a ready session and
      // answerable approvals until a server restart. Each attempt holds the
      // session's open lock, so it sees a replacement that opened meanwhile.
      const retryReleaseRecords = (
        input: Omit<Parameters<typeof writeReleaseRecords>[0], "replaced">,
      ) => {
        const providerSessionId = input.entry.runtime.providerSessionId;
        const attempt = Effect.gen(function* () {
          const exit = yield* Effect.exit(
            sessionOpen.withLock(
              providerSessionId,
              Effect.gen(function* () {
                const replaced = (yield* Ref.get(sessions)).has(sessionKey(providerSessionId));
                yield* writeReleaseRecords({ ...input, replaced });
              }),
            ),
          );
          if (Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)) return yield* exit;
          yield* Effect.logWarning("orchestration-v2.provider-session-release-records-failed", {
            providerSessionId,
            cause: exit.cause,
          });
          // A failed SQL commit is a defect, so every failure but interruption
          // is retried.
          return yield* Effect.fail(exit.cause);
        });
        return attempt.pipe(
          Effect.retry({
            schedule: Schedule.exponential("1 second").pipe(
              Schedule.modifyDelay(({ duration }) =>
                Effect.succeed(Duration.min(duration, Duration.seconds(30))),
              ),
            ),
          }),
          Effect.delay("1 second"),
          FiberSet.run(releaseRecordRetries),
        );
      };

      const logReleaseFailure =
        (providerSessionId: ProviderSessionId) =>
        <E, R>(release: Effect.Effect<void, E, R>) =>
          release.pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("orchestration-v2.provider-session-release-failed", {
                providerSessionId,
                cause,
              }),
            ),
          );

      // Removes the live entry and reads the request cleanup cutoff while
      // holding the entry's request permit. A request the event pump is
      // persisting for this runtime lands before the cutoff, and once the
      // entry is gone the pump persists no more for it. A replacement's
      // requests come after its own open.
      const removeLiveEntry = (input: {
        readonly providerSessionId: ProviderSessionId;
        readonly onlyIfIdleGeneration?: number;
      }): Effect.Effect<readonly [Option.Option<LiveSessionEntry>, DateTime.Utc]> =>
        Effect.gen(function* () {
          const key = sessionKey(input.providerSessionId);
          const candidate = (yield* Ref.get(sessions)).get(key);
          if (candidate === undefined) {
            return [Option.none<LiveSessionEntry>(), yield* DateTime.now] as const;
          }
          const removed = yield* Effect.zip(
            Ref.modify(sessions, (current) => {
              const existing = current.get(key);
              if (existing !== candidate) {
                return [existing === undefined ? "gone" : "changed", current] as const;
              }
              if (
                input.onlyIfIdleGeneration !== undefined &&
                (existing.busyTurns.size > 0 ||
                  existing.idleGeneration !== input.onlyIfIdleGeneration)
              ) {
                return ["kept", current] as const;
              }
              const updated = new Map(current);
              updated.delete(key);
              return ["removed", updated] as const;
            }),
            DateTime.now,
          ).pipe(candidate.requestEventPermit.withPermits(1));
          const [outcome, releasedAt] = removed;
          // Another entry took this id while the permit was held; release it instead.
          if (outcome === "changed") return yield* removeLiveEntry(input);
          return [
            outcome === "removed" ? Option.some(candidate) : Option.none<LiveSessionEntry>(),
            releasedAt,
          ] as const;
        });

      // Scope close can wedge on a misbehaving adapter finalizer (e.g. a
      // provider process that never yields its message stream). Time-box it so
      // the caller, and any lock or worker it holds, moves on and leaves a
      // diagnosable trail. A close that finishes late is still logged.
      const closeScopeWithin = (
        scope: Scope.Closeable,
        annotations: { readonly providerSessionId?: ProviderSessionId; readonly reason: string },
      ) =>
        Effect.gen(function* () {
          const closeFiber = yield* Scope.close(scope, Exit.void).pipe(
            Effect.exit,
            Effect.forkDetach({ startImmediately: true }),
          );
          const closeExit = yield* Fiber.join(closeFiber).pipe(
            Effect.timeoutOption(RELEASE_SCOPE_CLOSE_TIMEOUT_MS),
          );
          if (Option.isNone(closeExit)) {
            yield* Effect.logWarning("orchestration-v2.provider-session-scope-close-timeout", {
              ...annotations,
              timeoutMs: RELEASE_SCOPE_CLOSE_TIMEOUT_MS,
            });
            yield* Fiber.join(closeFiber).pipe(
              Effect.flatMap((exit) =>
                Exit.isFailure(exit)
                  ? Effect.logWarning("orchestration-v2.provider-session-scope-close-failed", {
                      ...annotations,
                      cause: exit.cause,
                    })
                  : Effect.logInfo(
                      "orchestration-v2.provider-session-scope-close-completed-late",
                      annotations,
                    ),
              ),
              Effect.forkDetach,
            );
          }
          return closeExit;
        });

      const releaseEntry = (input: {
        readonly providerSessionId: ProviderSessionId;
        readonly reason: ProviderSessionReleaseReason;
        readonly detail?: string;
        /** The thread whose detach released the session; it is no longer attached. */
        readonly detachedThreadId?: ThreadId;
        readonly cancelIdleFiber?: boolean;
        readonly onlyIfIdleGeneration?: number;
        readonly gracefulSubscribers?: boolean;
      }) =>
        Effect.acquireUseRelease(
          removeLiveEntry(input),
          ([entry, releasedAt]) =>
            Option.match(entry, {
              onNone: () => Effect.void,
              onSome: (entry) =>
                Effect.gen(function* () {
                  const releasedBackgroundTasks = yield* readReleasedBackgroundTasks({
                    entry,
                    reason: input.reason,
                    ...(input.detachedThreadId === undefined
                      ? {}
                      : { detachedThreadId: input.detachedThreadId }),
                  });
                  if (input.cancelIdleFiber !== false) {
                    yield* cancelIdleFiber(entry.idleFiber);
                  }
                  if (input.gracefulSubscribers === true) {
                    yield* endSubscribers(entry);
                  } else if (input.reason === "server_shutdown") {
                    yield* interruptSubscribers(entry);
                  } else {
                    yield* failSubscribers(
                      entry,
                      input.detail ?? `Provider session released: ${input.reason}.`,
                    );
                  }
                  const closeExit = yield* closeScopeWithin(entry.scope, {
                    providerSessionId: input.providerSessionId,
                    reason: input.reason,
                  });
                  const records = {
                    entry,
                    reason: input.reason,
                    ...(input.detail === undefined ? {} : { detail: input.detail }),
                    releasedBackgroundTasks,
                    releasedAt,
                  };
                  const recorded = yield* Effect.exit(
                    writeReleaseRecords({ ...records, replaced: false }),
                  );
                  if (Exit.isFailure(recorded)) {
                    yield* retryReleaseRecords(records);
                    return yield* recorded;
                  }
                  if (Option.isSome(closeExit) && Exit.isFailure(closeExit.value)) {
                    return yield* Effect.failCause(closeExit.value.cause);
                  }
                }).pipe(
                  withMetrics({
                    counter: providerSessionsTotal,
                    attributes: {
                      provider: entry.runtime.driver,
                      operation: "release",
                      reason: input.reason,
                    },
                  }),
                ),
            }),
          ([entry]) =>
            Option.match(entry, {
              onNone: () => Effect.void,
              onSome: (entry) =>
                // Revoke every credential this session recorded, including for
                // threads that detached without re-attaching: the provider
                // process is gone. Keep credentials that a live replacement
                // session still holds, since it may reuse the same credential.
                Effect.forEach(
                  entry.mcpCredentialIdByThread,
                  ([threadId, mcpCredentialId]) => clearUnusedMcpSession(threadId, mcpCredentialId),
                  { discard: true },
                ),
            }),
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.fail(
              new ProviderSessionReleaseError({
                providerSessionId: input.providerSessionId,
                reason: input.reason,
                cause,
              }),
            ),
          ),
        );

      // Annotated to break the releaseIfStillIdle <-> scheduleIdleReleaseInternal
      // inference cycle introduced by the pin re-arm below.
      const releaseIfStillIdle = (input: {
        readonly providerSessionId: ProviderSessionId;
        readonly generation: number;
      }): Effect.Effect<void> =>
        Effect.gen(function* () {
          const current = yield* Ref.get(sessions);
          const key = sessionKey(input.providerSessionId);
          const entry = current.get(key);
          if (
            entry === undefined ||
            entry.busyTurns.size > 0 ||
            entry.idleGeneration !== input.generation
          ) {
            return;
          }
          // Capture runtime identity before yielding: a replacement session
          // can reuse the same providerSessionId while this fiber is parked.
          const probedRuntime = entry.runtime;
          const hasPendingWork =
            probedRuntime.hasPendingBackgroundWork === undefined
              ? false
              : yield* probedRuntime.hasPendingBackgroundWork.pipe(
                  Effect.catchCause(() => Effect.succeed(false)),
                );
          if (hasPendingWork) {
            const now = yield* Clock.currentTimeMillis;
            const pinnedSinceMs = entry.pinnedSinceMs ?? now;
            if (now - pinnedSinceMs < maxIdlePinMs) {
              const shouldContinuePin = yield* Ref.modify(sessions, (latest) => {
                const latestEntry = latest.get(key);
                if (
                  latestEntry === undefined ||
                  latestEntry.busyTurns.size > 0 ||
                  latestEntry.idleGeneration !== input.generation ||
                  latestEntry.runtime !== probedRuntime
                ) {
                  return [false, latest] as const;
                }
                const updated = new Map(latest);
                updated.set(key, { ...latestEntry, pinnedSinceMs });
                return [true, updated] as const;
              });
              if (!shouldContinuePin) {
                // Generation or runtime advanced while we probed pending work;
                // the current owner of the entry owns idle release.
                return;
              }
              yield* Effect.logInfo("orchestration-v2.driver-session.idle-release-deferred", {
                providerSessionId: input.providerSessionId,
                pinnedForMs: now - pinnedSinceMs,
              });
              // Re-check on this fiber after another idle window. Do not call
              // scheduleIdleReleaseInternal: that cancels entry.idleFiber, which
              // is this fiber, and can self-deadlock on Fiber.interrupt.
              yield* Effect.sleep(Duration.millis(idleTimeoutMs));
              return yield* releaseIfStillIdle(input);
            }
            yield* Effect.logWarning("orchestration-v2.driver-session.idle-release-pin-expired", {
              providerSessionId: input.providerSessionId,
              pinnedForMs: now - pinnedSinceMs,
            });
          }
          // hasPendingBackgroundWork yields to the adapter, so the idle
          // decision above can go stale; the generation guard revalidates
          // busyTurns and idleGeneration inside releaseEntry's atomic
          // entry removal.
          yield* releaseEntry({
            providerSessionId: input.providerSessionId,
            reason: "idle_timeout",
            cancelIdleFiber: false,
            onlyIfIdleGeneration: input.generation,
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("orchestration-v2.driver-session.idle-release-failed", {
                providerSessionId: input.providerSessionId,
                cause,
              }),
            ),
          );
        });

      const withActivityError = <A, E, R>(
        providerSessionId: ProviderSessionId,
        effect: Effect.Effect<A, E, R>,
      ): Effect.Effect<A, ProviderSessionActivityError, R> =>
        effect.pipe(
          Effect.catchCause((cause) =>
            Effect.fail(
              new ProviderSessionActivityError({
                providerSessionId,
                cause,
              }),
            ),
          ),
        );

      // Provider activity restarts the pin budget, so background work that keeps
      // reporting progress (a long Claude workflow) is never cut off; only work
      // that went silent for maxIdlePinMs is released.
      const scheduleIdleReleaseInternal = (
        providerSessionId: ProviderSessionId,
        options?: { readonly providerActivity?: boolean },
      ) =>
        Effect.gen(function* () {
          const key = sessionKey(providerSessionId);
          const current = yield* Ref.get(sessions);
          const entry = current.get(key);
          if (entry === undefined || entry.busyTurns.size > 0) {
            return;
          }

          yield* cancelIdleFiber(entry.idleFiber);
          const generation = entry.idleGeneration + 1;
          const idleFiber = yield* Effect.sleep(Duration.millis(idleTimeoutMs)).pipe(
            Effect.andThen(releaseIfStillIdle({ providerSessionId, generation })),
            Effect.forkIn(layerScope),
          );
          const lastActivityAtMs = yield* Clock.currentTimeMillis;
          yield* Ref.update(sessions, (latest) => {
            const latestEntry = latest.get(key);
            if (latestEntry === undefined || latestEntry.busyTurns.size > 0) {
              return latest;
            }
            const updated = new Map(latest);
            updated.set(key, {
              ...latestEntry,
              idleGeneration: generation,
              idleFiber,
              lastActivityAtMs,
              ...(options?.providerActivity === true ? { pinnedSinceMs: null } : {}),
            });
            return updated;
          });
        });

      const scheduleIdleRelease = (providerSessionId: ProviderSessionId) =>
        withActivityError(providerSessionId, scheduleIdleReleaseInternal(providerSessionId));

      const touchActivity = (
        providerSessionId: ProviderSessionId,
        options?: { readonly providerActivity?: boolean },
      ) =>
        withActivityError(
          providerSessionId,
          Effect.gen(function* () {
            const lastActivityAtMs = yield* Clock.currentTimeMillis;
            yield* Ref.update(sessions, (current) => {
              const entry = current.get(sessionKey(providerSessionId));
              if (entry === undefined) {
                return current;
              }
              const updated = new Map(current);
              updated.set(sessionKey(providerSessionId), {
                ...entry,
                lastActivityAtMs,
              });
              return updated;
            });
            yield* scheduleIdleReleaseInternal(providerSessionId, options);
          }),
        );

      /** Returns whether this call added the attachment to this exact runtime. */
      const attachThread = (input: {
        readonly providerSessionId: ProviderSessionId;
        readonly threadId: ThreadId;
        readonly runtime: ProviderAdapter.ProviderAdapterV2SessionRuntime;
      }) =>
        Ref.modify(sessions, (current) => {
          const entry = current.get(sessionKey(input.providerSessionId));
          if (entry?.runtime !== input.runtime) return [undefined, current] as const;
          if (entry.attachedThreadIds.has(input.threadId)) return [false, current] as const;
          const updated = new Map(current);
          updated.set(sessionKey(input.providerSessionId), {
            ...entry,
            attachedThreadIds: new Set([...entry.attachedThreadIds, input.threadId]),
          });
          return [true, updated] as const;
        }).pipe(
          Effect.flatMap((attached) =>
            attached === undefined
              ? Effect.fail(
                  new ProviderSessionActivityError({
                    providerSessionId: input.providerSessionId,
                    cause: "The provider session closed before the thread could attach.",
                  }),
                )
              : Effect.succeed(attached),
          ),
        );

      /**
       * Undoes an attach to `runtime`. A replacement session that reopened under
       * the same id since is left alone.
       */
      const removeThreadAttachment = (input: {
        readonly providerSessionId: ProviderSessionId;
        readonly threadId: ThreadId;
        readonly runtime: ProviderAdapter.ProviderAdapterV2SessionRuntime;
      }) =>
        Ref.update(sessions, (current) => {
          const key = sessionKey(input.providerSessionId);
          const entry = current.get(key);
          if (
            entry === undefined ||
            entry.runtime !== input.runtime ||
            !entry.attachedThreadIds.has(input.threadId)
          ) {
            return current;
          }
          const attachedThreadIds = new Set(entry.attachedThreadIds);
          attachedThreadIds.delete(input.threadId);
          const loadedProviderThreadKeyByThread = new Map(entry.loadedProviderThreadKeyByThread);
          loadedProviderThreadKeyByThread.delete(input.threadId);
          const updated = new Map(current);
          updated.set(key, {
            ...entry,
            attachedThreadIds,
            loadedProviderThreadKeyByThread,
          });
          return updated;
        });

      const isProviderThreadLoaded = (input: {
        readonly providerSessionId: ProviderSessionId;
        readonly threadId: ThreadId;
        readonly providerThreadKey: string;
      }) =>
        Ref.get(sessions).pipe(
          Effect.map(
            (current) =>
              current
                .get(sessionKey(input.providerSessionId))
                ?.loadedProviderThreadKeyByThread.get(input.threadId) === input.providerThreadKey,
          ),
        );

      const markProviderThreadLoaded = (input: {
        readonly providerSessionId: ProviderSessionId;
        readonly threadId: ThreadId;
        readonly providerThreadKey: string;
      }) =>
        Ref.update(sessions, (current) => {
          const key = sessionKey(input.providerSessionId);
          const entry = current.get(key);
          if (entry === undefined) {
            return current;
          }
          const loadedProviderThreadKeyByThread = new Map(entry.loadedProviderThreadKeyByThread);
          loadedProviderThreadKeyByThread.set(input.threadId, input.providerThreadKey);
          const updated = new Map(current);
          updated.set(key, { ...entry, loadedProviderThreadKeyByThread });
          return updated;
        });

      const ensureThreadAttached = (input: {
        readonly providerSessionId: ProviderSessionId;
        readonly threadId: ThreadId;
        readonly runtime: ProviderAdapter.ProviderAdapterV2SessionRuntime;
      }) =>
        Effect.suspend(() => {
          let addedAttachment = false;
          const attach = Effect.gen(function* () {
            const added = yield* attachThread(input).pipe(
              Effect.tap((value) => Effect.sync(() => (addedAttachment = value))),
              Effect.uninterruptible,
            );
            if (!added) return;
            yield* withMcpSession(input.threadId, input.runtime.instanceId, (mcpCredentialId) =>
              Effect.gen(function* () {
                if (
                  (yield* Ref.get(sessions)).get(sessionKey(input.providerSessionId))?.runtime !==
                  input.runtime
                )
                  return yield* new ProviderSessionActivityError({
                    providerSessionId: input.providerSessionId,
                    cause: "The provider session closed while preparing the thread.",
                  });
                yield* withActivityError(
                  input.providerSessionId,
                  writeProviderSessionEvents({
                    runtime: input.runtime,
                    threadIds: [input.threadId],
                    type: "provider-session.attached",
                    payload: input.runtime.providerSession,
                  }),
                );
                // Persistence may wait while the runtime exits. Only a live,
                // successfully attached runtime may become a credential owner.
                // A failed re-attach leaves its earlier legitimate record alone.
                const committed = yield* Ref.modify(sessions, (current) => {
                  const key = sessionKey(input.providerSessionId);
                  const entry = current.get(key);
                  if (
                    entry?.runtime !== input.runtime ||
                    !entry.attachedThreadIds.has(input.threadId)
                  )
                    return [false, current] as const;
                  const mcpCredentialIdByThread = new Map(entry.mcpCredentialIdByThread);
                  if (mcpCredentialId !== undefined)
                    mcpCredentialIdByThread.set(input.threadId, mcpCredentialId);
                  const updated = new Map(current);
                  updated.set(key, { ...entry, mcpCredentialIdByThread });
                  return [true, updated] as const;
                });
                if (!committed)
                  return yield* new ProviderSessionActivityError({
                    providerSessionId: input.providerSessionId,
                    cause: "The provider session closed while the thread was attaching.",
                  });
              }),
            ).pipe(
              Effect.mapError((cause) =>
                isProviderSessionActivityError(cause)
                  ? cause
                  : new ProviderSessionActivityError({
                      providerSessionId: input.providerSessionId,
                      cause,
                    }),
              ),
            );
          }).pipe(
            Effect.onError(() => (addedAttachment ? removeThreadAttachment(input) : Effect.void)),
          );
          // Keep rollback under the attachment lock so another attach cannot
          // mistake this attempt's provisional attachment for a committed one.
          return threadAttachment.withLock(threadAttachmentKey(input), attach);
        });

      const markBusy = (providerSessionId: ProviderSessionId, turnKey: string) =>
        withActivityError(
          providerSessionId,
          Effect.gen(function* () {
            const key = sessionKey(providerSessionId);
            const now = yield* Clock.currentTimeMillis;
            const idleFiber = yield* Ref.modify(sessions, (current) => {
              const entry = current.get(key);
              if (entry === undefined) {
                return [null, current] as const;
              }
              const updated = new Map(current);
              updated.set(key, {
                ...entry,
                busyTurns: new Set(entry.busyTurns).add(turnKey),
                idleFiber: null,
                lastActivityAtMs: now,
                pinnedSinceMs: null,
              });
              return [entry.idleFiber, updated] as const;
            });
            yield* cancelIdleFiber(idleFiber);
          }),
        );

      // Clearing a turn that is not marked busy (one whose failed start already
      // cleared it, or a subagent turn the manager never started) only
      // records activity.
      const markIdle = (
        providerSessionId: ProviderSessionId,
        providerThreadId: ProviderThreadId,
        runOrdinal: number,
      ) =>
        withActivityError(
          providerSessionId,
          Effect.gen(function* () {
            const key = sessionKey(providerSessionId);
            const now = yield* Clock.currentTimeMillis;
            yield* Ref.update(sessions, (current) => {
              const entry = current.get(key);
              if (entry === undefined) {
                return current;
              }
              const busyTurns = new Set(entry.busyTurns);
              busyTurns.delete(busyTurnKey(providerThreadId, runOrdinal));
              const updated = new Map(current);
              updated.set(key, {
                ...entry,
                busyTurns,
                lastActivityAtMs: now,
              });
              return updated;
            });
            yield* scheduleIdleReleaseInternal(providerSessionId);
            yield* scheduleThreadUnload(providerSessionId, providerThreadId);
          }),
        );

      const hasBusyTurn = (entry: LiveSessionEntry, providerThreadId: ProviderThreadId) => {
        const prefix = busyTurnPrefix(providerThreadId);
        for (const turnKey of entry.busyTurns) {
          if (turnKey.startsWith(prefix)) return true;
        }
        return false;
      };

      const updateIdleThreadUnload = (
        providerSessionId: ProviderSessionId,
        threadId: ThreadId,
        update: (current: IdleThreadUnload | undefined) => IdleThreadUnload | undefined,
      ) =>
        Ref.modify(sessions, (current) => {
          const key = sessionKey(providerSessionId);
          const entry = current.get(key);
          if (entry === undefined) return [undefined, current] as const;
          const previous = entry.idleThreadUnloads.get(threadId);
          const next = update(previous);
          const idleThreadUnloads = new Map(entry.idleThreadUnloads);
          if (next === undefined) idleThreadUnloads.delete(threadId);
          else idleThreadUnloads.set(threadId, next);
          const updated = new Map(current);
          updated.set(key, { ...entry, idleThreadUnloads });
          return [previous, updated] as const;
        });

      /**
       * Starts tracking the provider thread an app thread runs its turns on, and
       * stops any unload pending for it. Called before the thread is resumed or
       * given a turn, so an unload cannot land between a resume that found the
       * thread loaded and the turn that relies on it.
       */
      const holdThreadLoaded = (input: {
        readonly providerSessionId: ProviderSessionId;
        readonly threadId: ThreadId;
        readonly providerThread: OrchestrationV2ProviderThread;
      }) =>
        Effect.gen(function* () {
          const entry = (yield* Ref.get(sessions)).get(sessionKey(input.providerSessionId));
          if (
            entry === undefined ||
            !entry.supportsMultipleProviderThreads ||
            entry.exposedRuntime.unloadThread === undefined ||
            input.providerThread.nativeThreadRef === null
          ) {
            return;
          }
          const previous = yield* updateIdleThreadUnload(
            input.providerSessionId,
            input.threadId,
            (current) => ({
              providerThread: input.providerThread,
              generation: (current?.generation ?? 0) + 1,
              fiber: null,
            }),
          );
          yield* cancelIdleFiber(previous?.fiber ?? null);
        });

      /**
       * A shared runtime never goes idle while any of its threads is in use, so
       * its threads get the idle timeout one by one: a thread with no turn for
       * `idleTimeoutMs` is unloaded from the runtime, along with the native MCP
       * servers it started. Its next turn's resume loads it again.
       */
      const scheduleThreadUnload = (
        providerSessionId: ProviderSessionId,
        providerThreadId: ProviderThreadId,
      ) =>
        Effect.gen(function* () {
          const entry = (yield* Ref.get(sessions)).get(sessionKey(providerSessionId));
          if (entry === undefined || hasBusyTurn(entry, providerThreadId)) return;
          const tracked = Array.from(entry.idleThreadUnloads).find(
            ([, pending]) => pending.providerThread.id === providerThreadId,
          );
          if (tracked === undefined) return;
          const [threadId, pending] = tracked;
          const generation = pending.generation + 1;
          const fiber = yield* Effect.sleep(Duration.millis(idleTimeoutMs)).pipe(
            Effect.andThen(unloadIdleThread({ providerSessionId, threadId, generation })),
            Effect.forkIn(layerScope),
          );
          // A turn that started meanwhile already moved the generation on.
          const previous = yield* updateIdleThreadUnload(providerSessionId, threadId, (current) =>
            current?.generation === pending.generation
              ? { ...current, generation, fiber }
              : current,
          );
          yield* cancelIdleFiber(
            previous?.generation === pending.generation ? previous.fiber : fiber,
          );
        });

      const unloadIdleThread = (input: {
        readonly providerSessionId: ProviderSessionId;
        readonly threadId: ThreadId;
        readonly generation: number;
      }): Effect.Effect<void> =>
        Effect.gen(function* () {
          const outcome = yield* threadAttachment.withLock(
            threadAttachmentKey(input),
            Effect.gen(function* () {
              const key = sessionKey(input.providerSessionId);
              const entry = (yield* Ref.get(sessions)).get(key);
              const pending = entry?.idleThreadUnloads.get(input.threadId);
              const unloadThread = entry?.exposedRuntime.unloadThread;
              if (
                entry === undefined ||
                pending === undefined ||
                pending.generation !== input.generation ||
                unloadThread === undefined ||
                !entry.attachedThreadIds.has(input.threadId) ||
                hasBusyTurn(entry, pending.providerThread.id)
              ) {
                return "skipped" as const;
              }
              // Unloading stops the native thread's background terminals, so a
              // thread still running background work stays loaded.
              const hasPendingWork =
                entry.runtime.hasPendingBackgroundWorkForThread === undefined
                  ? false
                  : yield* entry.runtime
                      .hasPendingBackgroundWorkForThread(pending.providerThread)
                      .pipe(Effect.catchCause(() => Effect.succeed(false)));
              if (hasPendingWork) return "deferred" as const;
              const unloading = yield* Ref.modify(sessions, (current) => {
                const latest = current.get(key);
                if (
                  latest?.runtime !== entry.runtime ||
                  latest.idleThreadUnloads.get(input.threadId)?.generation !== input.generation
                ) {
                  return [false, current] as const;
                }
                const loadedProviderThreadKeyByThread = new Map(
                  latest.loadedProviderThreadKeyByThread,
                );
                loadedProviderThreadKeyByThread.delete(input.threadId);
                const idleThreadUnloads = new Map(latest.idleThreadUnloads);
                idleThreadUnloads.delete(input.threadId);
                const updated = new Map(current);
                updated.set(key, {
                  ...latest,
                  loadedProviderThreadKeyByThread,
                  idleThreadUnloads,
                });
                return [true, updated] as const;
              });
              if (!unloading) return "skipped" as const;
              yield* unloadThread({ providerThread: pending.providerThread }).pipe(
                Effect.timeout(UNLOAD_THREAD_TIMEOUT_MS),
                Effect.catchCause((cause) =>
                  Effect.logWarning("orchestration-v2.driver-session.idle-unload-failed", {
                    providerSessionId: input.providerSessionId,
                    threadId: input.threadId,
                    providerThreadId: pending.providerThread.id,
                    cause,
                  }),
                ),
              );
              return "unloaded" as const;
            }),
          );
          // Re-check on this fiber after another idle window, outside the
          // lock so the thread's next attach is not held up meanwhile.
          if (outcome === "deferred") {
            yield* Effect.sleep(Duration.millis(idleTimeoutMs));
            return yield* unloadIdleThread(input);
          }
        });

      const observeActivity = (
        providerSessionId: ProviderSessionId,
        activity: Effect.Effect<void, ProviderSessionActivityError>,
      ) =>
        activity.pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("orchestration-v2.driver-session.activity-failed", {
              providerSessionId,
              cause,
            }),
          ),
        );

      const makeEventSubscription = (
        subscribers: Ref.Ref<
          ReadonlyMap<number, Queue.Queue<ProviderSessionEventSignal, Cause.Done>>
        >,
      ): Effect.Effect<ProviderAdapter.ProviderAdapterV2EventSubscription> =>
        Effect.gen(function* () {
          const queue = yield* Queue.unbounded<ProviderSessionEventSignal, Cause.Done>();
          const subscriberId = yield* Ref.getAndUpdate(nextSubscriberId, (value) => value + 1);
          yield* Ref.update(subscribers, (current) => {
            const updated = new Map(current);
            updated.set(subscriberId, queue);
            return updated;
          });
          const close = Ref.modify(subscribers, (current) => {
            if (!current.has(subscriberId)) {
              return [false, current] as const;
            }
            const updated = new Map(current);
            updated.delete(subscriberId);
            return [true, updated] as const;
          }).pipe(
            Effect.flatMap((removed) =>
              removed
                ? Queue.clear(queue).pipe(Effect.andThen(Queue.end(queue)), Effect.asVoid)
                : Effect.void,
            ),
          );
          const events = Stream.fromQueue(queue).pipe(
            Stream.mapEffect((signal) =>
              signal.type === "event"
                ? Effect.succeed(signal.event)
                : Effect.failCause(signal.cause),
            ),
            Stream.ensuring(close),
          );
          return { events, close } satisfies ProviderAdapter.ProviderAdapterV2EventSubscription;
        });

      const decorateRuntime = (
        runtime: ProviderAdapter.ProviderAdapterV2SessionRuntime,
        eventSubscribers: Ref.Ref<
          ReadonlyMap<number, Queue.Queue<ProviderSessionEventSignal, Cause.Done>>
        >,
      ): ProviderAdapter.ProviderAdapterV2SessionRuntime => {
        const providerSessionId = runtime.providerSessionId;
        const subscribeEvents = makeEventSubscription(eventSubscribers);
        // Every provider's turn operations pass through here, so this is where they are
        // counted. Only turn starts are timed: until the provider accepts the turn.
        const turnMetrics = (operation: string, model?: string) =>
          withMetrics({
            counter: providerTurnsTotal,
            ...(operation === "send" ? { timer: providerTurnDuration } : {}),
            attributes: {
              provider: runtime.driver,
              operation,
              modelFamily: normalizeModelMetricLabel(model),
            },
          });
        return {
          ...runtime,
          subscribeEvents,
          events: Stream.unwrap(
            subscribeEvents.pipe(Effect.map((subscription) => subscription.events)),
          ),
          ensureThread: (input) =>
            observeActivity(
              providerSessionId,
              ensureThreadAttached({
                providerSessionId,
                threadId: input.threadId,
                runtime,
              }),
            ).pipe(
              Effect.andThen(runtime.ensureThread(input)),
              Effect.tap((providerThread) =>
                markProviderThreadLoaded({
                  providerSessionId,
                  threadId: input.threadId,
                  providerThreadKey: providerThreadLoadKey({
                    providerThread,
                    modelSelection: input.modelSelection,
                    runtimePolicy: input.runtimePolicy,
                  }),
                }),
              ),
            ),
          resumeThread: (input) => {
            const threadId = input.threadId ?? input.providerThread.appThreadId;
            if (threadId === null || threadId === undefined) {
              return runtime.resumeThread(input);
            }
            const providerThreadKey = providerThreadLoadKey({
              providerThread: input.providerThread,
              ...(input.modelSelection === undefined
                ? {}
                : { modelSelection: input.modelSelection }),
              ...(input.runtimePolicy === undefined ? {} : { runtimePolicy: input.runtimePolicy }),
            });
            return observeActivity(
              providerSessionId,
              ensureThreadAttached({
                providerSessionId,
                threadId,
                runtime,
              }),
            ).pipe(
              Effect.andThen(
                holdThreadLoaded({
                  providerSessionId,
                  threadId,
                  providerThread: input.providerThread,
                }),
              ),
              Effect.andThen(
                isProviderThreadLoaded({ providerSessionId, threadId, providerThreadKey }),
              ),
              Effect.flatMap((loaded) =>
                loaded ? Effect.succeed(input.providerThread) : runtime.resumeThread(input),
              ),
              Effect.tap((providerThread) =>
                markProviderThreadLoaded({
                  providerSessionId,
                  threadId,
                  providerThreadKey: providerThreadLoadKey({
                    providerThread,
                    ...(input.modelSelection === undefined
                      ? {}
                      : { modelSelection: input.modelSelection }),
                    ...(input.runtimePolicy === undefined
                      ? {}
                      : { runtimePolicy: input.runtimePolicy }),
                  }),
                }),
              ),
            );
          },
          forkThread: (input) =>
            observeActivity(
              providerSessionId,
              ensureThreadAttached({
                providerSessionId,
                threadId: input.targetThreadId,
                runtime,
              }),
            ).pipe(
              Effect.andThen(runtime.forkThread(input)),
              Effect.tap((providerThread) =>
                markProviderThreadLoaded({
                  providerSessionId,
                  threadId: input.targetThreadId,
                  providerThreadKey: providerThreadLoadKey({
                    providerThread,
                    ...(input.modelSelection === undefined
                      ? {}
                      : { modelSelection: input.modelSelection }),
                    ...(input.runtimePolicy === undefined
                      ? {}
                      : { runtimePolicy: input.runtimePolicy }),
                  }),
                }),
              ),
            ),
          startTurn: (input) =>
            observeActivity(
              providerSessionId,
              ensureThreadAttached({
                providerSessionId,
                threadId: input.threadId,
                runtime,
              }),
            ).pipe(
              // A start that fails or is stopped may never emit turn.terminal,
              // so it clears its own turn or the session never goes idle. If
              // the adapter emits the terminal anyway, clearing the same turn
              // again changes nothing, so another thread's turn on a shared
              // session stays busy either way.
              Effect.andThen(
                holdThreadLoaded({
                  providerSessionId,
                  threadId: input.threadId,
                  providerThread: input.providerThread,
                }),
              ),
              Effect.andThen(
                Effect.acquireUseRelease(
                  observeActivity(
                    providerSessionId,
                    markBusy(
                      providerSessionId,
                      busyTurnKey(input.providerThread.id, input.runOrdinal),
                    ),
                  ),
                  () =>
                    runtime
                      .startTurn(input)
                      .pipe(turnMetrics("send", input.modelSelection.model ?? undefined)),
                  (_, exit) =>
                    Exit.isFailure(exit)
                      ? observeActivity(
                          providerSessionId,
                          markIdle(providerSessionId, input.providerThread.id, input.runOrdinal),
                        )
                      : Effect.void,
                ),
              ),
            ),
          steerTurn: (input) =>
            observeActivity(providerSessionId, touchActivity(providerSessionId)).pipe(
              Effect.andThen(runtime.steerTurn(input).pipe(turnMetrics("steer"))),
            ),
          interruptTurn: (input) =>
            observeActivity(providerSessionId, touchActivity(providerSessionId)).pipe(
              Effect.andThen(runtime.interruptTurn(input).pipe(turnMetrics("interrupt"))),
            ),
          respondToRuntimeRequest: (input) =>
            observeActivity(providerSessionId, touchActivity(providerSessionId)).pipe(
              Effect.andThen(
                runtime
                  .respondToRuntimeRequest(input)
                  .pipe(turnMetrics("runtime-request-response")),
              ),
            ),
        };
      };

      const persistProviderSessionUpdate = (
        entry: LiveSessionEntry,
        event: Extract<
          ProviderAdapter.ProviderAdapterV2Event,
          { readonly type: "provider_session.updated" }
        >,
      ) =>
        Effect.gen(function* () {
          const current = (yield* Ref.get(sessions)).get(
            sessionKey(entry.runtime.providerSessionId),
          );
          if (current?.runtime !== entry.runtime) {
            return;
          }
          yield* writeProviderSessionEvents({
            runtime: entry.runtime,
            threadIds: current.attachedThreadIds,
            type: "provider-session.updated",
            payload: event.providerSession,
          });
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("orchestration-v2.driver-session.status-persist-failed", {
              providerSessionId: entry.runtime.providerSessionId,
              cause,
            }),
          ),
        );

      const startEventPump = (entry: LiveSessionEntry) => {
        let stoppedByProvider = false;
        return entry.runtime.events.pipe(
          Stream.runForEach((event) => {
            if (shutdownSignal.received) return Effect.void;
            if (
              event.type === "provider_session.updated" &&
              event.providerSession.status === "stopped"
            ) {
              stoppedByProvider = true;
            }
            return observeActivity(
              entry.runtime.providerSessionId,
              event.type === "turn.terminal"
                ? markIdle(
                    entry.runtime.providerSessionId,
                    event.providerThreadId,
                    event.runOrdinal,
                  )
                : touchActivity(entry.runtime.providerSessionId, { providerActivity: true }),
            ).pipe(
              Effect.andThen(
                event.type === "provider_session.updated"
                  ? persistProviderSessionUpdate(entry, event)
                  : Effect.void,
              ),
              Effect.andThen(
                Effect.gen(function* () {
                  // Some providers can block before a run subscriber exists
                  // (project trust, login, or session-switch hooks). Persist
                  // their runless request artifacts directly so the normal T3
                  // request UI can answer them and unblock session setup.
                  const threadId = sessionScopedRuntimeRequestThreadId(event);
                  if (threadId !== undefined) {
                    yield* Effect.gen(function* () {
                      const current = (yield* Ref.get(sessions)).get(
                        sessionKey(entry.runtime.providerSessionId),
                      );
                      if (current?.runtime !== entry.runtime) return;
                      yield* providerEventIngestor
                        .ingestNormalized({
                          providerSessionId: entry.runtime.providerSessionId,
                          providerInstanceId: entry.runtime.instanceId,
                          threadId,
                          event,
                        })
                        .pipe(
                          Effect.mapError(
                            (cause) =>
                              new ProviderAdapter.ProviderAdapterEventStreamError({
                                driver: entry.runtime.driver,
                                providerSessionId: entry.runtime.providerSessionId,
                                cause,
                              }),
                          ),
                        );
                    }).pipe(entry.requestEventPermit.withPermits(1));
                    return;
                  }
                  yield* publishToSubscribers(entry.eventSubscribers, { type: "event", event });
                }),
              ),
            );
          }),
          Effect.exit,
          Effect.flatMap((exit) =>
            Effect.gen(function* () {
              // A provider that exits on the shutdown signal is released by shutdown.
              if (shutdownSignal.received) return;
              const current = (yield* Ref.get(sessions)).get(
                sessionKey(entry.runtime.providerSessionId),
              );
              if (current?.runtime !== entry.runtime) {
                return;
              }
              if (stoppedByProvider && Exit.isSuccess(exit)) {
                yield* releaseEntry({
                  providerSessionId: entry.runtime.providerSessionId,
                  reason: "manual_shutdown",
                  gracefulSubscribers: true,
                }).pipe(logReleaseFailure(entry.runtime.providerSessionId));
                return;
              }
              // Subscribers read an interrupt as server shutdown, so keep it for that.
              const cause =
                Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)
                  ? exit.cause
                  : Cause.fail(
                      new ProviderAdapter.ProviderAdapterEventStreamError({
                        driver: entry.runtime.driver,
                        providerSessionId: entry.runtime.providerSessionId,
                        cause: "Provider event stream ended unexpectedly.",
                      }),
                    );
              yield* publishToSubscribers(entry.eventSubscribers, {
                type: "failure",
                cause,
              });
              yield* Ref.set(entry.eventSubscribers, new Map());
              yield* releaseEntry({
                providerSessionId: entry.runtime.providerSessionId,
                reason: "runtime_error",
                detail: Cause.pretty(cause),
              }).pipe(logReleaseFailure(entry.runtime.providerSessionId));
            }),
          ),
          Effect.forkIn(layerScope),
        );
      };

      // Parent of every session scope. On layer close, shutdown releases the
      // live sessions first, then closes any session whose open is still in
      // flight, time-boxed so a stuck adapter cannot hold up server shutdown.
      // Both steps run in parallel. The service launcher kills the server
      // 5 s after it asks it to stop, and a busy server can hold 15 sessions.
      const sessionScopes = yield* Scope.make("parallel");
      const shutdown = Effect.gen(function* () {
        const activeSessions = [...(yield* Ref.get(sessions)).values()];
        yield* Effect.forEach(
          activeSessions,
          (entry) =>
            releaseEntry({
              providerSessionId: entry.runtime.providerSessionId,
              reason: "server_shutdown",
            }).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("orchestration-v2.driver-session.shutdown-release-failed", {
                  providerSessionId: entry.runtime.providerSessionId,
                  cause,
                }),
              ),
            ),
          { concurrency: "unbounded", discard: true },
        );
      });
      yield* Effect.addFinalizer(() =>
        shutdown.pipe(
          Effect.ensuring(closeScopeWithin(sessionScopes, { reason: "server_shutdown" })),
        ),
      );

      const opening = new Map<
        symbol,
        {
          readonly instanceId: ProviderInstanceId;
          readonly fiber: Fiber.Fiber<
            ProviderAdapter.ProviderAdapterV2SessionRuntime,
            ProviderSessionManagerV2Error
          >;
        }
      >();
      // Direct closes (e.g. ACP configuration) do not remove the canonical
      // instance. Keep admission closed until every overlapping drain finishes.
      const closingInstances = new Map<ProviderInstanceId, number>();
      const trackOpen = (
        input: Parameters<ProviderSessionManagerV2Shape["open"]>[0],
        operation: ReturnType<ProviderSessionManagerV2Shape["open"]>,
      ) =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            if (closingInstances.has(input.modelSelection.instanceId)) {
              return yield* new ProviderSessionOpenError({
                instanceId: input.modelSelection.instanceId,
                providerSessionId: input.providerSessionId,
                cause: `Provider instance ${input.modelSelection.instanceId} is closing.`,
              });
            }
            const id = Symbol();
            const fiber = yield* operation.pipe(Effect.forkIn(layerScope));
            opening.set(id, { instanceId: input.modelSelection.instanceId, fiber });
            return yield* restore(Fiber.join(fiber)).pipe(
              Effect.onInterrupt(() => Fiber.interrupt(fiber)),
              Effect.ensuring(
                Effect.sync(() => {
                  opening.delete(id);
                }),
              ),
            );
          }),
        );
      const closeInstance = (instanceId: ProviderInstanceId) =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            closingInstances.set(instanceId, (closingInstances.get(instanceId) ?? 0) + 1);
          }),
          () =>
            Effect.gen(function* () {
              yield* Effect.forEach(
                [...opening.values()].filter((entry) => entry.instanceId === instanceId),
                (entry) => Fiber.interrupt(entry.fiber),
                { concurrency: "unbounded", discard: true },
              );
              const active = [...(yield* Ref.get(sessions)).values()].filter(
                (entry) => entry.runtime.instanceId === instanceId,
              );
              const outcomes = yield* Effect.forEach(
                active,
                (entry) =>
                  releaseEntry({
                    providerSessionId: entry.runtime.providerSessionId,
                    reason: "manual_shutdown",
                    detail: `Provider instance ${instanceId} closed.`,
                  }).pipe(Effect.exit),
                { concurrency: "unbounded" },
              );
              const failure = outcomes.find(Exit.isFailure);
              if (failure !== undefined && Exit.isFailure(failure)) {
                return yield* Effect.failCause(failure.cause);
              }
            }).pipe(Effect.uninterruptible),
          () =>
            Effect.sync(() => {
              const remaining = closingInstances.get(instanceId)! - 1;
              if (remaining === 0) closingInstances.delete(instanceId);
              else closingInstances.set(instanceId, remaining);
            }),
        ).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderSessionCloseError({
                providerSessionId: ProviderSessionId.make(
                  `provider-session:provider-instance:${instanceId}`,
                ),
                cause,
              }),
          ),
        );

      if (registry.beforeInstanceClose !== undefined) {
        yield* registry.beforeInstanceClose((instanceId) =>
          closeInstance(instanceId).pipe(
            Effect.catchCause((cause) =>
              Effect.logError("orchestration-v2.instance-session-close-failed", {
                instanceId,
                cause,
              }),
            ),
          ),
        );
      }

      return ProviderSessionManagerV2.of({
        shutdown,
        open: (input) =>
          trackOpen(
            input,
            sessionOpen.withLock(
              input.providerSessionId,
              Effect.gen(function* () {
                // A reusable runtime is not authority to reopen a removed or
                // replaced instance while its canonical scope is closing.
                const adapter = yield* registry.get(input.modelSelection.instanceId).pipe(
                  Effect.mapError(
                    (cause) =>
                      new ProviderSessionOpenError({
                        instanceId: input.modelSelection.instanceId,
                        providerSessionId: input.providerSessionId,
                        cause,
                      }),
                  ),
                );
                const cwd = input.runtimePolicy.cwd;
                if (cwd !== null) {
                  const workspaceIsDirectory = yield* fileSystem.stat(cwd).pipe(
                    Effect.map((stat) => stat.type === "Directory"),
                    Effect.catch((error) => Effect.succeed(error.reason._tag !== "NotFound")),
                  );
                  if (!workspaceIsDirectory) {
                    return yield* new ProviderWorkspaceMissingError({
                      threadId: input.threadId,
                      cwd,
                    });
                  }
                }
                const key = sessionKey(input.providerSessionId);
                const existing = (yield* Ref.get(sessions)).get(key);
                if (existing !== undefined) {
                  const attached = existing.attachedThreadIds.has(input.threadId);
                  if (!attached && !existing.supportsMultipleProviderThreads) {
                    return yield* new ProviderSessionOpenError({
                      instanceId: input.modelSelection.instanceId,
                      providerSessionId: input.providerSessionId,
                      cause: `Provider ${existing.runtime.driver} does not support attaching multiple app threads to one session.`,
                    });
                  }
                  // Joining a shared session is a new session for this thread.
                  if (!attached) yield* agentScope.clear(input.threadId);
                  yield* ensureThreadAttached({
                    providerSessionId: input.providerSessionId,
                    threadId: input.threadId,
                    runtime: existing.runtime,
                  });
                  yield* touchActivity(input.providerSessionId);
                  return existing.exposedRuntime;
                }

                return yield* Effect.uninterruptibleMask((restore) =>
                  Effect.gen(function* () {
                    const sessionScope = yield* Scope.fork(sessionScopes);
                    let recorded = false;
                    return yield* restore(
                      withMcpSession(
                        input.threadId,
                        input.modelSelection.instanceId,
                        (mcpCredentialId) =>
                          Effect.gen(function* () {
                            yield* agentScope.clear(input.threadId);
                            const runtime = yield* adapter
                              .openSession({
                                threadId: input.threadId,
                                providerSessionId: input.providerSessionId,
                                modelSelection: input.modelSelection,
                                runtimePolicy: input.runtimePolicy,
                                ...(input.resumeFromSession === undefined
                                  ? {}
                                  : { resumeFromSession: input.resumeFromSession }),
                                ...(input.initialNativeThreadId === undefined
                                  ? {}
                                  : { initialNativeThreadId: input.initialNativeThreadId }),
                                ...(input.initialProviderItemIdentityVersion === undefined
                                  ? {}
                                  : {
                                      initialProviderItemIdentityVersion:
                                        input.initialProviderItemIdentityVersion,
                                    }),
                              })
                              .pipe(
                                Effect.provideService(Scope.Scope, sessionScope),
                                Effect.mapError(
                                  (cause) =>
                                    new ProviderSessionOpenError({
                                      instanceId: input.modelSelection.instanceId,
                                      providerSessionId: input.providerSessionId,
                                      cause,
                                    }),
                                ),
                                withMetrics({
                                  counter: providerSessionsTotal,
                                  attributes: { provider: adapter.driver, operation: "open" },
                                }),
                              );
                            const eventSubscribers = yield* Ref.make<
                              ReadonlyMap<
                                number,
                                Queue.Queue<ProviderSessionEventSignal, Cause.Done>
                              >
                            >(new Map());
                            const exposedRuntime = decorateRuntime(runtime, eventSubscribers);
                            const now = yield* Clock.currentTimeMillis;
                            const entry: LiveSessionEntry = {
                              attachedThreadIds: new Set([input.threadId]),
                              loadedProviderThreadKeyByThread: new Map(),
                              mcpCredentialIdByThread:
                                mcpCredentialId === undefined
                                  ? new Map()
                                  : new Map([[input.threadId, mcpCredentialId]]),
                              supportsMultipleProviderThreads:
                                runtime.providerSession.capabilities.sessions
                                  .supportsMultipleProviderThreadsPerSession,
                              runtime,
                              exposedRuntime,
                              eventSubscribers,
                              requestEventPermit: yield* Semaphore.make(1),
                              scope: sessionScope,
                              idleGeneration: 0,
                              busyTurns: new Set(),
                              lastActivityAtMs: now,
                              idleFiber: null,
                              pinnedSinceMs: null,
                              idleThreadUnloads: new Map(),
                            };
                            yield* Ref.update(sessions, (current) => {
                              const updated = new Map(current);
                              updated.set(key, entry);
                              recorded = true;
                              return updated;
                            }).pipe(Effect.uninterruptible);
                            yield* withActivityError(
                              input.providerSessionId,
                              writeProviderSessionEvents({
                                runtime,
                                threadIds: [input.threadId],
                                type: "provider-session.attached",
                                payload: runtime.providerSession,
                              }),
                            );
                            if ((yield* Ref.get(sessions)).get(key)?.runtime !== runtime)
                              return yield* new ProviderSessionOpenError({
                                instanceId: input.modelSelection.instanceId,
                                providerSessionId: input.providerSessionId,
                                cause: "The provider session closed while opening.",
                              });
                            yield* startEventPump(entry);
                            yield* scheduleIdleRelease(input.providerSessionId);
                            return exposedRuntime;
                          }),
                      ),
                    ).pipe(
                      // Retire an abandoned acquisition before closing a provider
                      // scope: a wedged process finalizer must not retain its token.
                      Effect.onError((cause) =>
                        recorded
                          ? releaseEntry({
                              providerSessionId: input.providerSessionId,
                              reason: Cause.hasInterruptsOnly(cause)
                                ? "manual_shutdown"
                                : "runtime_error",
                              detail: "The provider session could not finish opening.",
                            }).pipe(logReleaseFailure(input.providerSessionId))
                          : closeScopeWithin(sessionScope, {
                              providerSessionId: input.providerSessionId,
                              reason: "open_failed",
                            }),
                      ),
                      Effect.mapError((cause) =>
                        isProviderSessionOpenError(cause) || isProviderSessionActivityError(cause)
                          ? cause
                          : new ProviderSessionOpenError({
                              instanceId: input.modelSelection.instanceId,
                              providerSessionId: input.providerSessionId,
                              cause,
                            }),
                      ),
                    );
                  }),
                );
              }),
            ),
          ),
        isLive: (providerSessionId) =>
          Ref.get(sessions).pipe(
            Effect.map((current) => current.has(sessionKey(providerSessionId))),
          ),
        get: (providerSessionId) =>
          Effect.gen(function* () {
            const entry = (yield* Ref.get(sessions)).get(sessionKey(providerSessionId));
            if (entry === undefined) {
              return Option.none<ProviderAdapter.ProviderAdapterV2SessionRuntime>();
            }
            yield* touchActivity(providerSessionId);
            return Option.some(entry.exposedRuntime);
          }).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderSessionLookupError({
                  providerSessionId,
                  cause,
                }),
            ),
          ),
        close: (providerSessionId) =>
          releaseEntry({ providerSessionId, reason: "manual_shutdown" }).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderSessionCloseError({
                  providerSessionId,
                  cause,
                }),
            ),
          ),
        closeInstance,
        release: releaseEntry,
        detach: (input) =>
          Effect.gen(function* () {
            const key = sessionKey(input.providerSessionId);
            const currentEntry = (yield* Ref.get(sessions)).get(key);
            let detachedProviderThreads: ReadonlyArray<OrchestrationV2ProviderThread> = [];
            if (currentEntry?.supportsMultipleProviderThreads === true) {
              const projection = yield* Effect.option(
                projectionStore.getThreadRecords(input.threadId, [
                  "providerThreads",
                  "providerTurns",
                ]),
              );
              if (Option.isSome(projection)) {
                const providerThreads = new Map(
                  projection.value.providerThreads
                    .filter((thread) => thread.providerSessionId === input.providerSessionId)
                    .map((thread) => [thread.id, thread] as const),
                );
                detachedProviderThreads = [...providerThreads.values()];
                const activeTurns = projection.value.providerTurns.filter(
                  (turn) => turn.status === "running" && providerThreads.has(turn.providerThreadId),
                );
                yield* Effect.forEach(
                  activeTurns,
                  (turn) =>
                    currentEntry.exposedRuntime
                      .interruptTurn({
                        providerThread: providerThreads.get(turn.providerThreadId)!,
                        providerTurnId: turn.id,
                      })
                      .pipe(
                        Effect.catchCause((cause) =>
                          Effect.logWarning(
                            "orchestration-v2.driver-session.detach-interrupt-failed",
                            {
                              providerSessionId: input.providerSessionId,
                              threadId: input.threadId,
                              providerTurnId: turn.id,
                              cause,
                            },
                          ),
                        ),
                      ),
                  { concurrency: 1, discard: true },
                );
              }
            }
            const detachResult = yield* Ref.modify(sessions, (current) => {
              const entry = current.get(key);
              if (entry === undefined || !entry.attachedThreadIds.has(input.threadId)) {
                return [
                  Option.none<{
                    readonly entry: LiveSessionEntry;
                    readonly idleUnloadFiber: Fiber.Fiber<void, never> | null;
                  }>(),
                  current,
                ] as const;
              }
              const attachedThreadIds = new Set(entry.attachedThreadIds);
              attachedThreadIds.delete(input.threadId);
              const loadedProviderThreadKeyByThread = new Map(
                entry.loadedProviderThreadKeyByThread,
              );
              loadedProviderThreadKeyByThread.delete(input.threadId);
              // For a plain (workspace-change) detach, the credential id stays
              // recorded: the thread may re-attach and reuse it, and
              // releaseEntry revokes it when the provider process finally goes
              // away. A terminal detach (archive/delete) prunes the record so
              // nothing vetoes the revocation below.
              const mcpCredentialIdByThread =
                input.revokeMcpCredential === true
                  ? (() => {
                      const pruned = new Map(entry.mcpCredentialIdByThread);
                      pruned.delete(input.threadId);
                      return pruned;
                    })()
                  : entry.mcpCredentialIdByThread;
              // The detach unloads the thread itself below.
              const idleThreadUnloads = new Map(entry.idleThreadUnloads);
              idleThreadUnloads.delete(input.threadId);
              const updatedEntry = {
                ...entry,
                attachedThreadIds,
                loadedProviderThreadKeyByThread,
                mcpCredentialIdByThread,
                idleThreadUnloads,
              };
              const updated = new Map(current);
              updated.set(key, updatedEntry);
              return [
                Option.some({
                  entry: updatedEntry,
                  idleUnloadFiber: entry.idleThreadUnloads.get(input.threadId)?.fiber ?? null,
                }),
                updated,
              ] as const;
            });
            if (Option.isSome(detachResult)) {
              yield* cancelIdleFiber(detachResult.value.idleUnloadFiber);
            }
            const detached = Option.map(detachResult, (result) => result.entry);
            // Plain detaches deliberately do not revoke: a detached thread's
            // provider process may still be alive (shared multi-thread codex
            // session across a workspace handoff) and holds its MCP client's
            // credential for the thread it will re-attach with. Credentials
            // are revoked when the session entry is released (process gone)
            // or rotated on the next attach if they stopped resolving.
            // Terminal detaches (thread archived or deleted) revoke the
            // thread's credentials immediately, even on a retry where the
            // entry is already gone: there is no legitimate future re-attach,
            // and the token must not outlive the thread.
            if (input.revokeMcpCredential === true) {
              yield* clearMcpSession(input.threadId);
            }
            if (Option.isNone(detached)) {
              return;
            }
            if (
              detached.value.attachedThreadIds.size === 0 &&
              !detached.value.supportsMultipleProviderThreads
            ) {
              yield* releaseEntry({
                providerSessionId: input.providerSessionId,
                reason: "manual_shutdown",
                ...(input.detail === undefined ? {} : { detail: input.detail }),
                detachedThreadId: input.threadId,
              });
              return;
            }
            // The shared runtime stays up for other threads, so unload this
            // thread's native state rather than leaving it (and its MCP
            // servers) resident until the whole runtime is released.
            const unloadThread = detached.value.exposedRuntime.unloadThread;
            if (detached.value.supportsMultipleProviderThreads && unloadThread !== undefined) {
              // Serialized with re-attachment: a thread whose next turn
              // attaches first stays loaded, and one that attaches during the
              // unload waits for it, so its resume reloads the native thread.
              yield* threadAttachment.withLock(
                threadAttachmentKey(input),
                Effect.gen(function* () {
                  const entry = (yield* Ref.get(sessions)).get(key);
                  if (
                    entry?.runtime !== detached.value.runtime ||
                    entry.attachedThreadIds.has(input.threadId)
                  ) {
                    return;
                  }
                  yield* Effect.forEach(
                    detachedProviderThreads.filter((thread) => thread.nativeThreadRef !== null),
                    (providerThread) =>
                      unloadThread({ providerThread }).pipe(
                        // Bounded so a wedged provider cannot hold up the
                        // thread's next attach.
                        Effect.timeout(UNLOAD_THREAD_TIMEOUT_MS),
                        Effect.catchCause((cause) =>
                          Effect.logWarning(
                            "orchestration-v2.driver-session.detach-unload-failed",
                            {
                              providerSessionId: input.providerSessionId,
                              threadId: input.threadId,
                              providerThreadId: providerThread.id,
                              cause,
                            },
                          ),
                        ),
                      ),
                    { concurrency: 1, discard: true },
                  );
                }),
              );
            }
            yield* scheduleIdleRelease(input.providerSessionId);
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.fail(
                new ProviderSessionReleaseError({
                  providerSessionId: input.providerSessionId,
                  reason: "manual_shutdown",
                  cause,
                }),
              ),
            ),
          ),
      } satisfies ProviderSessionManagerV2Shape);
    }),
  );

export const layer = layerWithOptions();
