import { idleThreadProjection, liveThreadShell } from "../../McpToolAccess.testkit.ts";
import type { OrchestrationV2ServerCommand } from "@t3tools/contracts";
import * as ProjectCloneTracker from "../../../project/ProjectCloneTracker.ts";
import * as PeerLinks from "../../../peer/PeerLinks.ts";
import * as PeerLinkRequests from "../../../peer/PeerLinkRequests.ts";
import * as PeerForwarding from "../../../peer/PeerForwarding.ts";
import * as RemoteDelegation from "../../../peer/RemoteDelegation.ts";
import * as WorktreeMcpService from "../../WorktreeMcpService.ts";
import * as DocumentText from "../../../provider/DocumentText.ts";
import * as EffectOutbox from "../../../orchestration-v2/EffectOutbox.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as ThreadWorkspaceRecovery from "../../../orchestration-v2/ThreadWorkspaceRecovery.ts";
import * as ProjectionStore from "../../../orchestration-v2/ProjectionStore.ts";
import * as DeviceService from "../../../device/DeviceService.ts";
import * as ServerConfig from "../../../config.ts";
import { expect, it } from "@effect/vitest";
import { NodeHttpServer } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpBody, HttpClient, HttpRouter } from "effect/http";

import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as GitWorkflowService from "../../../git/GitWorkflowService.ts";
import * as ProviderAdapterRegistry from "../../../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as PullRequestReviewGuideService from "../../../pullRequest/PullRequestReviewGuideService.ts";
import * as ProjectSetupScriptRunner from "../../../project/ProjectSetupScriptRunner.ts";
import * as ProviderRegistry from "../../../provider/ProviderRegistry.ts";
import * as ScheduledTaskService from "../../../scheduledTasks/ScheduledTaskService.ts";
import * as SecretRequests from "../../../secrets/SecretRequests.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as VcsStatusBroadcaster from "../../../vcs/VcsStatusBroadcaster.ts";
import * as ServerSecretStore from "../../../auth/ServerSecretStore.ts";
import * as ManagedProjectFolders from "../../../project/ManagedProjectFolders.ts";
import * as ThreadLaunchService from "../../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadSearch from "../../../orchestration-v2/ThreadSearch.ts";
import * as PreviewManager from "../../../preview/Manager.ts";
import * as SourceControlRepositoryService from "../../../sourceControl/SourceControlRepositoryService.ts";
import * as GitVcsDriver from "../../../vcs/GitVcsDriver.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpSessionRegistry from "../../McpSessionRegistry.ts";
import * as PreviewAutomationBroker from "../../PreviewAutomationBroker.ts";
import * as PreviewBrowser from "../../../preview/PreviewBrowser.ts";

const layerStubServices = Layer.mergeAll(
  Layer.mock(PeerLinks.PeerLinks)({}),
  Layer.mock(PeerLinkRequests.PeerLinkRequests)({}),
  Layer.mock(PeerForwarding.PeerForwarding)({}),
  Layer.mock(RemoteDelegation.RemoteDelegation)({}),
  Layer.mock(WorktreeMcpService.WorktreeMcpService)({}),
  Layer.mock(DocumentText.DocumentText)({}),
  Layer.mock(Orchestrator.OrchestratorV2)({}),
  Layer.mock(ThreadWorkspaceRecovery.ThreadWorkspaceRecovery)({}),
  Layer.mock(ProjectionStore.ProjectionStoreV2)({}),
  Layer.mock(DeviceService.DeviceService)({}),
  Layer.mock(ProviderRegistry.ProviderRegistry)({}),
  Layer.mock(ProviderAdapterRegistry.ProviderAdapterRegistryV2)({}),
  Layer.mock(ScheduledTaskService.ScheduledTaskService)({}),
  Layer.mock(SecretRequests.SecretRequests)({}),
  Layer.mock(ProjectService.ProjectService)({}),
  Layer.mock(PullRequestReviewGuideService.PullRequestReviewGuideService)({}),
  Layer.mock(ProjectCloneTracker.ProjectCloneTracker)({}),
  ServerSettings.layerTest({}),
  Layer.mock(GitWorkflowService.GitWorkflowService)({}),
  Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({}),
  Layer.mock(VcsStatusBroadcaster.VcsStatusBroadcaster)({}),
  Layer.mock(GitVcsDriver.GitVcsDriver)({}),
  Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({ namedProjectsRoot: "/unused" }),
  Layer.mock(PreviewManager.PreviewManager)({}),
  Layer.mock(ServerSecretStore.ServerSecretStore)({}),
  Layer.mock(SourceControlRepositoryService.SourceControlRepositoryService)({}),
  Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
  Layer.mock(ThreadSearch.ThreadSearch)({}),
  McpProviderSessions.layer,
);

const ToolsListPayload = Schema.fromJsonString(
  Schema.Struct({
    result: Schema.Struct({
      tools: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          inputSchema: Schema.Struct({ type: Schema.optional(Schema.String) }),
          annotations: Schema.optional(
            Schema.Struct({
              readOnlyHint: Schema.optional(Schema.Boolean),
              destructiveHint: Schema.optional(Schema.Boolean),
              openWorldHint: Schema.optional(Schema.Boolean),
            }),
          ),
        }),
      ),
    }),
  }),
);
const decodeToolsListPayload = Schema.decodeUnknownEffect(ToolsListPayload);

