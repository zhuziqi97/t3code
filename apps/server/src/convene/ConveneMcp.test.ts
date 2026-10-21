import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2AppThread,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpClient, HttpClientResponse, HttpServerRequest } from "effect/http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ConvenePlatform from "./ConvenePlatform.ts";
import * as ConveneWorkspaces from "./ConveneWorkspaces.ts";
import * as ConveneMcp from "./ConveneMcp.ts";

it.effect(
  "isolates project grants, rotates authorization, and releases only the owning provider lease",
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
          readConnection: Effect.succeed(Option.none()),
          accessToken: Effect.die("device token must stay in the platform connection service"),
          beginPairing: () => Effect.die("unused"),
          finishPairing: () => Effect.die("unused"),
          disconnect: Effect.void,
          credential: (projectId, targetId) =>
            Effect.sync(() => {
              grants.push(`${projectId}/${targetId}`);
              return {
                mcp_url: `http://platform.test/${projectId}`,
                access_token: `project-grant:${projectId}:${revision}`,
                expires_at: "2099-01-01T00:00:00Z",
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
                new Response("project tools", { headers: { "content-type": "application/json" } }),
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
        yield* broker.release(a, "provider:old");
        assert.equal((yield* forward(first.authorizationHeader)).status, 401);
        assert.equal((yield* forward(replacement.authorizationHeader)).status, 200);
        revision = 2;
        yield* broker.configure([config("a"), config("b", false)]);
        assert.equal((yield* forward(replacement.authorizationHeader)).status, 200);
        assert.equal(forwarded.at(-1)?.auth, "Bearer project-grant:platform:a:2");
        assert.equal((yield* forward(other.authorizationHeader)).status, 403);
        yield* broker.configure([config("a", true, false)]);
        assert.equal((yield* forward(replacement.authorizationHeader)).status, 403);
        const missing = yield* broker.prepare(a, "provider:missing").pipe(Effect.flip);
        assert.equal(missing.category, "workspace_unavailable");
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
    }).pipe(Effect.scoped),
);
