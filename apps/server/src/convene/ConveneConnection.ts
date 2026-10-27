import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {
  CONVENE_SUPPORTED_PROTOCOLS,
  ConveneDataControl,
  ConveneIntegrationError,
  ConveneProjectConfiguration,
  type ConveneStatus,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as PubSub from "effect/PubSub";
import * as Path from "effect/Path";
import * as ServerConfig from "../config.ts";
import * as Queue from "effect/Queue";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Semaphore from "effect/Semaphore";
import * as DesktopTelemetryReceiver from "../resourceTelemetry/DesktopTelemetryReceiver.ts";
import * as Socket from "effect/socket/Socket";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as EventStore from "../persistence/OrchestrationEventStore.ts";
import packageJson from "../../package.json" with { type: "json" };
import * as ConvenePlatform from "./ConvenePlatform.ts";
import * as ConveneMcp from "./ConveneMcp.ts";
import * as ConveneDataChannel from "./ConveneDataChannel.ts";
import * as ConveneWeb from "./ConveneWeb.ts";
import * as ConveneWorkspaces from "./ConveneWorkspaces.ts";
import * as ConveneConfiguration from "./ConveneConfiguration.ts";

const ControlMessage = Schema.Struct({
  TYPE: Schema.Literals([
    "HELLO_ACK",
    "HELLO_REJECT",
    "HEARTBEAT_ACK",
    "TARGETS_REPORT_ACK",
    "CONFIGURATION_CHANGED",
  ]),
  PAYLOAD: Schema.Record(Schema.String, Schema.Unknown),
});
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeMessageType = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ TYPE: Schema.String })),
);
const decodeDataControl = Schema.decodeUnknownEffect(Schema.fromJsonString(ConveneDataControl));
const decodeControlMessage = Schema.decodeUnknownEffect(Schema.fromJsonString(ControlMessage));
const decodeHelloAck = Schema.decodeUnknownEffect(
  Schema.Struct({ HEARTBEAT_INTERVAL_SECONDS: Schema.Number }),
);
const decodeReportAck = Schema.decodeUnknownEffect(
  Schema.Struct({
    REPORT_ID: Schema.String,
    CONFIGURATIONS: Schema.Array(ConveneProjectConfiguration),
  }),
);
const decodeConfigurationChanged = Schema.decodeUnknownEffect(
  Schema.Struct({ CONFIGURATION: ConveneProjectConfiguration }),
);

export class ConveneConnection extends Context.Service<
  ConveneConnection,
  {
    readonly status: Effect.Effect<ConveneStatus>;
    readonly changes: Stream.Stream<ConveneStatus>;
    readonly synchronize: Effect.Effect<void, ConveneIntegrationError>;
  }
>()("t3/convene/ConveneConnection") {}
type ConnectionState = Omit<ConveneStatus, "platformUrls">;
type ReportWaiter = Deferred.Deferred<void, ConveneIntegrationError>;

declare const __CONVENE_BUILD_ID__: string | null;