it.effect("production mcp layer lists worktree tools over http", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const dispatched: OrchestrationV2ServerCommand[] = [];
      const registryService = yield* McpSessionRegistry.McpSessionRegistry;
      const layerRoutes = McpHttpServer.layer.pipe(
        Layer.provide(Layer.succeed(McpSessionRegistry.McpSessionRegistry, registryService)),
      );
      yield* HttpRouter.serve(layerRoutes, {
        disableListenLog: true,
        disableLogger: true,
      }).pipe(
        Layer.provide(
          Layer.mock(ServerEnvironment.ServerEnvironment)({
            getEnvironmentId: Effect.succeed("environment-scratch" as never),
          }),
        ),
        Layer.provide(PreviewAutomationBroker.layer),
        Layer.provide(PreviewBrowser.layer),
        Layer.provide(Layer.mock(EffectOutbox.EffectOutboxV2)({})),
        Layer.provide(
          Layer.mock(ThreadManagementService.ThreadManagementService)({
            getThreadShell: (id) => Effect.succeed(liveThreadShell(id)),
            getProjectThreadRecords: ({ threadId }) =>
              Effect.succeed(idleThreadProjection(liveThreadShell(threadId))),
            dispatch: (command) =>
              Effect.sync(() => {
                dispatched.push(command);
                return { sequence: 1, storedEvents: [] };
              }),
          }),
        ),
        Layer.provide(layerStubServices),
        Layer.build,
      );

      const registry = registryService.issue({
        threadId: ThreadId.make("thread-scratch"),
        providerInstanceId: ProviderInstanceId.make("codex"),
      });
      const credential = yield* registry;
      expect(credential).toBeDefined();

      const httpClient = yield* HttpClient.HttpClient;
      const auth = credential!.config.authorizationHeader;
      const initResponse = yield* httpClient.post("/mcp", {
        headers: {
          accept: "application/json, text/event-stream",
          authorization: auth,
        },
        body: HttpBody.text(
          `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"scratch","version":"1.0.0"}}}`,
          "application/json",
        ),
      });
      expect(initResponse.status).toBe(200);
      const sessionId = initResponse.headers["mcp-session-id"];

      const listResponse = yield* httpClient.post("/mcp", {
        headers: {
          accept: "application/json, text/event-stream",
          authorization: auth,
          "mcp-protocol-version": "2025-06-18",
          ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        },
        body: HttpBody.text(
          `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`,
          "application/json",
        ),
      });
      const bodyText = yield* listResponse.text;
      const payload = yield* decodeToolsListPayload(bodyText.match(/\{.*\}/s)![0]);
      const tools = payload.result.tools;
      const toolNames = tools.map((tool) => tool.name);
      expect(toolNames).toContain("t3_worktree_handoff");
      expect(toolNames).toContain("t3_worktree_status");
      expect(toolNames).toContain("t3_worktree_recovery_options");
      expect(toolNames).toContain("t3_worktree_recover");
      expect(toolNames).toContain("preview_status");
      expect(toolNames).toContain("delegate_task");

      const handoff = tools.find((tool) => tool.name === "t3_worktree_handoff");
      expect(handoff?.annotations?.readOnlyHint).toBe(false);
      expect(handoff?.annotations?.destructiveHint).toBe(true);
      expect(handoff?.annotations?.openWorldHint).toBe(true);
      const status = tools.find((tool) => tool.name === "t3_worktree_status");
      expect(status?.annotations?.readOnlyHint).toBe(true);
      expect(status?.annotations?.destructiveHint).toBe(false);

      const organize = Effect.fn("test.organizeOverHttp")(function* (
        args: Record<string, unknown>,
      ) {
        const response = yield* httpClient.post("/mcp", {
          headers: {
            accept: "application/json, text/event-stream",
            authorization: auth,
            "mcp-protocol-version": "2025-06-18",
            ...(sessionId ? { "mcp-session-id": sessionId } : {}),
          },
          body: HttpBody.text(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 3,
              method: "tools/call",
              params: { name: "t3_thread_organize", arguments: args },
            }),
            "application/json",
          ),
        });
        const text = yield* response.text;
        return JSON.parse(text.match(/\{.*\}/s)![0]);
      });
      expect(yield* organize({ action: "archive", threadIds: ["other-thread"] })).toMatchObject({
        error: { code: -32602 },
      });
      expect(dispatched).toEqual([]);
      const own = yield* organize({ action: "archive" });
      expect(own, JSON.stringify(own)).toMatchObject({ result: { isError: false } });
      expect(dispatched).toMatchObject([{ type: "thread.archive", threadId: "thread-scratch" }]);

      // MCP requires every tool input schema to be a top-level object schema.
      // A non-object schema (e.g. the anyOf produced by an empty
      // Schema.Struct({})) makes clients reject the entire server.
      for (const tool of tools) {
        expect(tool.inputSchema.type, `inputSchema.type of ${tool.name}`).toBe("object");
      }
    }).pipe(
      Effect.provide(
        McpSessionRegistry.layer.pipe(
          Layer.provide(
            Layer.mock(ServerEnvironment.ServerEnvironment)({
              getEnvironmentId: Effect.succeed("environment-scratch" as never),
            }),
          ),
        ),
      ),
    ),
  ).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeHttpServer.layerTest,
        ServerConfig.layerTest(process.cwd(), { prefix: "t3-worktree-mcp-" }).pipe(
          Layer.provide(NodeServices.layer),
        ),
        NodeServices.layer,
      ),
    ),
  ),
);
