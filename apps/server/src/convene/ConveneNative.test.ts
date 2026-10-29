import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  ConveneNativeResult,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeRequestId,
  ThreadId,
  type ConveneNativeRequest,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderRegistryMock from "../provider/testUtils/providerRegistryMock.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import type { ProviderAdapterV2 } from "@t3tools/provider-core/server/ProviderAdapter";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as ConveneNative from "./ConveneNative.ts";
import * as ConveneWorkspaces from "./ConveneWorkspaces.ts";
import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";

const projectId = ProjectId.make("project:convene-test");
const encodeNativeResult = Schema.encodeEffect(ConveneNativeResult);
const threadId = ThreadId.make("convene:reference-1");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "controlled-codex" };
const provider: ServerProvider = {
  instanceId: modelSelection.instanceId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-09T00:00:00.000Z",
  availability: "available",
  models: [],
  slashCommands: [],
  skills: [],
};
const adapter: ProviderAdapterV2["Service"] = {
  instanceId: modelSelection.instanceId,
  driver: provider.driver,
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
  openSession: () => Effect.die("These command tests do not run a provider."),
};
const database = SqlitePersistence.layerMemory;
const orchestration = ProviderReplayHarness.layerWithRegistry(
  { name: "convene-native-command" },
  ProviderAdapterRegistry.layerFromAdapters([adapter]),
  { databaseLayer: database, runEffectWorker: false },
);
const layer = ConveneNative.layer.pipe(
  Layer.provideMerge(
    ConveneWorkspaces.layer.pipe(
      Layer.provide(ProjectStore.layer.pipe(Layer.provide(database))),
      Layer.provideMerge(GitVcsDriver.layer.pipe(Layer.provide(VcsProcess.layer))),
      Layer.provide(
        ServerConfig.layerTest(process.cwd(), { prefix: "t3-convene-native-workspaces-" }),
      ),
      Layer.provide(NodeServices.layer),
    ),
  ),
  Layer.provideMerge(
    ThreadManagement.layer.pipe(
      Layer.provide(orchestration),
      Layer.provide(CommandReceiptStore.layer.pipe(Layer.provide(database))),
      Layer.provide(ServerSettings.layerTest({})),
    ),
  ),
  Layer.provideMerge(ProjectStore.layer.pipe(Layer.provide(database))),
  Layer.provide(ProviderRegistryMock.layer([provider])),
  Layer.provide(NodeServices.layer),
);
const create: ConveneNativeRequest = {
  operation: "CREATE",
  projectId,
  workspaceKey: "root",
  commandId: CommandId.make("convene:create-1"),
  threadId,
  title: "Platform-created thread",
  modelSelection,
  runtimeMode: "approval-required",
  interactionMode: "default",
};
const seed = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const parent = yield* fs.makeTempDirectoryScoped({ prefix: "t3-convene-project-" });
  const directory = `${parent}/project`;
  yield* fs.makeDirectory(directory);
  const projects = yield* ProjectStore.ProjectStoreV2;
  yield* projects.apply({
    sequence: 1,
    eventId: EventId.make("project:seed"),
    aggregateKind: "project",
    aggregateId: projectId,
    type: "project.created",
    occurredAt: "2026-10-09T00:00:00.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: {
      projectId,
      title: "Test project",
      workspaceRoot: directory,
      defaultModelSelection: modelSelection,
      scripts: [],
      createdAt: "2026-10-09T00:00:00.000Z",
      updatedAt: "2026-10-09T00:00:00.000Z",
    },
  });
  return directory;
});

it.effect.each(["controlled-codex", null])(
  "creates a durable native thread with selection %s and an idempotent message",
  (selectedModel) =>
    Effect.gen(function* () {
      yield* seed;
      const service = yield* ConveneNative.ConveneNative;
      const selectedCreate: ConveneNativeRequest = {
        ...create,
        modelSelection: { ...modelSelection, model: selectedModel },
      };
      const first = yield* service.handle(selectedCreate);
      const retry = yield* service.handle(selectedCreate);
      assert.deepEqual(retry, first);
      const send: ConveneNativeRequest = {
        operation: "SEND",
        projectId,
        workspaceKey: "root",
        threadId,
        commandId: CommandId.make("convene:send-1"),
        messageId: MessageId.make("convene:message-1"),
        message: "Controlled task",
      };
      const sent = yield* service.handle(send);
      assert.equal(sent.type, "receipt");
      assert.isTrue(sent.type === "receipt" && sent.accepted);
      yield* service.handle(send);
      const result = yield* service.handle({
        operation: "QUERY",
        projectId,
        workspaceKey: "root",
        threadId,
        limit: 20,
      });
      assert.equal(result.type, "snapshot");
      if (result.type !== "snapshot") return assert.fail("Expected native snapshot");
      assert.equal(result.thread.id, threadId);
      assert.equal(result.thread.modelSelection.model, selectedModel);
      assert.equal(result.runs.length, 1);
      assert.notEqual(result.runs[0]?.status, "completed");
      assert.isTrue(result.items.some(({ item }) => item.type === "user_message"));
      const encoded = yield* encodeNativeResult(result);
      assert.equal(encoded.type, "snapshot");
      if (encoded.type === "snapshot")
        assert.equal(encoded.thread.modelSelection.model, selectedModel);
      const listed = yield* service.handle({ operation: "LIST", projectId, workspaceKey: "root" });
      assert.isTrue(listed.type === "threads" && listed.threads.length === 1);
    }).pipe(Effect.provide(Layer.merge(layer, NodeServices.layer)), Effect.scoped),
);

