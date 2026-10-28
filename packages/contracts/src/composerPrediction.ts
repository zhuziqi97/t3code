import * as Schema from "effect/Schema";
import { RunId, ThreadId } from "./baseSchemas.ts";

export const ComposerPredictionInput = Schema.Struct({
  threadId: ThreadId,
  sourceRunId: RunId,
  requestId: Schema.NonEmptyString,
  trigger: Schema.Literals(["live", "catch_up"]),
});
export type ComposerPredictionInput = typeof ComposerPredictionInput.Type;
export const ComposerPredictionCancelInput = Schema.Struct({
  threadId: ThreadId,
  requestId: Schema.NonEmptyString,
});
export const ComposerPredictionStatus = Schema.Literals([
  "suggestion",
  "empty",
  "disabled",
  "not_selected",
  "unsupported",
  "not_idle",
  "stale",
  "cancelled",
  "error",
]);
export const ComposerPredictionResult = Schema.Struct({
  requestId: Schema.String,
  sourceRunId: RunId,
  status: ComposerPredictionStatus,
  text: Schema.NullOr(Schema.String),
});
export type ComposerPredictionResult = typeof ComposerPredictionResult.Type;
