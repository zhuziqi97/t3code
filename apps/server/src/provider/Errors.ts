import * as Schema from "effect/Schema";

export class ProviderInstanceNotFoundError extends Schema.TaggedError<ProviderInstanceNotFoundError>()(
  "ProviderInstanceNotFoundError",
  {
    instanceId: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `No provider instance bound to id '${this.instanceId}'`;
  }
}

export { ProviderDriverError } from "@t3tools/provider-core/server/errors";

export class ProviderWorkspaceMissingError extends Schema.TaggedError<ProviderWorkspaceMissingError>()(
  "ProviderWorkspaceMissingError",
  {
    threadId: Schema.String,
    cwd: Schema.String,
  },
) {
  override get message(): string {
    return `This thread's workspace folder no longer exists or is not a directory: ${this.cwd}. Restore the original folder or choose a checkout from this project, then retry.`;
  }
}

export class ProviderWorkspaceRestoreError extends Schema.TaggedError<ProviderWorkspaceRestoreError>()(
  "ProviderWorkspaceRestoreError",
  {
    threadId: Schema.String,
    cwd: Schema.String,
    branch: Schema.String,
    reason: Schema.Literals(["branch_missing", "restore_failed"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.reason === "branch_missing"
      ? `The original local branch '${this.branch}' no longer exists. Choose a checkout from this project to continue this thread.`
      : `Could not restore '${this.branch}' at ${this.cwd}. The branch may be in use by another worktree. Choose a checkout from this project or restore the original folder, then retry.`;
  }
}