/** One module owns the outward connection; native commands remain in T3 services. */
const start = Effect.fn("ConveneConnection.start")(function* (
  state: SubscriptionRef.SubscriptionRef<ConnectionState>,
  requests: Queue.Queue<ReportWaiter>,
) {
  const platform = yield* ConvenePlatform.ConvenePlatform;
  const broker = yield* ConveneMcp.ConveneMcp;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const events = yield* EventStore.OrchestrationEventStore;
  const fs = yield* FileSystem.FileSystem;
  const crypto = yield* Crypto.Crypto;
  const workspaces = yield* ConveneWorkspaces.ConveneWorkspaces;
  const configurationCache = yield* ConveneConfiguration.ConveneConfiguration;
  const connection = yield* platform.readConnection;
  if (Option.isNone(connection)) {
    yield* SubscriptionRef.set(state, {
      phase: "unpaired",
      baseUrl: null,
      runnerId: null,
      error: null,
    });
    return yield* Effect.never;
  }
  const paired = connection.value;
  yield* SubscriptionRef.set(state, {
    phase: "connecting",
    baseUrl: paired.baseUrl,
    runnerId: paired.runnerId,
    error: null,
  });
  const url = new URL(`${paired.baseUrl.replace(/\/$/, "")}/api/v1/execution-runners/ws`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

  const connect = Effect.scoped(
    Effect.gen(function* () {
      const webContext = yield* Layer.build(ConveneWeb.layer);
      const token = yield* platform.accessToken;
      const socket = yield* Socket.makeWebSocket(url.toString(), {
        openTimeout: "10 seconds",
      }).pipe(Effect.provide(NodeSocket.layerWebSocketConstructor));
      const writer = yield* socket.writer;
      const { pull } = yield* socket.reader;
      const send = (message: object) => writer.writeAll([encodeJson(message)]);
      const sendMessage = Effect.fn("ConveneConnection.sendMessage")(function* (
        type: string,
        payload: object,
        id?: string,
      ) {
        yield* send({
          PROTOCOL_VERSION: 1,
          TYPE: type,
          MESSAGE_ID: id ?? (yield* crypto.randomUUIDv4()),
          OCCURRED_AT: DateTime.formatIso(yield* DateTime.now),
          RUNNER_ID: paired.runnerId,
          PAYLOAD: payload,
        });
      });
      const readDirectory = Effect.fn("ConveneConnection.readDirectory")(function* () {
        const current = yield* projects.list();
        const projected = yield* Effect.forEach(current, (project) =>
          Effect.gen(function* () {
            const stat = yield* fs.stat(project.workspaceRoot).pipe(Effect.option);
            const available = Option.isSome(stat) && stat.value.type === "Directory";
            const fields = {
              NATIVE_PROJECT_KIND: "t3_project",
              NATIVE_PROJECT_ID: project.projectId,
              EXECUTION_HOST_ID: "local",
              DISPLAY_NAME: project.title,
              AVAILABILITY: available ? "AVAILABLE" : "UNAVAILABLE",
              UNAVAILABLE_REASON: available
                ? null
                : {
                    CODE: "WORKSPACE_UNAVAILABLE",
                    MESSAGE: "The project directory is unavailable.",
                  },
              UPDATED_AT: project.updatedAt,
            };
            const locations = yield* workspaces.list(project.projectId);
            return {
              project: fields,
              targets: locations.map((workspace) => ({
                ...fields,
                TARGET_ID: `t3:${paired.runnerId}:project:${project.projectId}:${workspace.key}`,
                NATIVE_WORKSPACE_KEY: workspace.key,
                PATH: workspace.path,
                WORKSPACE_DISPLAY_NAME: workspace.displayName,
                AVAILABILITY: workspace.available ? "AVAILABLE" : "UNAVAILABLE",
                UNAVAILABLE_REASON: workspace.available
                  ? null
                  : {
                      CODE: "WORKSPACE_UNAVAILABLE",
                      MESSAGE: "This workspace is unavailable.",
                    },
                REPOSITORY: null,
                BRANCH: workspace.branch,
                AGENT_TYPE: null,
              })),
            };
          }),
        );
        return {
          PROJECTS: projected
            .map((item) => item.project)
            .sort((a, b) => a.NATIVE_PROJECT_ID.localeCompare(b.NATIVE_PROJECT_ID)),
          TARGETS: projected
            .flatMap((item) => item.targets)
            .sort((a, b) => a.TARGET_ID.localeCompare(b.TARGET_ID)),
        };
      });
      type Directory = Effect.Success<ReturnType<typeof readDirectory>>;
      const sameProject = (
        left: Directory["PROJECTS"][number],
        right: Directory["PROJECTS"][number],
      ) =>
        left.NATIVE_PROJECT_ID === right.NATIVE_PROJECT_ID &&
        left.DISPLAY_NAME === right.DISPLAY_NAME &&
        left.AVAILABILITY === right.AVAILABILITY;
      const sameDirectory = (left: Directory, right: Directory) =>
        left.PROJECTS.length === right.PROJECTS.length &&
        left.TARGETS.length === right.TARGETS.length &&
        left.PROJECTS.every((item, index) => sameProject(item, right.PROJECTS[index]!)) &&
        left.TARGETS.every((item, index) => {
          const other = right.TARGETS[index]!;
          return (
            sameProject(item, other) &&
            item.TARGET_ID === other.TARGET_ID &&
            item.NATIVE_WORKSPACE_KEY === other.NATIVE_WORKSPACE_KEY &&
            item.PATH === other.PATH &&
            item.WORKSPACE_DISPLAY_NAME === other.WORKSPACE_DISPLAY_NAME &&
            item.BRANCH === other.BRANCH
          );
        });
      let lastReported: Directory | undefined;
      const reportLock = yield* Semaphore.make(1);
      const report = Effect.fn("ConveneConnection.report")(function* (id?: string) {
        yield* reportLock.withPermit(
          Effect.gen(function* () {
            const directory = yield* readDirectory();
            if (id === undefined && lastReported && sameDirectory(lastReported, directory)) return;
            yield* sendMessage("TARGETS_REPORT", directory, id);
            lastReported = directory;
          }),
        );
      });
      yield* send({ TYPE: "AUTHENTICATE", TOKEN: token });
      yield* sendMessage("HELLO", {
        CLIENT_TYPE: "t3",
        CLIENT_VERSION: packageJson.version,
        RUNNER_BUILD_ID:
          (typeof __CONVENE_BUILD_ID__ !== "undefined" && __CONVENE_BUILD_ID__) ||
          `convene-t3-${packageJson.version}`,
        SUPPORTED_PROTOCOLS: CONVENE_SUPPORTED_PROTOCOLS,
      });
      const configurations = new Map<string, ConvenePlatform.Configuration>();
      const dataChannels = new Map<string, Fiber.Fiber<void, unknown>>();
      const pendingReports = new Map<string, ReportWaiter>();
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          for (const waiter of pendingReports.values())
            yield* Deferred.fail(
              waiter,
              new ConveneIntegrationError({ operation: "refresh", code: "DISCONNECTED" }),
            );
          yield* broker.configure([]);
        }),
      );
      const applyConfigurations = Effect.fn("ConveneConnection.applyConfigurations")(function* (
        next: ReadonlyArray<ConvenePlatform.Configuration>,
        replace: boolean,
      ) {
        if (replace) configurations.clear();
        for (const config of next) configurations.set(config.client_project_id, config);
        yield* broker.configure([...configurations.values()]);
      });
      const cacheUpdates = yield* Queue.unbounded<{
        values: ReadonlyArray<typeof ConveneProjectConfiguration.Type>;
        replace: boolean;
        reportId?: string;
      }>();
      const persistConfigurations = Stream.fromQueue(cacheUpdates).pipe(
        Stream.runForEach((update) =>
          Effect.gen(function* () {
            yield* configurationCache.record(update.values, update.replace);
            if (update.reportId !== undefined) {
              yield* SubscriptionRef.set(state, {
                phase: "online",
                baseUrl: paired.baseUrl,
                runnerId: paired.runnerId,
                error: null,
              });
              const waiter = pendingReports.get(update.reportId);
              if (waiter) {
                yield* Deferred.succeed(waiter, undefined);
                pendingReports.delete(update.reportId);
              }
            }
          }),
        ),
      );
      const readControl = Effect.gen(function* () {
        let ready = false;
        while (true) {
          for (const frame of yield* pull) {
            if (typeof frame !== "string" && !(frame instanceof Uint8Array)) continue;
            const text = typeof frame === "string" ? frame : new TextDecoder().decode(frame);
            const raw = yield* decodeMessageType(text);
            if (raw.TYPE === "OPEN_DATA_CHANNEL" || raw.TYPE === "CANCEL_DATA_CHANNEL") {
              const control = yield* decodeDataControl(text);
              if (control.TYPE === "CANCEL_DATA_CHANNEL") {
                const fiber = dataChannels.get(control.REQUEST_ID);
                if (fiber) yield* Fiber.interrupt(fiber).pipe(Effect.forkScoped);
              } else {
                const fiber = yield* ConveneDataChannel.open(paired.baseUrl, control).pipe(
                  Effect.provide(webContext),
                  Effect.scoped,
                  Effect.tapError((error) =>
                    Effect.logWarning("Convene native data connection failed", error),
                  ),
                  Effect.ensuring(Effect.sync(() => dataChannels.delete(control.REQUEST_ID))),
                  Effect.forkScoped,
                );
                dataChannels.set(control.REQUEST_ID, fiber);
              }
              continue;
            }
            const message = yield* decodeControlMessage(text);
            if (message.TYPE === "HELLO_REJECT") {
              yield* Effect.logWarning(
                "Convene rejected the integration protocol",
                message.PAYLOAD,
              );
              return yield* new ConveneIntegrationError({
                operation: "connect",
                code: "PROTOCOL_REJECTED",
              });
            }
            if (message.TYPE === "HELLO_ACK" && !ready) {
              const ack = yield* decodeHelloAck(message.PAYLOAD);
              ready = true;
              const afterSequence = yield* events.latestApplicationSequence;
              yield* report();
              yield* sendMessage("HEARTBEAT", {}).pipe(
                Effect.repeat(Schedule.spaced(`${ack.HEARTBEAT_INTERVAL_SECONDS} seconds`)),
                Effect.forkScoped,
              );
              // External Git worktree edits and directory loss/recovery have no
              // project event. Keep local discovery without uploading an unchanged catalog.
              yield* report().pipe(
                Effect.repeat(Schedule.spaced("15 seconds")),
                Effect.delay("15 seconds"),
                Effect.forkScoped,
              );
              yield* events.streamApplicationEvents({ afterSequence }).pipe(
                Stream.filter(
                  (event) => "aggregateKind" in event && event.aggregateKind === "project",
                ),
                Stream.runForEach(() => report()),
                Effect.forkScoped,
              );
              yield* workspaces.changes.pipe(
                Stream.runForEach(() => report()),
                Effect.forkScoped,
              );
              yield* Stream.fromQueue(requests).pipe(
                Stream.runForEach((waiter) =>
                  Effect.gen(function* () {
                    const id = yield* crypto.randomUUIDv4();
                    pendingReports.set(id, waiter);
                    yield* report(id).pipe(
                      Effect.catch((cause) =>
                        Effect.gen(function* () {
                          yield* Deferred.fail(
                            waiter,
                            new ConveneIntegrationError({
                              operation: "refresh",
                              code: "REPORT_FAILED",
                              cause,
                            }),
                          );
                          pendingReports.delete(id);
                        }),
                      ),
                    );
                  }),
                ),
                Effect.forkScoped,
              );
            } else if (message.TYPE === "TARGETS_REPORT_ACK") {
              const ack = yield* decodeReportAck(message.PAYLOAD);
              yield* applyConfigurations(ack.CONFIGURATIONS, true);
              yield* Queue.offer(cacheUpdates, {
                values: ack.CONFIGURATIONS,
                replace: true,
                reportId: ack.REPORT_ID,
              });
            } else if (message.TYPE === "CONFIGURATION_CHANGED") {
              const changed = yield* decodeConfigurationChanged(message.PAYLOAD);
              yield* applyConfigurations([changed.CONFIGURATION], false);
              yield* Queue.offer(cacheUpdates, {
                values: [changed.CONFIGURATION],
                replace: false,
              });
            }
          }
        }
      });
      // Cache writes and cancelled HTTP finalizers must not hold up OPEN_DATA_CHANNEL.
      // Both workers stay owned by this connection; a cache failure still reconnects it.
      yield* Effect.raceFirst(readControl, persistConfigurations);
    }),
  );
  return yield* connect.pipe(
    Effect.tapError(() =>
      SubscriptionRef.set(state, {
        phase: "offline",
        baseUrl: paired.baseUrl,
        runnerId: paired.runnerId,
        error: "Connection unavailable. Check the platform and reconnect.",
      }),
    ),
    Effect.retry({ schedule: Schedule.spaced("3 seconds") }),
  );
});

