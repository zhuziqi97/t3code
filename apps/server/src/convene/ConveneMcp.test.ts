import { assert, it } from "@effect/vitest";
import {
  ConveneIntegrationError,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2AppThread,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Clock from "effect/Clock";
import * as TestClock from "effect/testing/TestClock";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Layer from "effect/Layer";
import * as NetAddress from "effect/net/NetAddress";

import { HttpClient, HttpClientResponse, HttpServer, HttpServerRequest } from "effect/http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ConvenePlatform from "./ConvenePlatform.ts";
import * as ConveneWorkspaces from "./ConveneWorkspaces.ts";
import * as ConveneMcp from "./ConveneMcp.ts";

it.effect.each([
  "available",
  "missing",
  "unavailable",
  "revoked",
  "project-removed",
  "workspace-removed",
  "workspace-replaced",
  "thread-rebound",
  "cancelled",
  "disconnected",
  "already-reported",
  "already-unavailable",
  "wrong-path",
  "stale-thread-key",
] as const)("prepares a worktree MCP lease using current report state (%s)", (scenario) =>
  Effect.gen(function* () {
    const projectId = ProjectId.make("first-worktree-project");
    const threadId = ThreadId.make("first-worktree-thread");
    const now = yield* DateTime.now;
    const thread: OrchestrationV2AppThread = {
      id: threadId,
      projectId,
      title: "First worktree",
      createdBy: "agent",
      creationSource: "mcp",
      providerInstanceId: ProviderInstanceId.make("codex"),
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: null },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "worktree",
      worktreePath: "/work/first",
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
    const workspace = {
      projectId,
      key: "first-worktree",
      path: thread.worktreePath!,
      available: true,
      branch: thread.branch,
      displayName: "First worktree",
    };
    const configuration: ConvenePlatform.Configuration = {
      client_project_id: "platform-project",
      project: { native_project_id: projectId },
      mcp_enabled: true,
      targets: [],
    };
    const target = {
      target_id: "first-target",
      native_workspace_key: workspace.key,
      path: workspace.path,
      availability: "AVAILABLE" as const,
    };
    const reported = { ...configuration, targets: [target] };
    const reportRequested = yield* Deferred.make<void>();
    const reportApplied = yield* Deferred.make<void>();
    const remembered: string[] = [];
    let currentWorkspace = workspace;
    let threadKey: string | null = scenario === "stale-thread-key" ? "root" : null;
    let reports = 0;
    const dependencies = Layer.mergeAll(
      Layer.mock(ProjectionStore.ProjectionStoreV2)({ getThread: () => Effect.succeed(thread) }),
      Layer.mock(ConveneWorkspaces.ConveneWorkspaces)({
        threadKey: () => Effect.sync(() => threadKey),
        list: () => Effect.sync(() => [currentWorkspace]),
        rememberThread: (_projectId, _threadId, key) =>
          Effect.sync(() => {
            remembered.push(key);
            threadKey = key;
          }),
      }),
      Layer.mock(ConvenePlatform.ConvenePlatform)({ changes: yield* PubSub.unbounded<void>() }),
      Layer.succeed(
        HttpServer.HttpServer,
        HttpServer.HttpServer.of({
          address: NetAddress.inetAddressFromIpStringUnsafe("127.0.0.1", 43123),
          serve: () => Effect.void,
        }),
      ),
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make(() => Effect.die("unused")),
      ),
      NodeServices.layer,
    );
    yield* Effect.gen(function* () {
      const broker = yield* ConveneMcp.ConveneMcp;
      yield* broker.configure([
        scenario === "already-reported"
          ? reported
          : scenario === "already-unavailable"
            ? { ...configuration, targets: [{ ...target, availability: "UNAVAILABLE" }] }
            : scenario === "wrong-path"
              ? { ...configuration, targets: [{ ...target, path: "/another/checkout" }] }
              : configuration,
      ]);
      yield* broker.setSynchronizer(
        Effect.sync(() => reports++).pipe(
          Effect.andThen(Deferred.succeed(reportRequested, undefined)),
          Effect.andThen(Deferred.await(reportApplied)),
          Effect.andThen(
            scenario === "disconnected"
              ? Effect.fail(
                  new ConveneIntegrationError({ operation: "refresh", code: "DISCONNECTED" }),
                )
              : Effect.void,
          ),
        ),
      );
      if (scenario === "already-reported") {
        const first = (yield* broker.prepare(threadId, "first-provider-session")).convene!;
        const reused = (yield* broker.prepare(threadId, "first-provider-session")).convene!;
        assert.deepEqual(reused, first);
        assert.equal(reports, 0);
        return;
      }
      if (
        scenario === "already-unavailable" ||
        scenario === "wrong-path" ||
        scenario === "stale-thread-key"
      ) {
        const failure = yield* broker.prepare(threadId, "first-provider-session").pipe(Effect.flip);
        assert.equal(failure.category, "workspace_unavailable");
        assert.equal(reports, 0);
        assert.deepEqual(remembered, []);
        return;
      }
      const preparing = yield* broker
        .prepare(threadId, "first-provider-session")
        .pipe(Effect.forkChild({ startImmediately: true }));
      assert.equal(preparing.pollUnsafe(), undefined);
      assert.isTrue(yield* Deferred.isDone(reportRequested));
      assert.deepEqual(remembered, []);
      if (scenario === "cancelled") yield* Fiber.interrupt(preparing);
      yield* broker.configure(
        scenario === "project-removed"
          ? []
          : [
              scenario === "missing"
                ? configuration
                : scenario === "revoked"
                  ? { ...reported, mcp_enabled: false }
                  : scenario === "unavailable"
                    ? { ...reported, targets: [{ ...target, availability: "UNAVAILABLE" }] }
                    : reported,
            ],
      );
      if (scenario === "workspace-removed") currentWorkspace = { ...workspace, available: false };
      if (scenario === "workspace-replaced")
        currentWorkspace = { ...workspace, key: "replacement" };
      if (scenario === "thread-rebound") threadKey = "root";
      yield* Deferred.succeed(reportApplied, undefined);
      assert.equal(reports, 1);
      if (scenario === "cancelled") {
        assert.deepEqual(remembered, []);
        const retried = yield* broker.prepare(threadId, "retried-provider-session");
        assert.isDefined(retried.convene);
        assert.deepEqual(remembered, [workspace.key]);
        assert.equal(reports, 1);
        return;
      }
      if (scenario !== "available") {
        const failure = yield* Fiber.join(preparing).pipe(Effect.flip);
        assert.equal(failure.category, "workspace_unavailable");
        assert.deepEqual(remembered, []);
        return;
      }
      const contribution = (yield* Fiber.join(preparing)).convene;
      assert.isDefined(contribution);
      assert.deepEqual(remembered, [workspace.key]);
      yield* broker.release(threadId, "first-provider-session");
      assert.equal(
        (yield* broker.forward(
          HttpServerRequest.fromWeb(
            new Request(contribution!.endpoint, {
              headers: { Authorization: contribution!.authorizationHeader },
            }),
          ),
        )).status,
        401,
      );
    }).pipe(Effect.provide(ConveneMcp.layer.pipe(Layer.provide(dependencies))));
  }).pipe(Effect.scoped),
);

