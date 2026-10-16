import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import { materializeReplayTranscriptRuntimeInstructions } from "../orchestration-v2/testkit/ReplayRuntimeInstructions.ts";
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
  ThreadId,
  type ServerProvider,
  type ProviderReplayTranscript,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as EventStore from "../persistence/OrchestrationEventStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import * as ProviderRegistryMock from "../provider/testUtils/providerRegistryMock.ts";
import { CodexOrchestratorReplayHarness } from "../orchestration-v2/Adapters/CodexAdapterV2.testkit.ts";
import { ClaudeOrchestratorReplayHarness } from "../orchestration-v2/Adapters/ClaudeAdapterV2.testkit.ts";
import type { RuntimePolicyV2Override } from "../orchestration-v2/RuntimePolicy.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import {
  materializeReplayTranscriptWorkspace,
  readProviderReplayTranscript,
} from "@t3tools/provider-testing/replayTranscript";
import {
  READ_ONLY_ON_REQUEST_POLICY,
  TOOL_CALL_WRITE_PROMPT,
  MULTI_TURN_FIRST_PROMPT,
  MULTI_TURN_SECOND_PROMPT,
  TURN_INTERRUPT_PROMPT,
  TURN_INTERRUPT_MID_TOOL_PROMPT,
  WORKSPACE_NEVER_POLICY,
} from "../orchestration-v2/testkit/fixtures/shared.ts";
import * as ConveneNative from "./ConveneNative.ts";
import * as ConveneWorkspaces from "./ConveneWorkspaces.ts";
import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";

const encodeNativeResult = Schema.encodeEffect(ConveneNativeResult);

const replayLayer = Effect.fn("conveneReplayLayer")(function* (
  driver: "codex" | "claudeAgent",
  wire: ProviderReplayTranscript,
  database: typeof SqlitePersistence.layerMemory,
  directory: string,
  policy: RuntimePolicyV2Override,
) {
  const materialized = materializeReplayTranscriptWorkspace(
    materializeReplayTranscriptRuntimeInstructions(wire, {
      driver: ProviderDriverKind.make(driver),
      model: String(wire.metadata?.model),
    }),
    directory,
  );
  const options = {
    name: `convene-${driver}-${wire.scenario}`,
    commands: [],
    runtimePolicyOverride: { cwd: directory, ...policy },
  };
  if (driver === "codex") {
    const transcript = yield* CodexOrchestratorReplayHarness.decodeTranscript(materialized);
    return ProviderReplayHarness.layerProviderReplay(
      { ...options, transcript },
      CodexOrchestratorReplayHarness,
      { databaseLayer: database },
    ).pipe(Layer.orDie);
  }
  const transcript = yield* ClaudeOrchestratorReplayHarness.decodeTranscript(materialized);
  return ProviderReplayHarness.layerProviderReplay(
    { ...options, transcript },
    ClaudeOrchestratorReplayHarness,
    { databaseLayer: database },
  ).pipe(Layer.orDie);
});

