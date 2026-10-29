export * from "./_generated/meta.gen.ts";

import * as Generated from "./_generated/meta.gen.ts";
import * as Schema from "effect/Schema";

// Codex 0.165.0 experimental sampling is newer than the generated base protocol.
export const ThreadSampleParams = Schema.Struct({
  threadId: Schema.String,
  expectedTurnId: Schema.String,
  prompt: Schema.String,
  effort: Schema.optionalKey(
    Schema.NullOr(Schema.Literals(["none", "minimal", "low", "medium", "high", "xhigh"])),
  ),
});
export const ThreadSampleResponse = Schema.Struct({
  sourceTurnId: Schema.String,
  responseId: Schema.String,
  text: Schema.NullOr(Schema.String),
  inputTokens: Schema.NullOr(Schema.Number),
  cachedInputTokens: Schema.NullOr(Schema.Number),
  outputTokens: Schema.NullOr(Schema.Number),
});
const ThreadSampleCancelParams = Schema.Struct({
  requestId: Schema.Union([Schema.String, Schema.Number]),
});
const ThreadSampleCancelResponse = Schema.Struct({});

/** @public Complete method-name metadata for the rpc entry, including the sampling extensions. */
export const CLIENT_REQUEST_METHODS = {
  ...Generated.CLIENT_REQUEST_METHODS,
  "thread/sample": "thread/sample",
  "thread/sample/cancel": "thread/sample/cancel",
} as const;

export const CLIENT_REQUEST_PARAMS = {
  ...Generated.CLIENT_REQUEST_PARAMS,
  "thread/sample": ThreadSampleParams,
  "thread/sample/cancel": ThreadSampleCancelParams,
};
export const CLIENT_REQUEST_RESPONSES = {
  ...Generated.CLIENT_REQUEST_RESPONSES,
  "thread/sample": ThreadSampleResponse,
  "thread/sample/cancel": ThreadSampleCancelResponse,
};
export type ClientRequestMethod = keyof typeof CLIENT_REQUEST_PARAMS;
export type ClientRequestParamsByMethod = Generated.ClientRequestParamsByMethod & {
  readonly "thread/sample": typeof ThreadSampleParams.Type;
  readonly "thread/sample/cancel": typeof ThreadSampleCancelParams.Type;
};
export type ClientRequestResponsesByMethod = Generated.ClientRequestResponsesByMethod & {
  readonly "thread/sample": typeof ThreadSampleResponse.Type;
  readonly "thread/sample/cancel": typeof ThreadSampleCancelResponse.Type;
};
