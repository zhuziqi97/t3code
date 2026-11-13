import * as Schema from "effect/Schema";
import { RunId, ThreadId } from "./baseSchemas.ts";

export const ComposerPredictionInput = Schema.Struct({
  threadId: ThreadId,
  sourceRunId: RunId,
  requestId: Schema.NonEmptyString,
  trigger: Schema.Literals(["live", "catch_up"]),
  // Intent permits explicit retries without changing the official trigger's sampling rate.
  intent: Schema.optionalKey(Schema.Literals(["auto", "manual"])),
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
  reason: Schema.optionalKey(Schema.Literal("plan_mode")),
  text: Schema.NullOr(Schema.String),
});
export type ComposerPredictionResult = typeof ComposerPredictionResult.Type;
