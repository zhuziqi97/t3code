import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeURL from "node:url";
import { expect, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderSessionRuntime from "../persistence/ProviderSessionRuntime.ts";
import * as AgentSessionImporter from "./AgentSessionImporter.ts";
import * as AgentSessionScanner from "./AgentSessionScanner.ts";
import * as ProjectService from "./ProjectService.ts";

const projectId = ProjectId.make("agent-session-import-project");
const providerInstanceId = ProviderInstanceId.make("codex");
const providerSessionId = "native-codex-thread";
const threadId = ThreadId.make(`import:${providerInstanceId}:${providerSessionId}`);

it.effect("imports messages once and preserves the provider native resume binding", () => {
  const writes: Array<ReadonlyArray<OrchestrationV2DomainEvent>> = [];
  const upserts: Array<unknown> = [];
  const recorded: Array<unknown> = [];
  let imported = false;
  const scanner = AgentSessionScanner.AgentSessionScanner.of({
    scan: Effect.die("unused"),
    recentThreads: () =>
      Stream.succeed({
        _tag: "Importable",
        source: {
          provider: "codex",
          providerInstanceId,
          providerSessionId,
          filePath: "/tmp/native-codex-thread.jsonl",
          size: 100,
          mtimeMs: 2,
          device: 3,
          inode: 4,
          birthtimeMs: 1,
        },
        thread: {
          source: "codex",
          providerInstanceId,
          providerSessionId,
          title: "Imported thread",
          model: "gpt-5.4",
          createdAt: "2026-09-01T10:00:00.000Z",
          updatedAt: "2026-09-01T10:01:00.000Z",
          messages: [
            { role: "user", text: "Fix it", createdAt: "2026-09-01T10:00:00.000Z" },
            { role: "assistant", text: "Fixed", createdAt: "2026-09-01T10:01:00.000Z" },
          ],
        },
      }),
  });
  const layerTest = AgentSessionImporter.layer.pipe(
    Layer.provide(NodeServices.layer),
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(AgentSessionScanner.AgentSessionScanner, scanner),
        Layer.mock(ProjectService.ProjectService)({
          getById: () =>
            Effect.succeed(
              Option.some({ id: projectId, workspaceRoot: "/workspace/project" } as never),
            ),
        }),
        Layer.mock(Orchestrator.OrchestratorV2)({
          getThreadRecords: () =>
            imported
              ? Effect.succeed({
                  thread: { id: threadId, projectId, historyOrigin: "v1_import" },
                } as never)
              : Effect.fail(new Orchestrator.OrchestratorProjectionError({ threadId })),
        }),
        Layer.mock(EventSink.EventSinkV2)({
          write: (input) =>
            Effect.sync(() => {
              writes.push(input.events);
              imported = true;
              return [];
            }),
        }),
        Layer.mock(ProviderSessionRuntime.ProviderSessionRuntimeRepository)({
          list: () => Effect.succeed([]),
          upsert: (input) => Effect.sync(() => void upserts.push(input)),
          recordImportedTranscript: (input) => Effect.sync(() => void recorded.push(input)),
        }),
        IdAllocator.layer,
      ),
    ),
  );

  return Effect.gen(function* () {
    const importer = yield* AgentSessionImporter.AgentSessionImporter;
    expect(yield* importer.importRecentAgentThreads({ projectId })).toEqual({
      importedCount: 1,
      skippedCount: 0,
    });
    expect(yield* importer.importRecentAgentThreads({ projectId })).toEqual({
      importedCount: 1,
      skippedCount: 0,
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]?.map((event) => event.type)).toEqual([
      "thread.created",
      "message.updated",
      "turn-item.updated",
      "message.updated",
      "turn-item.updated",
      "provider-thread.updated",
    ]);
    const created = writes[0]?.find((event) => event.type === "thread.created");
    const providerThread = writes[0]?.find((event) => event.type === "provider-thread.updated");
    expect(created?.payload).toMatchObject({
      id: threadId,
      activeProviderThreadId: providerThread?.payload.id,
      historyOrigin: "v1_import",
    });
    expect(providerThread?.payload).toMatchObject({
      appThreadId: threadId,
      nativeThreadRef: {
        driver: "codex",
        nativeId: providerSessionId,
        strength: "strong",
      },
    });
    expect(
      writes[0]
        ?.filter((event) => event.type === "message.updated")
        .map((event) => event.payload.text),
    ).toEqual(["Fix it", "Fixed"]);
    expect(upserts).toEqual([
      expect.objectContaining({
        threadId,
        providerInstanceId,
        resumeCursor: { threadId: providerSessionId },
      }),
    ]);
    expect(recorded).toHaveLength(2);
  }).pipe(Effect.provide(layerTest));
});