it.live.each(["codex", "claudeAgent"] as const)(
  "answers a real %s adapter approval in a reported worktree through native receipts",
  (driver) =>
    Effect.gen(function* () {
      const failures: Array<unknown> = [];
      const logger = Logger.make(({ message }) => {
        failures.push(message);
      });
      const fs = yield* FileSystem.FileSystem;
      const parent = yield* fs.makeTempDirectoryScoped({ prefix: "convene-worktree-approval-" });
      const directory = `${parent}/repository`;
      const checkout = `${parent}/checkout`;
      yield* fs.makeDirectory(directory);
      yield* fs.writeFileString(`${directory}/file.txt`, "native worktree runtime");
      const git = yield* GitVcsDriver.GitVcsDriver;
      const runGit = (args: string[]) =>
        git.execute({ operation: "ConveneNative.runtime-worktree", cwd: directory, args });
      yield* runGit(["init"]);
      yield* runGit(["add", "."]);
      yield* runGit([
        "-c",
        "user.name=Convene Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-m",
        "initial",
      ]);
      yield* runGit(["worktree", "add", "--detach", checkout, "HEAD"]);
      const wire = yield* readProviderReplayTranscript(
        new URL(
          `../orchestration-v2/testkit/fixtures/tool_call_read_only_on_request/${driver === "codex" ? "codex" : "claude"}_transcript.ndjson`,
          import.meta.url,
        ),
      );
      const database = SqlitePersistence.layerMemory;
      // The replay harness's base policy omits project roots; production resolves
      // them through RuntimePolicy.layerFromProjectStore.
      const orchestration = yield* replayLayer(driver, wire, database, checkout, {
        ...READ_ONLY_ON_REQUEST_POLICY,
        cwd: undefined,
      });
      const modelSelection = {
        instanceId: ProviderInstanceId.make(driver),
        model: String(wire.metadata?.model),
      };
      const provider: ServerProvider = {
        driver: ProviderDriverKind.make(driver),
        instanceId: modelSelection.instanceId,
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
      const nativeLayer = ConveneNative.layer.pipe(
        Layer.provideMerge(
          ConveneWorkspaces.layer.pipe(
            Layer.provide(ProjectStore.layer.pipe(Layer.provide(database))),
            Layer.provide(GitVcsDriver.layer.pipe(Layer.provide(VcsProcess.layer))),
            Layer.provide(
              ServerConfig.layerTest(process.cwd(), { prefix: "t3-convene-native-workspaces-" }),
            ),
            Layer.provide(NodeServices.layer),
          ),
        ),
        Layer.provideMerge(
          ThreadManagement.layer.pipe(
            Layer.provideMerge(orchestration),
            Layer.provide(CommandReceiptStore.layer.pipe(Layer.provide(database))),
            Layer.provide(ServerSettings.layerTest({})),
          ),
        ),
        Layer.provideMerge(ProjectStore.layer.pipe(Layer.provide(database))),
        Layer.provideMerge(EventStore.layer.pipe(Layer.provide(database))),
        Layer.provide(ProviderRegistryMock.layer([provider])),
        Layer.provide(NodeServices.layer),
        Layer.provide(Logger.layer([logger], { mergeWithExisting: false })),
      );
      yield* Effect.gen(function* () {
        const projectId = ProjectId.make("convene:approval-project"),
          threadId = ThreadId.make("convene:approval-thread");
        const projects = yield* ProjectStore.ProjectStoreV2;
        yield* projects.apply({
          sequence: 1,
          eventId: EventId.make("convene:approval-project-created"),
          aggregateKind: "project",
          aggregateId: projectId,
          type: "project.created",
          occurredAt: "2026-10-09T00:00:00Z",
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          payload: {
            projectId,
            title: "Approval project",
            workspaceRoot: directory,
            defaultModelSelection: modelSelection,
            scripts: [],
            createdAt: "2026-10-09T00:00:00Z",
            updatedAt: "2026-10-09T00:00:00Z",
          },
        });
        const native = yield* ConveneNative.ConveneNative;
        const events = yield* EventStore.OrchestrationEventStore;
        const workspace = (yield* (yield* ConveneWorkspaces.ConveneWorkspaces).list(
          projectId,
        )).find((entry) => entry.path === checkout && entry.available);
        assert.ok(workspace);
        const destination = { projectId, threadId, workspaceKey: workspace.key };
        const options = yield* native.handle({
          operation: "OPTIONS",
          projectId,
          workspaceKey: "root",
        });
        assert.isTrue(options.type === "options" && options.providers[0]?.supported);
        yield* native.handle({
          operation: "CREATE",
          ...destination,
          commandId: CommandId.make("convene:create-approval"),
          title: "Convene native approval",
          modelSelection,
          runtimeMode: "approval-required",
          interactionMode: "default",
        });
        const sent = yield* native.handle({
          operation: "SEND",
          ...destination,
          commandId: CommandId.make("convene:send-approval"),
          messageId: MessageId.make("convene:message-approval"),
          message: TOOL_CALL_WRITE_PROMPT,
        });
        assert.isTrue(sent.type === "receipt" && sent.accepted);
        const pending = yield* events.streamApplicationEvents().pipe(
          Stream.filter(
            (event) =>
              "event" in event &&
              event.event.threadId === threadId &&
              ((event.event.type === "runtime-request.updated" &&
                event.event.payload.status === "pending") ||
                (event.event.type === "run.updated" && event.event.payload.status === "failed")),
          ),
          Stream.runHead,
        );
        assert.isTrue(Option.isSome(pending));
        // Pending request details must not depend on the timeline page cursor.
        const before = yield* native.handle({
          operation: "QUERY",
          ...destination,
          afterPosition: 10000,
          limit: 1,
        });
        assert.equal(before.type, "snapshot");
        if (before.type !== "snapshot") return;
        assert.equal(before.thread.worktreePath, checkout);
        assert.equal(before.requests.length, 1, JSON.stringify(failures));
        const request = before.requests[0]!;
        assert.equal(request.status, "pending");
        const encoded = yield* encodeNativeResult(before);
        assert.equal(encoded.type, "snapshot");
        if (encoded.type !== "snapshot") return;
        const approval = encoded.requests[0]?.item;
        assert.equal(approval?.type, "approval_request");
        if (approval?.type !== "approval_request") return;
        assert.equal(approval.requestId, request.id);
        assert.isNotEmpty(approval.prompt);
        if (driver === "codex") {
          assert.include(approval.prompt, "printf");
          const inbound = wire.entries.find(
            (entry) => entry.type === "emit_inbound" && entry.label?.endsWith("requestApproval"),
          );
          const params = (inbound as { frame: { params: { cwd: string; reason: string } } }).frame
            .params;
          assert.include(approval.prompt, params.cwd);
          assert.include(approval.prompt, params.reason);
        }
        const command = {
          operation: "RESPOND" as const,
          ...destination,
          commandId: CommandId.make("convene:respond-approval"),
          requestId: request.id,
          decision: "accept" as const,
        };
        const response = yield* native.handle(command);
        const replay = yield* native.handle(command);
        assert.deepEqual(replay, response);
        yield* events.streamApplicationEvents().pipe(
          Stream.filter(
            (event) =>
              "event" in event &&
              event.event.threadId === threadId &&
              event.event.type === "run.updated" &&
              event.event.payload.status === "completed",
          ),
          Stream.runHead,
        );
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        yield* worker.drain();
        const result = yield* native.handle({ operation: "QUERY", ...destination, limit: 100 });
        assert.equal(result.type, "snapshot");
        if (result.type !== "snapshot") return;
        assert.equal(result.requests.length, 0);
        assert.equal(result.runs[0]?.status, "completed");
        assert.isTrue(result.items.some((entry) => entry.item.type === "assistant_message"));
        const listed = yield* native.handle({
          operation: "LIST",
          projectId,
          workspaceKey: workspace.key,
        });
        assert.isTrue(listed.type === "threads" && listed.threads.length === 1);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            nativeLayer,
            NodeServices.layer,
            Logger.layer([logger], { mergeWithExisting: false }),
          ),
        ),
      );
    }).pipe(
      Effect.provide(
        Layer.merge(
          NodeServices.layer,
          GitVcsDriver.layer.pipe(
            Layer.provide(VcsProcess.layer),
            Layer.provide(
              ServerConfig.layerTest(process.cwd(), {
                prefix: "t3-convene-worktree-runtime-setup-",
              }),
            ),
            Layer.provide(NodeServices.layer),
          ),
        ),
      ),
      Effect.scoped,
    ),
);

