import * as Schema from "effect/Schema";
import { ProjectId, ThreadId } from "./baseSchemas.ts";

export const ConveneResourceSearchInput = Schema.Struct({
  projectId: ProjectId,
  kind: Schema.Literals(["issue", "document"]),
  query: Schema.String.check(Schema.isMaxLength(500)),
  page: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  pageSize: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })),
});

const referenceFields = {
  module_id: Schema.String,
  module_path: Schema.String,
  title: Schema.String,
  resource_uri: Schema.String,
};
export const ConveneResourceSearchItem = Schema.Union([
  Schema.Struct({
    ...referenceFields,
    kind: Schema.Literal("issue"),
    number: Schema.Int,
    state: Schema.Literals(["OPEN", "CLOSED"]),
  }),
  Schema.Struct({
    ...referenceFields,
    kind: Schema.Literal("document"),
    relative_path: Schema.String,
  }),
]);
export const ConveneResourceSearchPage = Schema.Struct({
  items: Schema.Array(ConveneResourceSearchItem),
  total: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  page: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  page_size: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })),
});
export const ConveneResourceSearchResult = Schema.Union([
  Schema.Struct({ status: Schema.Literal("ready"), ...ConveneResourceSearchPage.fields }),
  Schema.Struct({
    status: Schema.Literals([
      "disconnected",
      "projectUnavailable",
      "mcpDisabled",
      "capabilityDisabled",
      "scopeInsufficient",
      "unauthorized",
      "unavailable",
    ]),
  }),
]);
export type ConveneResourceSearchResult = typeof ConveneResourceSearchResult.Type;

export const ConveneResourceReadInput = Schema.Struct({
  threadId: ThreadId,
  uri: Schema.NonEmptyString,
  page: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  startLine: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
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

export const ConveneDocumentResource = Schema.Struct({
  status: Schema.Literal("ready"),
  resource_uri: Schema.String,
  web_path: Schema.String,
  document: Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    version: Schema.Int,
    mime_type: Schema.NullOr(Schema.String),
  }),
  content: Schema.String,
  slice: Schema.Struct({
    start_line: Schema.Int,
    end_line: Schema.NullOr(Schema.Int),
    returned_lines: Schema.Int,
    total_lines: Schema.Int,
    has_more_before: Schema.Boolean,
    has_more_after: Schema.Boolean,
    next_start_line: Schema.NullOr(Schema.Int),
    truncated: Schema.Boolean,
  }),
});

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
  Schema.Struct({ ...ConveneDocumentResource.fields, web_url: Schema.String }),
  ConveneResourceFailure,
]);
export type ConveneResourceReadResult = typeof ConveneResourceReadResult.Type;
