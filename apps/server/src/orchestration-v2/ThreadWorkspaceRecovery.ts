import {
  type RecoverThreadWorkspaceInput,
  type ThreadId,
  ThreadWorkspaceRecoveryError,
  type ThreadWorkspaceState,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ConveneConnection from "../convene/ConveneConnection.ts";
import * as ConveneWorkspaces from "../convene/ConveneWorkspaces.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";

export class ThreadWorkspaceRecovery extends Context.Service<
  ThreadWorkspaceRecovery,
  {
    readonly inspect: (input: {
      readonly threadId: ThreadId;
    }) => Effect.Effect<ThreadWorkspaceState, ThreadWorkspaceRecoveryError>;
    readonly recover: (
      input: RecoverThreadWorkspaceInput,
    ) => Effect.Effect<ThreadWorkspaceState, ThreadWorkspaceRecoveryError>;
  }
>()("t3/orchestration-v2/ThreadWorkspaceRecovery") {}

const isRecoveryError = Schema.is(ThreadWorkspaceRecoveryError);

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const workspaces = yield* ConveneWorkspaces.ConveneWorkspaces;
  const connection = yield* ConveneConnection.ConveneConnection;
  const fs = yield* FileSystem.FileSystem;

  const inspect = Effect.fn("ThreadWorkspaceRecovery.inspect")(
    function* (input: { readonly threadId: ThreadId }) {
      const { thread } = yield* threads.getThreadRecords(input.threadId, []);
      const locations = yield* workspaces.list(thread.projectId);
      const root = locations.find((workspace) => workspace.key === "root");
      const path = thread.worktreePath ?? root?.path ?? "";
      const originalKey = yield* workspaces.threadKey(thread.projectId, input.threadId);
      const location = locations.find(
        (workspace) => workspace.path === path && workspace.available,
      );
      const directoryAvailable = yield* fs.stat(path).pipe(
        Effect.map((stat) => stat.type === "Directory"),
        Effect.orElseSucceed(() => false),
      );
      const available =
        directoryAvailable && (originalKey === null || originalKey === location?.key);
      return {
        path,
        available,
        choices: locations
          .filter((workspace) => workspace.available)
          .map((workspace) => ({
            worktreePath: workspace.key === "root" ? null : workspace.path,
            path: workspace.path,
            branch: workspace.branch,
            displayName: workspace.displayName,
          })),
      };
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new ThreadWorkspaceRecoveryError({
              threadId: input.threadId,
              reason: "unavailable",
              cause,
            }),
        ),
      ),
  );

  const recover = Effect.fn("ThreadWorkspaceRecovery.recover")(
    function* (input: RecoverThreadWorkspaceInput) {
      const projection = yield* threads.getThreadRecords(input.threadId, [
        "runs",
        "providerSessions",
      ]);
      if (
        projection.runs.some((run) =>
          ["preparing", "starting", "running", "waiting"].includes(run.status),
        )
      ) {
        return yield* new ThreadWorkspaceRecoveryError({
          threadId: input.threadId,
          reason: "active_run",
        });
      }
      const locations = yield* workspaces.list(projection.thread.projectId);
      const target = locations.find(
        (workspace) =>
          workspace.available &&
          (input.worktreePath === null
            ? workspace.key === "root"
            : workspace.path === input.worktreePath),
      );
      if (!target)
        return yield* new ThreadWorkspaceRecoveryError({
          threadId: input.threadId,
          reason: "unavailable",
        });

      // Retire only this app thread's ownership. Shared provider processes and
      // the other threads using the same checkout keep their own credentials.
      for (const session of projection.providerSessions) {
        yield* sessions.detach({
          threadId: input.threadId,
          providerSessionId: session.id,
          revokeMcpCredential: true,
          detail: "Workspace selected by the user.",
        });
      }
      yield* threads.dispatch({
        type: "thread.metadata.update",
        commandId: input.commandId,
        threadId: input.threadId,
        expectedWorktreePath: projection.thread.worktreePath,
        expectedBranch: projection.thread.branch,
        worktreePath: input.worktreePath,
        branch: target.branch,
      });
      yield* workspaces.rebindThread(projection.thread.projectId, input.threadId, target.key);
      if ((yield* connection.status).phase === "online") yield* connection.synchronize;
      return yield* inspect({ threadId: input.threadId });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError((cause) =>
          isRecoveryError(cause)
            ? cause
            : new ThreadWorkspaceRecoveryError({
                threadId: input.threadId,
                reason: "recovery_failed",
                cause,
              }),
        ),
      ),
  );

  return ThreadWorkspaceRecovery.of({ inspect, recover });
});

export const layer = Layer.effect(ThreadWorkspaceRecovery, make);
