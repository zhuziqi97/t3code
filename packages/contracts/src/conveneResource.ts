import * as Schema from "effect/Schema";
import { ThreadId } from "./baseSchemas.ts";

export const ConveneResourceReadInput = Schema.Struct({
  threadId: ThreadId,
  uri: Schema.NonEmptyString,
  page: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});

export const ConveneResourceComment = Schema.Struct({
  number: Schema.Number,
  resource_uri: Schema.String,
  body: Schema.NullOr(Schema.String),
  is_deleted: Schema.Boolean,
  created_at: Schema.String,
});

export const ConveneIssueResource = Schema.Struct({
  status: Schema.Literal("ready"),
  resource_uri: Schema.String,
  web_path: Schema.String,
  issue: Schema.Struct({
    number: Schema.Number,
    title: Schema.String,
    state: Schema.Literals(["OPEN", "CLOSED"]),
    body: Schema.optional(Schema.String),
    resource_uri: Schema.String,
  }),
  comments: Schema.Array(ConveneResourceComment),
  focused_comment_number: Schema.NullOr(Schema.Number),
  page: Schema.Number,
  page_size: Schema.Number,
  total: Schema.Number,
});
export type ConveneIssueResource = typeof ConveneIssueResource.Type;

export const ConveneResourceFailure = Schema.Struct({
  status: Schema.Literals([
    "unauthorized",
    "notFound",
    "unsupported",
    "disconnected",
    "unavailable",
    "projectUnavailable",
  ]),
  resource_uri: Schema.String,
});
export const ConveneResourceReadResult = Schema.Union([
  Schema.Struct({ ...ConveneIssueResource.fields, web_url: Schema.String }),
  ConveneResourceFailure,
]);
export type ConveneResourceReadResult = typeof ConveneResourceReadResult.Type;