it.effect(
  "reuses project JWTs across 60 ACKs, renews near expiry, and invalidates only their identity",
  () =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const thread = (id: ThreadId): OrchestrationV2AppThread => ({
        id,
        projectId: ProjectId.make(id),
        title: id,
        createdBy: "agent",
        creationSource: "server",
        providerInstanceId: ProviderInstanceId.make("codex"),
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "controlled" },
        runtimeMode: "approval-required",
        interactionMode: "default",
        branch: null,
        worktreePath: id === "a" ? "/work/a" : null,
        activeProviderThreadId: null,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      });
      const grants: Array<string> = [];
      const forwarded: Array<{
        url: string;
        auth: string | undefined;
        method: string | undefined;
        name: string | undefined;
        contentType: string | undefined;
      }> = [];
      let revision = 1;
      let upstreamStatus = 200;
      let credentialGate:
        | { started: Deferred.Deferred<void>; release: Deferred.Deferred<void> }
        | undefined;
      let rememberedKey = "original-worktree";
      const config = (
        id: string,
        enabled = true,
        available = true,
      ): ConvenePlatform.Configuration => ({
        client_project_id: `platform:${id}`,
        project: { native_project_id: id },
        mcp_enabled: enabled,
        targets: [
          {
            target_id: `target:${id}`,
            native_workspace_key: id === "a" ? "original-worktree" : "root",
            path: `/work/${id}`,
            availability: available ? "AVAILABLE" : "UNAVAILABLE",
          },
        ],
      });
      const dependencies = Layer.mergeAll(
        Layer.mock(ConveneWorkspaces.ConveneWorkspaces)({
          threadKey: (_projectId, threadId) =>
            Effect.succeed(threadId === "a" ? rememberedKey : "root"),
          rememberThread: () => Effect.void,
          list: (projectId) =>
            Effect.succeed([
              {
                projectId,
                key: projectId === "a" ? "original-worktree" : "root",
                path: `/work/${projectId}`,
                available: true,
                branch: null,
                displayName: projectId,
              },
            ]),
        }),
        NodeHttpServer.layerTest,
        NodeServices.layer,
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getThread: (id) => Effect.succeed(thread(id)),
        }),
        Layer.mock(ConvenePlatform.ConvenePlatform)({
          changes: yield* PubSub.unbounded<void>(),
          readConnection: Effect.succeedNone,
          accessToken: Effect.die("device token must stay in the platform connection service"),
          beginPairing: () => Effect.die("unused"),
          finishPairing: () => Effect.die("unused"),
          disconnect: Effect.void,
          credential: (projectId, targetId) =>
            Effect.gen(function* () {
              grants.push(`${projectId}/${targetId}`);
              const gate = credentialGate;
              if (gate) {
                yield* Deferred.succeed(gate.started, undefined);
                yield* Deferred.await(gate.release);
              }
              return {
                mcp_url: `http://platform.test/${projectId}`,
                access_token: `project-grant:${projectId}:${revision}`,
                expires_at: DateTime.formatIso(
                  DateTime.makeUnsafe((yield* Clock.currentTimeMillis) + 600_000),
                ),
              };
            }),
        }),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.sync(() => {
              forwarded.push({
                url: request.url,
                auth: request.headers.authorization,
                method: request.headers["mcp-method"],
                name: request.headers["mcp-name"],
                contentType: request.headers["content-type"],
              });
              return HttpClientResponse.fromWeb(
                request,
                new Response("project tools", {
                  status: upstreamStatus,
                  headers: { "content-type": "application/json" },
                }),
              );
            }),
          ),
        ),
      );
      yield* Effect.gen(function* () {
        const broker = yield* ConveneMcp.ConveneMcp;
        const a = ThreadId.make("a"),
          b = ThreadId.make("b");
        const forward = (authorizationHeader: string) =>
          broker.forward(
            HttpServerRequest.fromWeb(
              new Request("http://localhost/convene/mcp", {
                method: "POST",
                headers: {
                  Authorization: authorizationHeader,
                  "content-type": "application/json",
                  "mcp-method": "tools/call",
                  "mcp-name": "get_platform_guideline",
                },
                body: "{}",
              }),
            ),
          );
        yield* broker.configure([config("a"), config("b")]);
        const first = (yield* broker.prepare(a, "provider:old")).convene!;
        const replacement = (yield* broker.prepare(a, "provider:new")).convene!;
        const other = (yield* broker.prepare(b, "provider:b")).convene!;
        assert.notEqual(first.authorizationHeader, other.authorizationHeader);
        assert.equal((yield* forward(first.authorizationHeader)).status, 200);
        assert.equal((yield* forward(other.authorizationHeader)).status, 200);
        assert.deepEqual(
          forwarded.map((r) => r.auth),
          ["Bearer project-grant:platform:a:1", "Bearer project-grant:platform:b:1"],
        );
        assert.deepEqual(grants, ["platform:a/target:a", "platform:b/target:b"]);
        assert.equal(forwarded[0]?.method, "tools/call");
        assert.equal(forwarded[0]?.name, "get_platform_guideline");
        assert.equal(forwarded[0]?.contentType, "application/json");
        for (let index = 0; index < 60; index++) {
          const aValue = config("a");
          const targets = [
            ...aValue.targets,
            { ...aValue.targets[0]!, target_id: "another-target", native_workspace_key: "other" },
          ].map((target) => ({
            ...target,
            branch: `branch:${index}`,
            workspace_display_name: `Name ${index}`,
          }));
          const values = [
            {
              ...aValue,
              project: { ...aValue.project, display_name: `Project ${index}` },
              updated_at: `timestamp:${index}`,
              targets: index % 2 === 0 ? targets : targets.toReversed(),
            },
            config("b"),
          ];
          yield* broker.configure(index % 2 === 0 ? values : values.toReversed());
          yield* TestClock.adjust("1 second");
          assert.equal((yield* forward(replacement.authorizationHeader)).status, 200);
        }
        assert.equal(grants.length, 2);
        yield* TestClock.adjust("509999 millis");
        yield* forward(replacement.authorizationHeader);
        assert.equal(grants.length, 2);
        yield* TestClock.adjust("1 millis");
        revision = 2;
        yield* forward(replacement.authorizationHeader);
        assert.equal(grants.length, 3);
        assert.equal(forwarded.at(-1)?.auth, "Bearer project-grant:platform:a:2");
        yield* broker.release(a, "provider:old");
        assert.equal((yield* forward(first.authorizationHeader)).status, 401);
        assert.equal((yield* forward(replacement.authorizationHeader)).status, 200);
        revision = 3;
        yield* broker.configure([config("a"), config("b", false)]);
        assert.equal((yield* forward(replacement.authorizationHeader)).status, 200);
        assert.equal(forwarded.at(-1)?.auth, "Bearer project-grant:platform:a:2");
        assert.equal((yield* forward(other.authorizationHeader)).status, 403);
        yield* broker.configure([config("a", true, false)]);
        assert.equal((yield* forward(replacement.authorizationHeader)).status, 403);
        const missing = yield* broker.prepare(a, "provider:missing").pipe(Effect.flip);
        assert.equal(missing.category, "workspace_unavailable");
        yield* broker.configure([config("a"), config("b")]);
        yield* forward(replacement.authorizationHeader);
        assert.equal(forwarded.at(-1)?.auth, "Bearer project-grant:platform:a:3");
        yield* forward(other.authorizationHeader);
        const beforeIdentityChange = grants.length;
        const aConfig = config("a");
        yield* broker.configure([
          { ...aConfig, project: { native_project_id: "another-native-project" } },
          config("b"),
        ]);
        assert.equal((yield* forward(replacement.authorizationHeader)).status, 403);
        yield* forward(other.authorizationHeader);
        assert.equal(grants.length, beforeIdentityChange);
        yield* broker.configure([config("a"), config("b")]);
        yield* forward(replacement.authorizationHeader);
        assert.equal(grants.length, beforeIdentityChange + 1);
        // Permission decisions remain upstream on every request with the same JWT.
        upstreamStatus = 403;
        assert.equal((yield* forward(replacement.authorizationHeader)).status, 403);
        assert.equal(grants.length, beforeIdentityChange + 1);
        upstreamStatus = 401;
        const beforeUnauthorized = forwarded.length;
        assert.equal((yield* forward(replacement.authorizationHeader)).status, 401);
        assert.equal(forwarded.length, beforeUnauthorized + 1);
        upstreamStatus = 200;
        yield* forward(replacement.authorizationHeader);
        assert.equal(grants.length, beforeIdentityChange + 2);
        const beforeDisconnect = grants.length;
        yield* broker.configure([]);
        assert.equal((yield* forward(replacement.authorizationHeader)).status, 403);
        yield* broker.configure([config("a"), config("b")]);
        yield* forward(replacement.authorizationHeader);
        yield* forward(other.authorizationHeader);
        assert.equal(grants.length, beforeDisconnect + 2);
        for (const invalid of [
          { ...aConfig, mcp_enabled: false },
          { ...aConfig, client_project_id: "another-platform-project" },
          { ...aConfig, targets: [] },
          {
            ...aConfig,
            targets: aConfig.targets.map((target) => ({ ...target, path: "/moved/a" })),
          },
          {
            ...aConfig,
            targets: aConfig.targets.map((target) => ({
              ...target,
              native_workspace_key: "new-key",
            })),
          },
        ]) {
          const beforeInvalidation = grants.length;
          yield* broker.configure([invalid, config("b")]);
          assert.equal((yield* forward(replacement.authorizationHeader)).status, 403);
          yield* forward(other.authorizationHeader);
          assert.equal(grants.length, beforeInvalidation);
          yield* broker.configure([config("a"), config("b")]);
          yield* forward(replacement.authorizationHeader);
          assert.equal(grants.length, beforeInvalidation + 1);
        }
        yield* broker.configure([]);
        yield* broker.configure([config("a"), config("b")]);
        const gate = {
          started: yield* Deferred.make<void>(),
          release: yield* Deferred.make<void>(),
        };
        credentialGate = gate;
        const pending = yield* forward(replacement.authorizationHeader).pipe(Effect.forkScoped);
        yield* Deferred.await(gate.started);
        yield* broker.configure([config("a", false), config("b")]);
        credentialGate = undefined;
        const beforeLateCredential = forwarded.length;
        yield* Deferred.succeed(gate.release, undefined);
        assert.equal((yield* Fiber.join(pending)).status, 403);
        assert.equal(forwarded.length, beforeLateCredential);
        yield* broker.configure([config("a"), config("b")]);
        const beforeRenewal = grants.length;
        yield* forward(replacement.authorizationHeader);
        assert.equal(grants.length, beforeRenewal + 1);
        const original = config("a");
        yield* broker.configure([
          {
            ...original,
            targets: original.targets.map((target) => ({
              ...target,
              target_id: "replacement-target:a",
              native_workspace_key: "replacement-worktree",
            })),
          },
        ]);
        assert.equal(
          (yield* broker.prepare(a, "replacement-path").pipe(Effect.flip)).category,
          "workspace_unavailable",
        );
        assert.equal((yield* forward(replacement.authorizationHeader)).status, 403);
        yield* broker.configure([config("a"), config("b")]);
        rememberedKey = "replacement-worktree";
        assert.equal((yield* forward(replacement.authorizationHeader)).status, 403);
        assert.equal(
          (yield* broker.prepare(a, "stale-workspace").pipe(Effect.flip)).category,
          "workspace_unavailable",
        );
        assert.equal((yield* forward(other.authorizationHeader)).status, 200);
        yield* broker.release(a);
        assert.equal((yield* forward(replacement.authorizationHeader)).status, 401);
        assert.equal((yield* forward(other.authorizationHeader)).status, 200);
      }).pipe(Effect.provide(ConveneMcp.layer.pipe(Layer.provide(dependencies))));
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);