export const readConvenePlatformUrls = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const server = yield* ServerConfig.ServerConfig;
  // A configured distribution owns its presets; stale QA files must not hide them.
  // Generic development builds can still supply their environment-local configuration.
  if (server.convenePlatformUrls?.length) return server.convenePlatformUrls;
  const filename = path.join(server.stateDir, "convene-platforms.json");
  return (yield* fs.exists(filename))
    ? yield* fs.readFileString(filename).pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Schema.String))),
        ),
        Effect.catch(() =>
          Effect.logWarning(
            "Could not read Convene platform presets; custom addresses remain available.",
          ).pipe(Effect.as([])),
        ),
      )
    : (server.convenePlatformUrls ?? []);
});

const make = Effect.gen(function* () {
  const platformUrls = yield* readConvenePlatformUrls;
  const withPresets = (value: ConnectionState): ConveneStatus => ({ ...value, platformUrls });
  const platform = yield* ConvenePlatform.ConvenePlatform;
  const state = yield* SubscriptionRef.make<ConnectionState>({
    phase: "unpaired",
    baseUrl: null,
    runnerId: null,
    error: null,
  });
  const desktop = yield* DesktopTelemetryReceiver.DesktopTelemetryReceiver;
  yield* SubscriptionRef.changes(state).pipe(
    Stream.map((connection) => connection.baseUrl),
    Stream.changes,
    Stream.runForEach((baseUrl) =>
      desktop.setConveneUpdateSource(baseUrl).pipe(
        Effect.catchTags({
          DesktopTelemetryControlFailed: () =>
            Effect.logWarning("Could not report the Convene update source to the desktop."),
          DesktopTelemetryControlStalled: () =>
            Effect.logWarning("Could not report the Convene update source to the desktop."),
        }),
      ),
    ),
    Effect.forkScoped,
  );
  const requests = yield* Queue.unbounded<ReportWaiter>();
  const changes = yield* PubSub.subscribe(platform.changes);
  yield* Effect.gen(function* () {
    while (true) {
      yield* Effect.raceFirst(start(state, requests), PubSub.take(changes));
      for (const waiter of yield* Queue.clear(requests)) {
        yield* Deferred.fail(
          waiter,
          new ConveneIntegrationError({ operation: "refresh", code: "DISCONNECTED" }),
        );
      }
    }
  }).pipe(Effect.forkScoped);
  const synchronize = Effect.fn("ConveneConnection.synchronize")(function* () {
    if ((yield* SubscriptionRef.get(state)).phase !== "online")
      return yield* new ConveneIntegrationError({ operation: "refresh", code: "OFFLINE" });
    const waiter = yield* Deferred.make<void, ConveneIntegrationError>();
    yield* Queue.offer(requests, waiter);
    yield* Deferred.await(waiter);
  });
  const broker = yield* ConveneMcp.ConveneMcp;
  yield* broker.setSynchronizer(
    Effect.gen(function* () {
      if ((yield* SubscriptionRef.get(state)).phase === "online") yield* synchronize();
    }),
  );
  yield* Effect.addFinalizer(() => broker.setSynchronizer(null));
  return ConveneConnection.of({
    status: SubscriptionRef.get(state).pipe(Effect.map(withPresets)),
    changes: SubscriptionRef.changes(state).pipe(Stream.map(withPresets)),
    synchronize: synchronize(),
  });
});

export const layer = Layer.effect(ConveneConnection, make);
