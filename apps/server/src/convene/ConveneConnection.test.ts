import { assert, it } from "@effect/vitest";
import {
  EventId,
  IsoDateTime,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ApplicationStoredEvent,
  type ConveneProjectConfiguration,
  type OrchestrationV2AppThread,
} from "@t3tools/contracts";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Queue from "effect/Queue";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import * as Socket from "effect/socket/Socket";
import { FetchHttpClient, HttpRouter, HttpServer, HttpServerRequest } from "effect/http";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as EventStore from "../persistence/OrchestrationEventStore.ts";
import * as ConveneConfiguration from "./ConveneConfiguration.ts";
import * as ConveneConnection from "./ConveneConnection.ts";
import * as ConveneMcp from "./ConveneMcp.ts";
import * as ConveneNative from "./ConveneNative.ts";
import * as ConvenePlatform from "./ConvenePlatform.ts";
import * as ConveneWorkspaces from "./ConveneWorkspaces.ts";
import * as DesktopTelemetryReceiver from "../resourceTelemetry/DesktopTelemetryReceiver.ts";

const decode = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

const decodeReportedTargets = Schema.decodeUnknownEffect(
  Schema.Struct({
    TARGETS: Schema.Array(
      Schema.Struct({ NATIVE_WORKSPACE_KEY: Schema.String, AVAILABILITY: Schema.String }),
    ),
  }),
);