it.live.each([
  { driver: "codex", fixture: "multi_turn" },
  { driver: "codex", fixture: "turn_interrupt" },
  { driver: "claudeAgent", fixture: "multi_turn" },
  { driver: "claudeAgent", fixture: "turn_interrupt_mid_tool" },
] as const)("keeps native ownership through $driver/$fixture", ({ driver, fixture }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: `convene-${fixture}-` });
    const wire = yield* readProviderReplayTranscript(
      new URL(
        `../orchestration-v2/testkit/fixtures/${fixture}/${driver === "codex" ? "codex" : "claude"}_transcript.ndjson`,
        import.meta.url,
      ),
    );
    const database = SqlitePersistence.layerMemory;
    const orchestration = yield* replayLayer(
      driver,
      wire,
      database,
      directory,
      driver === "codex" && fixture === "turn_interrupt" ? WORKSPACE_NEVER_POLICY : {},
    );
    const modelSelection = {
      instanceId: ProviderInstanceId.make(driver),
      model: String(wire.metadata?.model),
    };
    const provider: ServerProvider = {
      driver: ProviderDriverKind.make(driver),
      instanceId: modelSelection.instanceId,
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
    const nativeLayer = ConveneNative.layer.pipe(
      Layer.provideMerge(
        ConveneWorkspaces.layer.pipe(
          Layer.provide(ProjectStore.layer.pipe(Layer.provide(database))),
          Layer.provide(GitVcsDriver.layer.pipe(Layer.provide(VcsProcess.layer))),
          Layer.provide(
            ServerConfig.layerTest(process.cwd(), { prefix: "t3-convene-native-workspaces-" }),
          ),
          Layer.provide(NodeServices.layer),
        ),
      ),
      Layer.provideMerge(
        ThreadManagement.layer.pipe(
          Layer.provideMerge(orchestration),
          Layer.provide(CommandReceiptStore.layer.pipe(Layer.provide(database))),
          Layer.provide(ServerSettings.layerTest({})),
        ),
      ),
      Layer.provideMerge(ProjectStore.layer.pipe(Layer.provide(database))),
      Layer.provideMerge(EventStore.layer.pipe(Layer.provide(database))),
      Layer.provide(ProviderRegistryMock.layer([provider])),
      Layer.provide(NodeServices.layer),
    );
    yield* Effect.gen(function* () {
      const projectId = ProjectId.make(`convene:${fixture}-project`),
        threadId = ThreadId.make(`convene:${fixture}-thread`);
      const projects = yield* ProjectStore.ProjectStoreV2;
      yield* projects.apply({
        sequence: 1,
        eventId: EventId.make(`convene:${fixture}-project-created`),
        aggregateKind: "project",
        aggregateId: projectId,
        type: "project.created",
        occurredAt: "2026-10-09T00:00:00Z",
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: {},
        payload: {
          projectId,
          title: fixture,
          workspaceRoot: directory,
          defaultModelSelection: modelSelection,
          scripts: [],
          createdAt: "2026-10-09T00:00:00Z",
          updatedAt: "2026-10-09T00:00:00Z",
        },
      });
      const native = yield* ConveneNative.ConveneNative;
      const events = yield* EventStore.OrchestrationEventStore;
      const destination = { projectId, threadId, workspaceKey: "root" };
      yield* native.handle({
        operation: "CREATE",
        ...destination,
        commandId: CommandId.make(`convene:${fixture}-create`),
        title: fixture,
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      const sent = yield* native.handle({
        operation: "SEND",
        ...destination,
        commandId: CommandId.make(`convene:${fixture}-send-1`),
        messageId: MessageId.make(`convene:${fixture}-message-1`),
        message:
          fixture === "multi_turn"
            ? MULTI_TURN_FIRST_PROMPT
            : fixture === "turn_interrupt_mid_tool"
              ? TURN_INTERRUPT_MID_TOOL_PROMPT
              : TURN_INTERRUPT_PROMPT,
      });
      assert.isTrue(sent.type === "receipt" && sent.accepted);
      const initial = fixture === "multi_turn" ? "completed" : "running";
      yield* events.streamApplicationEvents().pipe(
        Stream.filter(
          (event) =>
            "event" in event &&
            event.event.threadId === threadId &&
            event.event.type === "run.updated" &&
            (event.event.payload.status === initial || event.event.payload.status === "failed"),
        ),
        Stream.runHead,
      );
      const first = yield* native.handle({ operation: "QUERY", ...destination, limit: 100 });
      assert.isTrue(first.type === "snapshot" && first.runs[0]?.status === initial);
      if (fixture === "turn_interrupt_mid_tool") {
        // Claude opens its SDK query lazily. A persisted tool call proves that
        // cancellation reaches the running query rather than its start effect.
        yield* events.streamApplicationEvents().pipe(
          Stream.filter(
            (event) =>
              "event" in event &&
              event.event.threadId === threadId &&
              event.event.type === "turn-item.updated" &&
              event.event.payload.type === "command_execution",
          ),
          Stream.runHead,
        );
      }
      const beforeNext = yield* events.latestApplicationSequence;
      if (fixture === "multi_turn") {
        yield* (yield* EffectWorker.OrchestrationEffectWorkerV2).drain();
        yield* native.handle({
          operation: "SEND",
          ...destination,
          commandId: CommandId.make(`convene:${fixture}-send-2`),
          messageId: MessageId.make(`convene:${fixture}-message-2`),
          message: MULTI_TURN_SECOND_PROMPT,
        });
      } else {
        const cancellation = yield* native.handle({
          operation: "CANCEL",
          ...destination,
          commandId: CommandId.make(`convene:${fixture}-cancel`),
        });
        assert.isTrue(cancellation.type === "receipt" && cancellation.accepted);
      }
      const terminal = fixture === "multi_turn" ? "completed" : "interrupted";
      yield* events.streamApplicationEvents({ afterSequence: beforeNext }).pipe(
        Stream.filter(
          (event) =>
            "event" in event &&
            event.event.threadId === threadId &&
            event.event.type === "run.updated" &&
            (event.event.payload.status === terminal || event.event.payload.status === "failed"),
        ),
        Stream.runHead,
      );
      yield* (yield* EffectWorker.OrchestrationEffectWorkerV2).drain();
      const result = yield* native.handle({ operation: "QUERY", ...destination, limit: 100 });
      assert.equal(result.type, "snapshot");
      if (result.type !== "snapshot") return;
      assert.equal(result.runs.length, fixture === "multi_turn" ? 2 : 1);
      assert.isTrue(result.runs.every((run) => run.status === terminal));
      if (fixture === "multi_turn")
        assert.equal(
          result.items.filter((entry) => entry.item.type === "assistant_message").length,
          2,
        );
    }).pipe(Effect.provide(Layer.merge(nativeLayer, NodeServices.layer)));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
