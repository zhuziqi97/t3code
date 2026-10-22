import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { assert, it } from "@effect/vitest";
import { OrchestrationV2AppThreadJson, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as Cause from "effect/Cause";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Queue from "effect/Queue";
import * as NetAddress from "effect/net/NetAddress";
import { FetchHttpClient, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ConvenePlatform from "./ConvenePlatform.ts";
import * as ConveneConfiguration from "./ConveneConfiguration.ts";
import * as ConveneResources from "./ConveneResources.ts";

const thread = Schema.decodeUnknownSync(OrchestrationV2AppThreadJson)({
  id: "stopped-thread",
  projectId: "message-project",
  title: "Stopped thread",
  providerInstanceId: "codex",
  modelSelection: { instanceId: "codex", model: null },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  activeProviderThreadId: null,
  lineage: { rootThreadId: "stopped-thread", parentThreadId: null, relationshipToParent: null },
  forkedFrom: null,
  createdAt: "2026-10-23T00:00:00Z",
  updatedAt: "2026-10-23T00:00:00Z",
  archivedAt: null,
  deletedAt: null,
  createdBy: "user",
  creationSource: "web",
});

it.effect(
  "reads through real HTTP using the message project and paired runner, with no agent or MCP lease",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* HttpServer.HttpServer;
        const updates = yield* Queue.unbounded<ProjectId, Cause.Done>();
        const requests: Array<{ body: unknown; authorization: string | undefined }> = [];
        let reply: { status: number; body: object } = {
          status: 200,
          body: {
            success: true,
            data: {
              status: "ready",
              resource_uri: "convene://issues/a/b/c/7/comments/31",
              web_path: "/p/a/b/m/c/issues/7#issuecomment-31",
              issue: {
                number: 7,
                title: "Issue",
                state: "OPEN",
                resource_uri: "convene://issues/a/b/c/7",
              },
              comments: [
                {
                  number: 31,
                  body: "Exact comment",
                  resource_uri: "convene://issues/a/b/c/7/comments/31",
                  is_deleted: false,
                  created_at: "2026-10-23",
                },
              ],
              focused_comment_number: 31,
              page: 1,
              page_size: 20,
              total: 1,
            },
          },
        };
        yield* server.serve(
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            if (request.url.endsWith("/refresh"))
              return HttpServerResponse.jsonUnsafe({
                success: true,
                data: { access_token: "runner-access", expires_in: 600 },
              });
            requests.push({
              body: yield* request.json,
              authorization: request.headers.authorization,
            });
            return HttpServerResponse.jsonUnsafe(reply.body, { status: reply.status });
          }),
        );
        assert(NetAddress.isInetAddress(server.address));
        const baseUrl = `http://127.0.0.1:${server.address.port}`;
        let paired = true;
        const serviceLayer = ConveneResources.layer.pipe(
          Layer.provideMerge(ConvenePlatform.layer),
          Layer.provide(
            Layer.mock(ServerSecretStore.ServerSecretStore)({
              get: () =>
                Effect.sync(() =>
                  paired
                    ? Option.some(
                        new TextEncoder().encode(
                          JSON.stringify({
                            baseUrl,
                            runnerId: "runner",
                            refreshCredential: "fixture-only",
                          }),
                        ),
                      )
                    : Option.none(),
                ),
            }),
          ),
          Layer.provide(FetchHttpClient.layer),
          Layer.provide(
            Layer.mock(ProjectionStore.ProjectionStoreV2)({
              getThread: () => Effect.succeed(thread),
            }),
          ),
          Layer.provide(
            Layer.mock(ConveneConfiguration.ConveneConfiguration)({
              clientProjectId: (projectId) => {
                assert.equal(projectId, ProjectId.make("message-project"));
                return Effect.succeed("actual-client-project");
              },
              changes: Stream.fromQueue(updates),
            }),
          ),
        );
        yield* Effect.gen(function* () {
          const service = yield* ConveneResources.ConveneResources;
          yield* Queue.offerAll(updates, [
            ProjectId.make("unrelated"),
            ProjectId.make("message-project"),
          ]);
          yield* Queue.end(updates);
          assert.deepEqual(yield* service.changes(thread.id).pipe(Stream.runCollect), [0, 1]);
          const input = {
            threadId: ThreadId.make("stopped-thread"),
            uri: "convene://issues/a/b/c/7/comments/31",
            page: 1,
          };
          const first = yield* service.read(input);
          assert.equal(first.status, "ready");
          if (first.status === "ready") {
            assert.equal(first.comments[0]?.body, "Exact comment");
            assert.equal(first.web_url, `${baseUrl}/p/a/b/m/c/issues/7#issuecomment-31`);
          }
          assert.deepEqual(requests, [
            {
              body: { client_project_id: "actual-client-project", uri: input.uri, page: 1 },
              authorization: "Bearer runner-access",
            },
          ]);
          reply = { status: 403, body: { error: { code: "PERMISSION_DENIED" } } };
          assert.equal((yield* service.read(input)).status, "unauthorized");
          reply = { status: 404, body: { error: { code: "RESOURCE_NOT_FOUND" } } };
          assert.equal((yield* service.read(input)).status, "notFound");
          // Old platforms have no route and no business RESOURCE_NOT_FOUND receipt.
          reply = { status: 404, body: { detail: "Not Found" } };
          assert.equal((yield* service.read(input)).status, "unavailable");
          paired = false;
          assert.equal((yield* service.read(input)).status, "disconnected");
          assert.equal(requests.length, 4);
        }).pipe(Effect.provide(serviceLayer));
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);
