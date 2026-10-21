import * as Schema from "effect/Schema";
import { CommandId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const ThreadWorkspaceInput = Schema.Struct({ threadId: ThreadId });
export const ThreadWorkspaceChoice = Schema.Struct({
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  path: TrimmedNonEmptyString,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  displayName: Schema.String,
});
export const ThreadWorkspaceState = Schema.Struct({
  path: Schema.String,
  available: Schema.Boolean,
  choices: Schema.Array(ThreadWorkspaceChoice),
});
export type ThreadWorkspaceState = typeof ThreadWorkspaceState.Type;
export const RecoverThreadWorkspaceInput = Schema.Struct({
  commandId: CommandId,
  threadId: ThreadId,
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
});
export type RecoverThreadWorkspaceInput = typeof RecoverThreadWorkspaceInput.Type;
export class ThreadWorkspaceRecoveryError extends Schema.TaggedError<ThreadWorkspaceRecoveryError>()(
  "ThreadWorkspaceRecoveryError",
  {
    threadId: ThreadId,
    reason: Schema.Literals(["unavailable", "active_run", "recovery_failed"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "active_run":
        return "Stop this thread's running turn before choosing another workspace.";
      case "unavailable":
        return "Choose an available checkout from this project.";
      case "recovery_failed":
        return "Could not reconnect this thread to the selected workspace. Retry the workspace selection.";
    }
  }
}
