import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as Layer from "effect/Layer";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as EventStore from "./EventStore.ts";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2AppThread,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as EventSink from "./EventSink.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const databaseLayer = SqlitePersistence.layerMemory;
const harnessLayer = ProviderReplayHarness.layerWithRegistry(
  { name: "import-title-repair" },
  ProviderAdapterRegistry.layerFromAdapters([]),
  { runEffectWorker: false, databaseLayer },
);
const layer = Layer.mergeAll(
  harnessLayer,
  EventStore.layer.pipe(Layer.provide(databaseLayer)),
  CommandReceiptStore.layer.pipe(Layer.provide(databaseLayer)),
);
const projectId = ProjectId.make("project:import-title");
const instanceId = ProviderInstanceId.make("codex");
const oldTitle = "# AGENTS.md instructions for /repo";
const now = DateTime.makeUnsafe("2026-10-01T00:00:00.000Z");
function seed(
  id: string,
  options: { title?: string; imported?: boolean; evidence?: boolean } = {},
) {
  return Effect.gen(function* () {
    const threadId = ThreadId.make(id);
    const thread: OrchestrationV2AppThread = {
      id: threadId,
      projectId,
      createdBy: "system",
      creationSource: "server",
      title: options.title ?? oldTitle,
      providerInstanceId: instanceId,
      modelSelection: { instanceId, model: "gpt-5" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: null,
      ...(options.imported === false ? {} : { historyOrigin: "v1_import" as const }),
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: "settled",
      settledAt: now,
      lastVisitedAt: null,
      deletedAt: null,
    };
    const sink = yield* EventSink.EventSinkV2;
    yield* sink.write({
      events: [
        {
          id: EventId.make(
            `${options.evidence === false ? "unknown" : "agent-session-import:v2"}:${id}`,
          ),
          type: "thread.created",
          threadId,
          providerInstanceId: instanceId,
          occurredAt: now,
          payload: thread,
        },
      ],
    });
    return threadId;
  });
}
function repair(threadId: ThreadId, suffix: string) {
  return Effect.flatMap(Orchestrator.OrchestratorV2, (orchestrator) =>
    orchestrator.dispatch({
      type: "thread.imported-title.repair",
      commandId: CommandId.make(`repair:${suffix}`),
      threadId,
      projectId,
      title: "修复项目标题",
    }),
  );
}

it.effect.each([oldTitle, "Imported thread"])(
  "repairs an untouched import once without changing its state or activity time: %s",
  (title) =>
    Effect.gen(function* () {
      const id = yield* seed("import:codex:untouched", { title });
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const before = (yield* orchestrator.getThreadRecords(id, [])).thread;
      yield* repair(id, "first");
      const after = (yield* orchestrator.getThreadRecords(id, [])).thread;
      expect(after).toEqual({ ...before, title: "修复项目标题" });
      yield* repair(id, "second");
      expect((yield* orchestrator.getThreadRecords(id, [])).thread).toEqual(after);
      const store = yield* EventStore.EventStoreV2;
      const events = yield* store
        .read({ threadId: id, eventType: "thread.metadata-updated" })
        .pipe(Stream.runCollect);
      expect(events).toHaveLength(1);
    }).pipe(Effect.provide(layer)),
);

it.effect.each(
  [false, true].flatMap((renameBack) =>
    [oldTitle, "Imported thread"].map((title) => ({ renameBack, title })),
  ),
)("preserves manual renames, including rename back: %j", ({ renameBack, title }) =>
  Effect.gen(function* () {
    const id = yield* seed("import:codex:renamed", { title });
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* orchestrator.dispatch({
      type: "thread.metadata.update",
      commandId: CommandId.make("rename"),
      threadId: id,
      title: "My name",
    });
    if (renameBack)
      yield* orchestrator.dispatch({
        type: "thread.metadata.update",
        commandId: CommandId.make("rename-back"),
        threadId: id,
        title,
      });
    yield* repair(id, "after-rename");
    expect((yield* orchestrator.getThreadRecords(id, [])).thread.title).toBe(
      renameBack ? title : "My name",
    );
  }).pipe(Effect.provide(layer)),
);

it.effect.each([{ imported: false }, { evidence: false }, { title: "Manual title" }])(
  "skips ineligible imports: %j",
  (options) =>
    Effect.gen(function* () {
      const id = yield* seed("import:codex:ineligible", options);
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const before = (yield* orchestrator.getThreadRecords(id, [])).thread;
      yield* repair(id, "ineligible");
      expect((yield* orchestrator.getThreadRecords(id, [])).thread).toEqual(before);
    }).pipe(Effect.provide(layer)),
);

it.effect.each([false, true])(
  "can correct a prior repair but preserves a later manual rename: %s",
  (manual) =>
    Effect.gen(function* () {
      const id = yield* seed("import:codex:previous-repair");
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const thread = (yield* orchestrator.getThreadRecords(id, [])).thread;
      const sink = yield* EventSink.EventSinkV2;
      const commandId = CommandId.make("prior-repair");
      const events = yield* sink.write({
        commandId,
        events: [
          {
            id: EventId.make("previous-repair-event"),
            type: "thread.metadata-updated",
            threadId: id,
            occurredAt: now,
            providerInstanceId: instanceId,
            payload: { ...thread, title: '<codex_internal_context source="goal">' },
          },
        ],
      });
      const receipts = yield* CommandReceiptStore.CommandReceiptStoreV2;
      yield* receipts.upsert({
        commandId,
        threadId: id,
        commandType: "thread.imported-title.repair",
        status: "accepted",
        error: null,
        acceptedAt: now,
        resultSequence: events[0]!.sequence,
      });
      if (manual)
        yield* orchestrator.dispatch({
          type: "thread.metadata.update",
          commandId: CommandId.make("manual-after-repair"),
          threadId: id,
          title: "<recommended_plugins>",
        });
      yield* repair(id, "correct-prior-repair");
      expect((yield* orchestrator.getThreadRecords(id, [])).thread.title).toBe(
        manual ? "<recommended_plugins>" : "修复项目标题",
      );
    }).pipe(Effect.provide(layer)),
);