it.live("gates a prepared worktree's first MCP lease on its matching control ACK", () =>
  Effect.gen(function* () {
    const projectId = ProjectId.make("first-mcp-project");
    const threadId = ThreadId.make("first-mcp-thread");
    const now = yield* DateTime.now;
    const thread: OrchestrationV2AppThread = {
      id: threadId,
      projectId,
      title: "First MCP",
      createdBy: "agent",
      creationSource: "mcp",
      providerInstanceId: ProviderInstanceId.make("codex"),
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: null },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "worktree",
      worktreePath: `${process.cwd()}/prepared`,
      activeProviderThreadId: null,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    };
    const target = {
      target_id: "first-target",
      native_workspace_key: "prepared-worktree",
      path: thread.worktreePath,
      workspace_display_name: "Prepared worktree",
      branch: thread.branch,
      availability: "AVAILABLE" as const,
    };
    const configuration: ConveneProjectConfiguration = {
      runner_id: "runner",
      runner_name: "Controlled",
      client_project_id: "platform-project",
      project: { native_project_id: projectId, display_name: "First MCP" },
      targets: [],
      bindings: [],
      mcp_enabled: true,
      mcp_scope_modules: [],
      mcp_capabilities: { code_graph_enabled: true, forge_enabled: true, issue_enabled: true },
      mcp_scope_details: [],
      binding_module_details: [],
    };
    const reported = { ...configuration, targets: [target] };
    const reports = yield* Queue.unbounded<{ id: unknown; payload: unknown }>();
    const stored = yield* Queue.unbounded<ReadonlyArray<ConveneProjectConfiguration>>();
    const control = yield* Queue.unbounded<object | Socket.CloseEvent>();
    const platformChanges = yield* PubSub.unbounded<void>();
    let workspacePrepared = false;
    let rememberedKey: string | null = null;
    let rememberCount = 0;
    let reportCount = 0;
    const serverContext = yield* Layer.build(
      HttpRouter.serve(
        HttpRouter.add(
          "GET",
          "/api/v1/execution-runners/ws",
          Effect.gen(function* () {
            const socket = yield* (yield* HttpServerRequest.HttpServerRequest).upgrade;
            const { pull } = yield* socket.reader;
            const writer = yield* socket.writer;
            const send = (message: object) => writer.write(JSON.stringify(message));
            yield* Stream.fromQueue(control).pipe(
              Stream.runForEach((message) =>
                message instanceof Socket.CloseEvent ? writer.write(message) : send(message),
              ),
              Effect.forkScoped,
            );
            while (true)
              for (const frame of yield* pull) {
                const message = yield* decode(frame);
                if (message.TYPE === "HELLO")
                  yield* send({ TYPE: "HELLO_ACK", PAYLOAD: { HEARTBEAT_INTERVAL_SECONDS: 15 } });
                if (message.TYPE === "TARGETS_REPORT") {
                  reportCount++;
                  yield* Queue.offer(reports, { id: message.MESSAGE_ID, payload: message.PAYLOAD });
                }
              }
          }),
        ),
        { disableListenLog: true },
      ).pipe(Layer.provideMerge(NodeHttpServer.layerTest)),
    );
    const server = Context.get(serverContext, HttpServer.HttpServer);
    const dependencies = Layer.mergeAll(
      Layer.succeed(HttpServer.HttpServer, server),
      FetchHttpClient.layer,
      Layer.mock(EnvironmentAuth.EnvironmentAuth)({ revokeSession: () => Effect.succeed(true) }),
      Layer.mock(ProjectionStore.ProjectionStoreV2)({ getThread: () => Effect.succeed(thread) }),
      Layer.mock(ConveneNative.ConveneNative)({}),
      Layer.mock(ConvenePlatform.ConvenePlatform)({
        readConnection: Effect.succeedSome({
          baseUrl: HttpServer.formatAddress(server.address),
          runnerId: "runner",
          refreshCredential: "controlled",
        }),
        accessToken: Effect.succeed("controlled"),
        changes: platformChanges,
      }),
      Layer.mock(ProjectStore.ProjectStoreV2)({
        list: () =>
          Effect.succeed([
            {
              projectId,
              title: "First MCP",
              workspaceRoot: process.cwd(),
              defaultModelSelection: null,
              defaultThreadEnvMode: null,
              autoPull: false,
              faviconPath: null,
              projectIcon: null,
              scripts: [],
              createdAt: IsoDateTime.make("2026-10-28T00:00:00.000Z"),
              updatedAt: IsoDateTime.make("2026-10-28T00:00:00.000Z"),
              deletedAt: null,
            },
          ]),
      }),
      Layer.mock(EventStore.OrchestrationEventStore)({
        latestApplicationSequence: Effect.succeed(0),
        streamApplicationEvents: () => Stream.never,
      }),
      Layer.mock(ConveneWorkspaces.ConveneWorkspaces)({
        list: () =>
          Effect.sync(() =>
            workspacePrepared
              ? [
                  {
                    projectId,
                    key: target.native_workspace_key,
                    path: target.path!,
                    branch: target.branch,
                    displayName: target.workspace_display_name,
                    available: true,
                  },
                ]
              : [],
          ),
        threadKey: () => Effect.sync(() => rememberedKey),
        rememberThread: (_projectId, _threadId, key) =>
          Effect.sync(() => {
            rememberedKey = key;
            rememberCount++;
          }),
        changes: Stream.never,
      }),
      Layer.mock(ConveneConfiguration.ConveneConfiguration)({
        record: (values) => Queue.offer(stored, values).pipe(Effect.asVoid),
      }),
      DesktopTelemetryReceiver.layerTest(),
    );
    yield* Effect.gen(function* () {
      const connection = yield* ConveneConnection.ConveneConnection;
      const broker = yield* ConveneMcp.ConveneMcp;
      const ack = (id: unknown, configurations: ReadonlyArray<ConveneProjectConfiguration>) =>
        Queue.offer(control, {
          TYPE: "TARGETS_REPORT_ACK",
          PAYLOAD: { REPORT_ID: id, CONFIGURATIONS: configurations },
        });
      const initial = yield* Queue.take(reports);
      yield* ack(initial.id, [configuration]);
      yield* connection.changes.pipe(
        Stream.filter((state) => state.phase === "online"),
        Stream.take(1),
        Stream.runDrain,
      );
      yield* Queue.take(stored);
      workspacePrepared = true;
      const preparing = yield* broker.prepare(threadId, "first-session").pipe(Effect.forkScoped);
      const first = yield* Queue.take(reports);
      assert.ok(
        (yield* decodeReportedTargets(first.payload)).TARGETS.some(
          (item) => item.NATIVE_WORKSPACE_KEY === target.native_workspace_key,
        ),
      );
      yield* ack("unrelated-report", [reported]);
      yield* Queue.take(stored);
      assert.equal(preparing.pollUnsafe(), undefined);
      assert.equal(rememberCount, 0);
      yield* ack(first.id, [reported]);
      const contribution = (yield* Fiber.join(preparing)).convene!;
      yield* Queue.take(stored);
      assert.equal(rememberedKey, target.native_workspace_key);
      assert.equal(rememberCount, 1);
      assert.deepEqual((yield* broker.prepare(threadId, "first-session")).convene, contribution);
      assert.equal(reportCount, 2);
      yield* broker.release(threadId, "first-session");
      assert.equal(
        (yield* broker.forward(
          HttpServerRequest.fromWeb(
            new Request(contribution.endpoint, {
              headers: { Authorization: contribution.authorizationHeader },
            }),
          ),
        )).status,
        401,
      );

      yield* ack("catalog-without-worktree", [configuration]);
      yield* Queue.take(stored);
      const cancelled = yield* broker
        .prepare(threadId, "cancelled-session")
        .pipe(Effect.forkScoped);
      const cancelledReport = yield* Queue.take(reports);
      yield* Fiber.interrupt(cancelled);
      yield* ack(cancelledReport.id, [reported]);
      yield* Queue.take(stored);
      assert.equal(rememberCount, 2);
      assert.isDefined((yield* broker.prepare(threadId, "retry-session")).convene);
      assert.equal(reportCount, 3);

      yield* ack("catalog-before-revocation", [configuration]);
      yield* Queue.take(stored);
      const revoked = yield* broker.prepare(threadId, "revoked-session").pipe(Effect.forkScoped);
      const revokedReport = yield* Queue.take(reports);
      yield* ack(revokedReport.id, [{ ...reported, mcp_enabled: false }]);
      assert.equal(
        (yield* Fiber.join(revoked).pipe(Effect.flip)).category,
        "workspace_unavailable",
      );
      yield* Queue.take(stored);
      assert.equal(rememberCount, 3);

      yield* ack("catalog-before-disconnect", [configuration]);
      yield* Queue.take(stored);
      const disconnected = yield* broker
        .prepare(threadId, "disconnected-session")
        .pipe(Effect.forkScoped);
      yield* Queue.take(reports);
      yield* Queue.offer(control, new Socket.CloseEvent(1012));
      const failure = yield* Fiber.join(disconnected).pipe(Effect.flip);
      assert.equal(failure.category, "workspace_unavailable");
      assert.equal(rememberCount, 3);
    }).pipe(
      Effect.provide(
        ConveneConnection.layer.pipe(
          Layer.provideMerge(ConveneMcp.layer),
          Layer.provide(dependencies),
        ),
      ),
    );
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-first-mcp-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
    Effect.scoped,
    Effect.provide(TestClock.layer()),
  ),
);