it.effect(
  "rejects another project, an unknown workspace, a removed directory, and an expired approval",
  () =>
    Effect.gen(function* () {
      const directory = yield* seed;
      const service = yield* ConveneNative.ConveneNative;
      yield* service.handle(create);
      const wrongWorkspace = yield* service
        .handle({
          operation: "QUERY",
          projectId,
          workspaceKey: "deleted-worktree",
          threadId,
          limit: 1,
        })
        .pipe(Effect.flip);
      assert.equal(wrongWorkspace.category, "wrong_workspace");
      const otherProject = yield* service
        .handle({
          operation: "QUERY",
          projectId: ProjectId.make("other-project"),
          workspaceKey: "root",
          threadId,
          limit: 1,
        })
        .pipe(Effect.flip);
      assert.equal(otherProject.category, "workspace_unavailable");
      const fs = yield* FileSystem.FileSystem;
      yield* fs.remove(directory, { recursive: true });
      const removed = yield* service
        .handle({
          ...create,
          threadId: ThreadId.make("convene:reference-2"),
          commandId: CommandId.make("convene:create-2"),
        })
        .pipe(Effect.flip);
      assert.equal(removed.category, "workspace_unavailable");
      // Reading and cancelling an old native reference do not require the directory.
      const read = yield* service.handle({
        operation: "QUERY",
        projectId,
        workspaceKey: "root",
        threadId,
        limit: 1,
      });
      assert.equal(read.type, "snapshot");
      const cancelled = yield* service.handle({
        operation: "CANCEL",
        projectId,
        workspaceKey: "root",
        threadId,
        commandId: CommandId.make("convene:cancel-empty"),
      });
      assert.isTrue(cancelled.type === "receipt" && !cancelled.accepted);
      const expired = yield* service
        .handle({
          operation: "RESPOND",
          projectId,
          workspaceKey: "root",
          threadId,
          commandId: CommandId.make("convene:expired-response"),
          requestId: RuntimeRequestId.make("expired-request"),
          decision: "accept",
        })
        .pipe(Effect.flip);
      assert.equal(expired.category, "invalid_request");
    }).pipe(Effect.provide(Layer.merge(layer, NodeServices.layer)), Effect.scoped),
);

it.effect(
  "routes native worktree threads by durable workspace identity and rejects reuse of a deleted checkout",
  () =>
    Effect.gen(function* () {
      const directory = yield* seed;
      const fs = yield* FileSystem.FileSystem;
      const git = yield* GitVcsDriver.GitVcsDriver;
      const run = (args: string[]) =>
        git.execute({ operation: "ConveneNative.worktree-test", cwd: directory, args });
      yield* fs.writeFileString(`${directory}/file.txt`, "native workspace");
      yield* run(["init"]);
      yield* run(["add", "."]);
      yield* run([
        "-c",
        "user.name=Convene Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-m",
        "initial",
      ]);
      const checkout = `${directory}-linked`;
      yield* run(["worktree", "add", "--detach", checkout, "HEAD"]);
      const workspaces = yield* ConveneWorkspaces.ConveneWorkspaces;
      const native = yield* ConveneNative.ConveneNative;
      const workspace = (yield* workspaces.list(projectId)).find(
        (entry) => entry.key !== "root" && entry.available,
      );
      assert.ok(workspace);
      yield* native.handle({ ...create, workspaceKey: workspace.key });
      const list = yield* native.handle({
        operation: "LIST",
        projectId,
        workspaceKey: workspace.key,
      });
      assert.isTrue(
        list.type === "threads" && list.threads.length === 1 && list.threads[0]?.id === threadId,
      );
      const root = yield* native.handle({ operation: "LIST", projectId, workspaceKey: "root" });
      assert.isTrue(root.type === "threads" && root.threads.length === 0);
      yield* run(["worktree", "remove", "--force", checkout]);
      const history = yield* native.handle({
        operation: "QUERY",
        projectId,
        workspaceKey: workspace.key,
        threadId,
        limit: 20,
      });
      assert.equal(history.type, "snapshot");
      const send = {
        operation: "SEND" as const,
        projectId,
        workspaceKey: workspace.key,
        threadId,
        commandId: CommandId.make("worktree:send"),
        messageId: MessageId.make("worktree:message"),
        message: "Cannot execute in a removed checkout",
      };
      assert.equal(
        (yield* native.handle(send).pipe(Effect.flip)).category,
        "workspace_unavailable",
      );
      yield* run(["worktree", "add", "--detach", checkout, "HEAD"]);
      const replacement = (yield* workspaces.list(projectId)).find(
        (entry) => entry.key !== "root" && entry.available,
      );
      assert.ok(replacement);
      assert.notEqual(replacement.key, workspace.key);
      assert.equal(
        (yield* native
          .handle({
            operation: "QUERY",
            projectId,
            workspaceKey: replacement.key,
            threadId,
            limit: 20,
          })
          .pipe(Effect.flip)).category,
        "wrong_workspace",
      );
      const replacementList = yield* native.handle({
        operation: "LIST",
        projectId,
        workspaceKey: replacement.key,
      });
      assert.isTrue(replacementList.type === "threads" && replacementList.threads.length === 0);
      assert.equal(
        (yield* native.handle(send).pipe(Effect.flip)).category,
        "workspace_unavailable",
      );
      const created = yield* native.handle({
        ...create,
        workspaceKey: replacement.key,
        threadId: ThreadId.make("replacement-thread"),
        commandId: CommandId.make("replacement:create"),
      });
      assert.isTrue(created.type === "receipt" && created.accepted);
    }).pipe(Effect.provide(Layer.merge(layer, NodeServices.layer)), Effect.scoped),
);
