import { assert, it } from "@effect/vitest";
import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  ThreadId,
  type ConveneStatus,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as ConveneConnection from "../convene/ConveneConnection.ts";
import * as ConveneWorkspaces from "../convene/ConveneWorkspaces.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";
import * as Recovery from "./ThreadWorkspaceRecovery.ts";

const threadId = ThreadId.make("recover-thread");
const projectId = ProjectId.make("recover-project");
const providerSessionId = ProviderSessionId.make("recover-session");
const original = "/project/old-worktree";

function setup(
  options: {
    active?: boolean;
    offline?: boolean;
    samePathReplacement?: boolean;
    failBinding?: boolean;
    file?: boolean;
  } = {},
) {
  let projection = {
    thread: {
      id: threadId,
      projectId,
      branch: "original",
      worktreePath: original,
      modelSelection: { instanceId: ProviderInstanceId.make("chosen-instance"), model: null },
    },
    runs: options.active ? [{ status: "running" }] : [{ status: "failed" }],
    messages: [{ text: "Keep this conversation" }],
    providerSessions: [{ id: providerSessionId }],
  } as unknown as OrchestrationV2ThreadProjection;
  let key = "old-key";
  let failBinding = options.failBinding ?? false;
  let reports = 0;
  const operations: string[] = [];
  const locations: ConveneWorkspaces.Workspace[] = [
    {
      projectId,
      key: "root",
      path: "/project",
      branch: "main",
      displayName: "Project folder",
      available: true,
    },
    {
      projectId,
      key: "new-key",
      path: options.samePathReplacement ? original : "/project/other-worktree",
      branch: "chosen",
      displayName: "Other worktree",
      available: true,
    },
    {
      projectId,
      key: "old-key",
      path: original,
      branch: "original",
      displayName: "Removed worktree",
      available: false,
    },
  ];
  const layer = Recovery.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        FileSystem.layerNoop({
          stat: (path) =>
            Effect.succeed({
              type:
                path === original && (!options.samePathReplacement || options.file)
                  ? "File"
                  : "Directory",
            } as never),
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadRecords: () => Effect.succeed(projection),
          dispatch: (command) =>
            Effect.sync(() => {
              assert.equal(command.type, "thread.metadata.update");
              if (command.type === "thread.metadata.update") {
                assert.equal(command.expectedWorktreePath, projection.thread.worktreePath);
                projection = {
                  ...projection,
                  thread: {
                    ...projection.thread,
                    worktreePath: command.worktreePath!,
                    branch: command.branch!,
                  },
                };
              }
              operations.push("metadata");
              return { sequence: 1, storedEvents: [] };
            }),
        }),
        Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
          detach: (input) =>
            Effect.sync(() => {
              assert.equal(input.threadId, threadId);
              assert.equal(input.providerSessionId, providerSessionId);
              assert.equal(input.revokeMcpCredential, true);
              operations.push("retire-old-session");
            }),
        }),
        Layer.mock(ConveneWorkspaces.ConveneWorkspaces)({
          changes: Stream.empty,
          list: () => Effect.succeed(locations),
          threadKey: () => Effect.sync(() => key),
          rebindThread: (_projectId, id, next) =>
            Effect.gen(function* () {
              assert.equal(id, threadId);
              if (failBinding) {
                failBinding = false;
                return yield* new ConveneWorkspaces.ConveneWorkspaceError({ projectId });
              }
              operations.push("bind-identity");
              key = next;
            }),
        }),
        Layer.mock(ConveneConnection.ConveneConnection)({
          status: Effect.succeed({
            phase: options.offline ? "offline" : "online",
          } as ConveneStatus),
          synchronize: Effect.sync(() => {
            operations.push("report");
            reports += 1;
          }),
        }),
      ),
    ),
  );
  const recover = (worktreePath: string | null) =>
    Effect.flatMap(Recovery.ThreadWorkspaceRecovery, (service) =>
      service.recover({
        commandId: CommandId.make("user-workspace-choice"),
        threadId,
        worktreePath,
      }),
    );
  return {
    layer,
    recover,
    inspect: Effect.flatMap(Recovery.ThreadWorkspaceRecovery, (service) =>
      service.inspect({ threadId }),
    ),
    operations,
    projection: () => projection,
    key: () => key,
    reports: () => reports,
  };
}

it.effect(
  "rebinds the same thread and history, retires its old session before the new identity and report",
  () => {
    const h = setup();
    return Effect.gen(function* () {
      const before = yield* h.inspect;
      assert.equal(before.available, false);
      assert.deepEqual(
        before.choices.map((choice) => choice.path),
        ["/project", "/project/other-worktree"],
      );
      const state = yield* h.recover(null);
      assert.equal(state.available, true);
      assert.deepEqual(h.operations, ["retire-old-session", "metadata", "bind-identity", "report"]);
      assert.equal(h.key(), "root");
      assert.equal(h.projection().thread.id, threadId);
      assert.equal(h.projection().thread.branch, "main");
      assert.deepEqual(h.projection().thread.modelSelection, {
        instanceId: ProviderInstanceId.make("chosen-instance"),
        model: null,
      });
      assert.deepEqual(
        h.projection().messages.map((message) => message.text),
        ["Keep this conversation"],
      );
      assert.equal(h.projection().runs[0]?.status, "failed");
    }).pipe(Effect.provide(h.layer));
  },
);

it.effect("requires an explicit choice when a different worktree replaces the old path", () => {
  const h = setup({ samePathReplacement: true });
  return Effect.gen(function* () {
    assert.equal((yield* h.inspect).available, false);
    assert.equal((yield* h.recover(original)).available, true);
    assert.equal(h.key(), "new-key");
    assert.equal(h.projection().thread.branch, "chosen");
  }).pipe(Effect.provide(h.layer));
});

it.effect(
  "rejects directories outside the project and unavailable choices without retiring any session",
  () => {
    const h = setup();
    return Effect.gen(function* () {
      for (const worktreePath of ["/another-project", original]) {
        const failure = yield* h.recover(worktreePath).pipe(Effect.flip);
        assert.equal(failure.reason, "unavailable");
      }
      assert.deepEqual(h.operations, []);
    }).pipe(Effect.provide(h.layer));
  },
);

it.effect("refuses a running thread before changing its workspace or credentials", () => {
  const h = setup({ active: true });
  return Effect.gen(function* () {
    assert.equal((yield* h.recover(null).pipe(Effect.flip)).reason, "active_run");
    assert.deepEqual(h.operations, []);
  }).pipe(Effect.provide(h.layer));
});

it.effect("can retry a failed identity write and does not replay a failed turn", () => {
  const h = setup({ failBinding: true });
  return Effect.gen(function* () {
    assert.equal((yield* h.recover(null).pipe(Effect.flip)).reason, "recovery_failed");
    assert.equal((yield* h.inspect).available, false);
    assert.equal((yield* h.recover(null)).available, true);
    assert.equal(h.reports(), 1);
    assert.equal(h.projection().runs[0]?.status, "failed");
  }).pipe(Effect.provide(h.layer));
});

it.effect(
  "allows an explicit local selection offline without reassigning the provider or calling the platform",
  () => {
    const h = setup({ offline: true });
    return Effect.gen(function* () {
      yield* h.recover("/project/other-worktree");
      assert.equal(h.reports(), 0);
      assert.deepEqual(h.projection().thread.modelSelection, {
        instanceId: ProviderInstanceId.make("chosen-instance"),
        model: null,
      });
    }).pipe(Effect.provide(h.layer));
  },
);