it.effect.each([
  { outcomeTag: "AlreadyImported" as const, canonicalTitle: "Saved 中文标题" },
  { outcomeTag: "AlreadyImported" as const, canonicalTitle: undefined },
  { outcomeTag: "Importable" as const, canonicalTitle: "Saved 中文标题" },
  { outcomeTag: "Importable" as const, canonicalTitle: undefined },
])("repairs existing imports: %j", ({ outcomeTag, canonicalTitle }) => {
  const commands: Array<unknown> = [];
  const source = {
    provider: "codex" as const,
    providerInstanceId,
    providerSessionId,
    filePath: "/tmp/native.jsonl",
    size: 100,
    mtimeMs: 2,
    device: 3,
    inode: 4,
    birthtimeMs: 1,
  };
  const outcome: AgentSessionScanner.AgentSessionRecentThread =
    outcomeTag === "AlreadyImported"
      ? { _tag: outcomeTag, source, ...(canonicalTitle ? { canonicalTitle } : {}) }
      : {
          _tag: outcomeTag,
          source,
          thread: {
            source: "codex",
            providerInstanceId,
            providerSessionId,
            title: canonicalTitle ?? "Actual request",
            model: null,
            createdAt: "2026-10-01T00:00:00.000Z",
            updatedAt: "2026-10-01T00:00:00.000Z",
            messages: [],
          },
        };
  const testLayer = AgentSessionImporter.layer.pipe(
    Layer.provide(NodeServices.layer),
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(AgentSessionScanner.AgentSessionScanner)({
          recentThreads: () => Stream.succeed(outcome),
        }),
        Layer.mock(ProjectService.ProjectService)({
          getById: () =>
            Effect.succeed(Option.some({ id: projectId, workspaceRoot: "/repo" } as never)),
        }),
        Layer.mock(Orchestrator.OrchestratorV2)({
          getThreadRecords: () =>
            Effect.succeed({
              thread: {
                id: threadId,
                projectId,
                historyOrigin: "v1_import",
                title: "# AGENTS.md instructions for /repo",
              },
              messages: [
                {
                  role: "user",
                  text: "# AGENTS.md instructions for /repo\n<INSTRUCTIONS>\nRules\n</INSTRUCTIONS>",
                },
                { role: "user", text: "Actual request" },
              ],
            } as never),
          dispatch: (command) =>
            Effect.sync(() => {
              commands.push(command);
              return {} as never;
            }),
        }),
        Layer.mock(EventSink.EventSinkV2)({
          write: () => Effect.die("repair must not rewrite history"),
        }),
        Layer.mock(ProviderSessionRuntime.ProviderSessionRuntimeRepository)({
          list: () => Effect.succeed([]),
          recordImportedTranscript: () => Effect.void,
        }),
        IdAllocator.layer,
      ),
    ),
  );
  return Effect.gen(function* () {
    const importer = yield* AgentSessionImporter.AgentSessionImporter;
    yield* importer.importRecentAgentThreads({ projectId });
    expect(commands).toEqual([
      expect.objectContaining({
        type: "thread.imported-title.repair",
        projectId,
        threadId,
        title: canonicalTitle ?? "Actual request",
      }),
    ]);
  }).pipe(Effect.provide(testLayer));
});

it.effect.each([true, false])(
  "repairs a skipped transcript only while its source exists: %s",
  (exists) => {
    const commands: Array<unknown> = [];
    const source = {
      provider: "codex" as const,
      providerInstanceId,
      providerSessionId,
      filePath: exists ? NodeURL.fileURLToPath(import.meta.url) : "/missing-codex-rollout.jsonl",
      size: 1,
      mtimeMs: 1,
      birthtimeMs: 1,
      device: 1,
      inode: 1,
    };
    const layerTest = AgentSessionImporter.layer.pipe(
      Layer.provide(NodeServices.layer),
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(AgentSessionScanner.AgentSessionScanner)({
            recentThreads: () => Stream.succeed({ _tag: "Skipped" }),
          }),
          Layer.mock(ProjectService.ProjectService)({
            getById: () =>
              Effect.succeed(Option.some({ id: projectId, workspaceRoot: "/repo" } as never)),
          }),
          Layer.mock(ProviderSessionRuntime.ProviderSessionRuntimeRepository)({
            list: () =>
              Effect.succeed([
                { runtimePayload: { cwd: "/repo", importedTranscripts: [source] } } as never,
              ]),
          }),
          Layer.mock(Orchestrator.OrchestratorV2)({
            getThreadRecords: () =>
              Effect.succeed({
                thread: { historyOrigin: "v1_import", title: "# AGENTS.md instructions for /repo" },
                messages: [{ role: "user", text: "Saved real request" }],
              } as never),
            dispatch: (command) =>
              Effect.sync(() => {
                commands.push(command);
                return {} as never;
              }),
          }),
          Layer.mock(EventSink.EventSinkV2)({
            write: () => Effect.die("no transcript writes during repair"),
          }),
          IdAllocator.layer,
        ),
      ),
    );
    return Effect.gen(function* () {
      const importer = yield* AgentSessionImporter.AgentSessionImporter;
      expect(yield* importer.importRecentAgentThreads({ projectId })).toEqual({
        importedCount: 0,
        skippedCount: 1,
      });
      expect(commands).toHaveLength(exists ? 1 : 0);
      if (exists)
        expect(commands[0]).toMatchObject({
          type: "thread.imported-title.repair",
          title: "Saved real request",
        });
    }).pipe(Effect.provide(layerTest));
  },
);
