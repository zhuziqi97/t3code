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

it.effect(
  "searches draft projects over runner HTTP and distinguishes empty pages from denied access",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* HttpServer.HttpServer;
        const requests: Array<{ url: string; body: unknown; protocol: string | undefined }> = [];
        const issuePage = {
          items: [
            {
              kind: "issue",
              module_id: "module-a",
              module_path: "team/project/a",
              title: "Issue seven",
              resource_uri: "convene://issues/team/project/a/7",
              number: 7,
              state: "OPEN",
            },
            {
              kind: "issue",
              module_id: "module-b",
              module_path: "team/project/b",
              title: "Another seven",
              resource_uri: "convene://issues/team/project/b/7",
              number: 7,
              state: "CLOSED",
            },
          ],
          total: 22,
          page: 2,
          page_size: 20,
        } as const;
        let reply: { status: number; body: object } = {
          status: 200,
          body: { success: true, data: issuePage },
        };
        yield* server.serve(
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            if (request.url.endsWith("/refresh"))
              return HttpServerResponse.jsonUnsafe({
                success: true,
                data: { access_token: "runner-search-access", expires_in: 600 },
              });
            assert.equal(request.headers.authorization, "Bearer runner-search-access");
            requests.push({
              url: request.url,
              body: yield* request.json,
              protocol: request.headers["client-protocol"],
            });
            return HttpServerResponse.jsonUnsafe(reply.body, { status: reply.status });
          }),
        );
        assert(NetAddress.isInetAddress(server.address));
        const baseUrl = `http://127.0.0.1:${server.address.port}`;
        let paired = true;
        let clientProjectId: string | null = "draft-client-project";
        const layer = ConveneResources.layer.pipe(
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
                            refreshCredential: "fixture",
                          }),
                        ),
                      )
                    : Option.none(),
                ),
            }),
          ),
          Layer.provide(FetchHttpClient.layer),
          Layer.provide(Layer.mock(ProjectionStore.ProjectionStoreV2)({})),
          Layer.provide(
            Layer.mock(ConveneConfiguration.ConveneConfiguration)({
              clientProjectId: (projectId) => {
                assert.equal(projectId, ProjectId.make("draft-project"));
                return Effect.sync(() => clientProjectId);
              },
            }),
          ),
        );
        yield* Effect.gen(function* () {
          const service = yield* ConveneResources.ConveneResources;
          const input = {
            projectId: ProjectId.make("draft-project"),
            kind: "issue" as const,
            query: "7",
            page: 2,
            pageSize: 20,
          };
          assert.deepEqual(yield* service.search(input), { status: "ready", ...issuePage });
          assert.deepEqual(requests[0], {
            url: "/api/v1/execution-runner-resources/search",
            body: {
              client_project_id: "draft-client-project",
              kind: "issue",
              query: "7",
              page: 2,
              page_size: 20,
            },
            protocol: "1.0",
          });
          const documentPage = {
            items: [
              {
                kind: "document",
                module_id: "module-a",
                module_path: "team/project/a",
                title: "Notes",
                resource_uri: "convene://docs/team/project/a/folder/notes.md",
                relative_path: "folder/notes.md",
              },
            ],
            total: 1,
            page: 1,
            page_size: 20,
          } as const;
          reply = { status: 200, body: { success: true, data: documentPage } };
          assert.deepEqual(
            yield* service.search({ ...input, kind: "document", query: "", page: 1 }),
            { status: "ready", ...documentPage },
          );
          const emptyPage = { items: [], total: 0, page: 1, page_size: 20 };
          reply = { status: 200, body: { success: true, data: emptyPage } };
          assert.deepEqual(yield* service.search(input), { status: "ready", ...emptyPage });
          for (const [status, error, expected] of [
            [403, { code: "PERMISSION_DENIED", detail: { reason: "MCP_DISABLED" } }, "mcpDisabled"],
            [
              403,
              { code: "PERMISSION_DENIED", detail: { reason: "CAPABILITY_DISABLED" } },
              "capabilityDisabled",
            ],
            [403, { code: "MCP_SCOPE_INSUFFICIENT" }, "scopeInsufficient"],
            [403, { code: "PERMISSION_DENIED" }, "unauthorized"],
            [401, { code: "RUNNER_CREDENTIAL_INVALID" }, "unauthorized"],
            [401, { code: "RUNNER_REVOKED" }, "unauthorized"],
            [
              404,
              { code: "RESOURCE_NOT_FOUND", detail: { resource_type: "client_project" } },
              "projectUnavailable",
            ],
            [404, { code: "RESOURCE_NOT_FOUND" }, "unavailable"],
            [404, { detail: "Not Found" }, "unavailable"],
            [503, { code: "UNAVAILABLE" }, "unavailable"],
          ] as const) {
            reply = { status, body: { success: false, error } };
            assert.equal((yield* service.search(input)).status, expected);
          }
          const sent = requests.length;
          clientProjectId = null;
          assert.equal((yield* service.search(input)).status, "projectUnavailable");
          paired = false;
          assert.equal((yield* service.search(input)).status, "disconnected");
          assert.equal(requests.length, sent);
        }).pipe(Effect.provide(layer));
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

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
          assert.equal((yield* service.read(input)).status, "unavailable");
          reply = {
            status: 404,
            body: { error: { code: "RESOURCE_NOT_FOUND", detail: { resource_type: "issue" } } },
          };
          assert.equal((yield* service.read(input)).status, "notFound");
          reply = {
            status: 404,
            body: {
              error: { code: "RESOURCE_NOT_FOUND", detail: { resource_type: "issue_comment" } },
            },
          };
          assert.equal((yield* service.read(input)).status, "notFound");
          reply = { status: 404, body: { error: { code: "MODULE_NOT_FOUND" } } };
          assert.equal((yield* service.read(input)).status, "notFound");
          reply = { status: 404, body: { detail: "Not Found" } };
          assert.equal((yield* service.read(input)).status, "unavailable");
          const beforeDisconnect = requests.length;
          paired = false;
          assert.equal((yield* service.read(input)).status, "disconnected");
          assert.equal(requests.length, beforeDisconnect);
        }).pipe(Effect.provide(serviceLayer));
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);
