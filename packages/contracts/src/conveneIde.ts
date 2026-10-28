import * as Schema from "effect/Schema";
import { ProjectId } from "./baseSchemas.ts";

const destination = {
  projectId: ProjectId,
  workspaceKey: Schema.NonEmptyString,
  file: Schema.optional(
    Schema.Struct({
      relativePath: Schema.NonEmptyString,
      line: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
      column: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
    }),
  ),
};

export const ConveneIdeRequest = Schema.Union([
  Schema.Struct({
    service: Schema.Literal("code-server"),
    operation: Schema.Literals(["OPEN", "QUERY"]),
    ...destination,
  }),
  Schema.Struct({
    service: Schema.Literal("code-server"),
    operation: Schema.Literal("STOP"),
    runtimeId: Schema.NonEmptyString,
  }),
]);
export type ConveneIdeRequest = typeof ConveneIdeRequest.Type;

export const ConveneIdeResult = Schema.Struct({
  service: Schema.Literal("code-server"),
  version: Schema.String,
  phase: Schema.Literals(["stopped", "installing", "starting", "ready", "failed"]),
  runtimeId: Schema.NullOr(Schema.String),
  /** Relative to the current tab's authenticated request base, never a host or port. */
  entryPath: Schema.NullOr(Schema.String),
  progress: Schema.optional(
    Schema.Union([
      Schema.Struct({
        stage: Schema.Literals(["checking", "extracting", "configuring-language", "starting"]),
      }),
      Schema.Struct({
        stage: Schema.Literal("downloading"),
        receivedBytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        totalBytes: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
      }),
    ]),
  ),
  warning: Schema.optional(Schema.Struct({ code: Schema.Literal("language_setup_failed") })),
  error: Schema.NullOr(
    Schema.Struct({
      code: Schema.Literals([
        "unsupported_platform",
        "install_failed",
        "start_failed",
        "runtime_exited",
        "stop_failed",
      ]),
    }),
  ),
});
export type ConveneIdeResult = typeof ConveneIdeResult.Type;