it.live("keeps heartbeat, changed directories, refresh ACKs, and reconnection independent", () =>
  Effect.gen(function* () {
    const cacheStarted = yield* Deferred.make<void>();
    const releaseCache = yield* Deferred.make<void>();
    const dataBound = yield* Deferred.make<void>();
    const updateSource = yield* Deferred.make<string>();
    const workspaceReported = yield* Deferred.make<void>();
    const workspaceChanges = yield* PubSub.unbounded<void>();
    const projectChanges = yield* PubSub.unbounded<ApplicationStoredEvent>();
    const platformChanges = yield* PubSub.unbounded<void>();
    const heartbeats = yield* Queue.unbounded<void>();
    const reports = yield* Queue.unbounded<Schema.Json>();
    const control = yield* Queue.unbounded<object | Socket.CloseEvent>();
    const applied = yield* Queue.unbounded<ReadonlyArray<ConvenePlatform.Configuration>>();
    let mcpSynchronize: Parameters<ConveneMcp.ConveneMcp["Service"]["setSynchronizer"]>[0] = null;
    const wrongAck = yield* Deferred.make<void>();
    const releaseAck = yield* Deferred.make<void>();
    const projectId = ProjectId.make("recovery-report-project");
    let workspaceKey = "root";
    let available = true;
    let title = "Recovery report";
    let includeProject = true;
    let updatedAt = IsoDateTime.make("2026-10-22T00:00:00.000Z");
    let reverse = false;
    let externalKey: string | null = null;
    let holdAck = false;
    let reportCount = 0;
    let helloCount = 0;
    const configuration: ConveneProjectConfiguration = {
      runner_id: "runner",
      runner_name: "Controlled",
      client_project_id: "platform-project",
      project: { native_project_id: projectId, display_name: title },
      targets: [],
      bindings: [],
      mcp_enabled: true,
      mcp_scope_modules: [],
      mcp_capabilities: { code_graph_enabled: true, forge_enabled: true, issue_enabled: true },
      mcp_scope_details: [],
      binding_module_details: [],
    };
    let configurations: ReadonlyArray<ConveneProjectConfiguration> = [configuration];
    const routes = Layer.mergeAll(
      HttpRouter.add(
        "GET",
        "/api/v1/execution-runners/ws",
        Effect.gen(function* () {
          const socket = yield* (yield* HttpServerRequest.HttpServerRequest).upgrade;
          const { pull } = yield* socket.reader;
          const writer = yield* socket.writer;
          const send = (message: object) => writer.write(JSON.stringify(message));
          yield* Stream.fromQueue(control).pipe(
            Stream.runForEach((message) =>
              message instanceof Socket.CloseEvent ? writer.write(message) : send(message),
            ),
            Effect.forkScoped,
          );
          let dataChannelRequested = false;
          while (true)
            for (const frame of yield* pull) {
              const message = yield* decode(frame);
              if (message.TYPE === "HELLO") {
                helloCount++;
                yield* send({ TYPE: "HELLO_ACK", PAYLOAD: { HEARTBEAT_INTERVAL_SECONDS: 15 } });
              }
              if (message.TYPE === "HEARTBEAT") {
                assert.equal(message.PROTOCOL_VERSION, 1);
                assert.deepEqual(message.PAYLOAD, {});
                yield* send({ TYPE: "HEARTBEAT_ACK", PAYLOAD: {} });
                yield* Queue.offer(heartbeats, undefined);
              }
              if (message.TYPE === "TARGETS_REPORT") {
                reportCount++;
                if (holdAck) {
                  yield* send({
                    TYPE: "TARGETS_REPORT_ACK",
                    PAYLOAD: { REPORT_ID: "unrelated-report", CONFIGURATIONS: configurations },
                  });
                  yield* Deferred.succeed(wrongAck, undefined);
                  yield* Deferred.await(releaseAck);
                  holdAck = false;
                }
                yield* send({
                  TYPE: "TARGETS_REPORT_ACK",
                  PAYLOAD: { REPORT_ID: message.MESSAGE_ID, CONFIGURATIONS: configurations },
                });
                yield* Queue.offer(reports, message.PAYLOAD as Schema.Json);
                const report = yield* decodeReportedTargets(message.PAYLOAD);
                if (report.TARGETS.some((target) => target.NATIVE_WORKSPACE_KEY === "rebound-key"))
                  yield* Deferred.succeed(workspaceReported, undefined);
                if (!dataChannelRequested) {
                  dataChannelRequested = true;
                  yield* Deferred.await(cacheStarted);
                  yield* send({
                    TYPE: "OPEN_DATA_CHANNEL",
                    REQUEST_ID: "read",
                    CONNECTION_ID: "control",
                    KIND: "HTTP",
                  });
                }
              }
            }
        }),
      ),
      HttpRouter.add(
        "GET",
        "/api/v1/execution-runners/data",
        Effect.gen(function* () {
          const socket = yield* (yield* HttpServerRequest.HttpServerRequest).upgrade;
          const { pull } = yield* socket.reader;
          while (true)
            for (const frame of yield* pull) {
              if ((yield* decode(frame)).TYPE === "BIND_DATA_CHANNEL") {
                yield* Deferred.succeed(dataBound, undefined);
                return yield* Effect.never;
              }
            }
        }),
      ),
    );
    const serverContext = yield* Layer.build(
      HttpRouter.serve(routes, { disableListenLog: true }).pipe(
        Layer.provideMerge(NodeHttpServer.layerTest),
      ),
    );
    const server = Context.get(serverContext, HttpServer.HttpServer);
    const dependencies = Layer.mergeAll(
      Layer.succeed(HttpServer.HttpServer, server),
      FetchHttpClient.layer,
      Layer.mock(EnvironmentAuth.EnvironmentAuth)({ revokeSession: () => Effect.succeed(true) }),
      Layer.mock(ConvenePlatform.ConvenePlatform)({
        readConnection: Effect.succeedSome({
          baseUrl: HttpServer.formatAddress(server.address),
          runnerId: "runner",
          refreshCredential: "credential",
        }),
        accessToken: Effect.succeed("access"),
        changes: platformChanges,
      }),
      Layer.mock(ConveneMcp.ConveneMcp)({
        configure: (values) => Queue.offer(applied, values).pipe(Effect.asVoid),
        setSynchronizer: (next) =>
          Effect.sync(() => {
            mcpSynchronize = next;
          }),
      }),
      Layer.mock(ProjectStore.ProjectStoreV2)({
        list: () =>
          Effect.succeed(
            includeProject
              ? [
                  {
                    projectId,
                    title,
                    workspaceRoot: process.cwd(),
                    defaultModelSelection: null,
                    defaultThreadEnvMode: null,
                    autoPull: false,
                    faviconPath: null,
                    projectIcon: null,
                    scripts: [],
                    createdAt: IsoDateTime.make("2026-10-22T00:00:00.000Z"),
                    updatedAt,
                    deletedAt: null,
                  },
                ]
              : [],
          ),
      }),
      Layer.mock(EventStore.OrchestrationEventStore)({
        latestApplicationSequence: Effect.succeed(0),
        streamApplicationEvents: () => Stream.fromPubSub(projectChanges),
      }),
      Layer.mock(ConveneWorkspaces.ConveneWorkspaces)({
        list: () =>
          Effect.sync(() => {
            const items = [
              {
                projectId,
                key: workspaceKey,
                path: process.cwd(),
                branch: "main",
                displayName: "Recovery report",
                available,
              },
              {
                projectId,
                key: "other",
                path: process.cwd(),
                branch: null,
                displayName: "Other",
                available: true,
              },
            ];
            if (externalKey !== null)
              items.push({
                projectId,
                key: externalKey,
                path: `${process.cwd()}/external`,
                branch: "external",
                displayName: "External worktree",
                available: true,
              });
            return reverse ? items.toReversed() : items;
          }),
        changes: Stream.fromPubSub(workspaceChanges),
      }),
      Layer.mock(ConveneNative.ConveneNative)({}),
      Layer.mock(ConveneConfiguration.ConveneConfiguration)({
        record: () =>
          Deferred.succeed(cacheStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseCache)),
          ),
      }),
    );
    yield* Effect.gen(function* () {
      const connection = yield* ConveneConnection.ConveneConnection;
      yield* Deferred.await(dataBound);
      assert.equal(yield* Deferred.await(updateSource), HttpServer.formatAddress(server.address));
      assert.equal((yield* connection.status).phase, "connecting");
      yield* Deferred.succeed(releaseCache, undefined);
      const online = yield* connection.changes.pipe(
        Stream.filter((s) => s.phase === "online"),
        Stream.take(1),
        Stream.runCollect,
      );
      assert.equal(online.length, 1);
      yield* Queue.take(reports);
      yield* Queue.take(heartbeats);
      assert.equal((yield* Queue.take(applied))[0]?.mcp_enabled, true);
      for (let index = 0; index < 60; index++) {
        reverse = !reverse;
        updatedAt = IsoDateTime.make("2026-10-23T00:00:00.000Z");
        yield* TestClock.adjust("15 seconds");
        yield* Queue.take(heartbeats);
        yield* Queue.offer(control, {
          TYPE: "TARGETS_REPORT_ACK",
          PAYLOAD: { REPORT_ID: `same-config:${index}`, CONFIGURATIONS: [configuration] },
        });
        assert.equal(
          (yield* Queue.take(applied))[0]?.client_project_id,
          configuration.client_project_id,
        );
      }
      yield* connection.synchronize;
      yield* Queue.take(reports);
      assert.equal(reportCount, 2);
      const changed = { ...configuration, mcp_enabled: false };
      yield* Queue.offer(control, {
        TYPE: "CONFIGURATION_CHANGED",
        PAYLOAD: { CONFIGURATION: changed },
      });
      // The refresh ACK is ordered before the following control push.
      yield* Queue.take(applied);
      assert.equal((yield* Queue.take(applied))[0]?.mcp_enabled, false);
      configurations = [];
      holdAck = true;
      assert.ok(mcpSynchronize);
      const refresh = yield* mcpSynchronize.pipe(Effect.forkScoped);
      yield* Deferred.await(wrongAck);
      assert.equal(refresh.pollUnsafe(), undefined);
      yield* Deferred.succeed(releaseAck, undefined);
      yield* Fiber.join(refresh);
      yield* Queue.take(reports);
      assert.deepEqual(yield* Queue.take(applied), []);
      assert.deepEqual(yield* Queue.take(applied), []);
      const projectEvent = (): ApplicationStoredEvent => ({
        sequence: 1,
        eventId: EventId.make("project-update"),
        aggregateKind: "project",
        aggregateId: projectId,
        type: "project.meta-updated",
        occurredAt: updatedAt,
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: {},
        payload: { projectId, title, updatedAt },
      });
      // Timestamp-only project events and worktree order do not send a catalog.
      yield* PubSub.publish(projectChanges, projectEvent());
      yield* connection.synchronize;
      yield* Queue.take(reports);
      assert.equal(reportCount, 4);
      title = "Renamed project";
      yield* PubSub.publish(projectChanges, projectEvent());
      yield* Queue.take(reports);
      assert.equal(reportCount, 5);
      includeProject = false;
      yield* PubSub.publish(projectChanges, projectEvent());
      assert.equal((yield* decodeReportedTargets(yield* Queue.take(reports))).TARGETS.length, 0);
      includeProject = true;
      yield* PubSub.publish(projectChanges, projectEvent());
      assert.equal((yield* decodeReportedTargets(yield* Queue.take(reports))).TARGETS.length, 2);
      // No project event exists for external worktree changes or directory recovery.
      externalKey = "external-worktree";
      yield* TestClock.adjust("15 seconds");
      yield* Queue.take(heartbeats);
      assert.ok(
        (yield* decodeReportedTargets(yield* Queue.take(reports))).TARGETS.some(
          (target) => target.NATIVE_WORKSPACE_KEY === externalKey,
        ),
      );
      externalKey = null;
      yield* TestClock.adjust("15 seconds");
      yield* Queue.take(heartbeats);
      assert.equal((yield* decodeReportedTargets(yield* Queue.take(reports))).TARGETS.length, 2);
      available = false;
      yield* TestClock.adjust("15 seconds");
      yield* Queue.take(heartbeats);
      assert.equal(
        (yield* decodeReportedTargets(yield* Queue.take(reports))).TARGETS.find(
          (target) => target.NATIVE_WORKSPACE_KEY === "root",
        )?.AVAILABILITY,
        "UNAVAILABLE",
      );
      available = true;
      yield* TestClock.adjust("15 seconds");
      yield* Queue.take(heartbeats);
      yield* Queue.take(reports);
      workspaceKey = "rebound-key";
      yield* PubSub.publish(workspaceChanges, undefined);
      yield* Deferred.await(workspaceReported);
      yield* Queue.take(reports);
      const beforeReconnect = reportCount;
      yield* Queue.offer(control, new Socket.CloseEvent(1012));
      yield* connection.changes.pipe(
        Stream.filter((s) => s.phase === "offline"),
        Stream.take(1),
        Stream.runDrain,
      );
      yield* TestClock.adjust("3 seconds");
      yield* Queue.take(reports);
      assert.equal(helloCount, 2);
      assert.equal(reportCount, beforeReconnect + 1);
    }).pipe(
      Effect.provide(
        ConveneConnection.layer.pipe(
          Layer.provide(dependencies),
          Layer.provide(
            DesktopTelemetryReceiver.layerTest({
              setConveneUpdateSource: (baseUrl) =>
                baseUrl === null
                  ? Effect.void
                  : Deferred.succeed(updateSource, baseUrl).pipe(Effect.asVoid),
            }),
          ),
        ),
      ),
    );
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-control-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
    Effect.scoped,
    Effect.provide(TestClock.layer()),
  ),
);
