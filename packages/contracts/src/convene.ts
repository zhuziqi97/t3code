import * as Schema from "effect/Schema";
import {
  CommandId,
  MessageId,
  ProjectId,
  RunId,
  RuntimeRequestId,
  ThreadId,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import {
  ProviderApprovalDecision,
  ProviderUserInputAnswers,
  ProviderInteractionMode,
  RuntimeMode,
} from "./providerPolicy.ts";
import { ServerProvider } from "./server.ts";
import {
  OrchestrationV2AppThreadJson,
  OrchestrationV2ProjectedTurnItemJson,
  OrchestrationV2RunJson,
  OrchestrationV2RuntimeRequestJson,
  OrchestrationV2ThreadShellJson,
  OrchestrationV2TurnItemJson,
} from "./orchestrationV2.ts";

const destination = {
  projectId: ProjectId,
  workspaceKey: Schema.NonEmptyString,
};

/** The platform names a reported workspace; it cannot supply an arbitrary cwd. */
export const ConveneNativeRequest = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("OPTIONS"), ...destination }),
  Schema.Struct({ operation: Schema.Literal("LIST"), ...destination }),
  Schema.Struct({
    operation: Schema.Literal("CREATE"),
    ...destination,
    commandId: CommandId,
    threadId: ThreadId,
    title: Schema.NonEmptyString,
    modelSelection: ModelSelection,
    runtimeMode: RuntimeMode,
    interactionMode: ProviderInteractionMode,
  }),
  Schema.Struct({
    operation: Schema.Literal("QUERY"),
    ...destination,
    threadId: ThreadId,
    afterPosition: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
    limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  }),
  Schema.Struct({
    operation: Schema.Literal("SEND"),
    ...destination,
    commandId: CommandId,
    threadId: ThreadId,
    messageId: MessageId,
    message: Schema.NonEmptyString,
  }),
  Schema.Struct({
    operation: Schema.Literal("RESPOND"),
    ...destination,
    commandId: CommandId,
    threadId: ThreadId,
    requestId: RuntimeRequestId,
    decision: Schema.optional(ProviderApprovalDecision),
    answers: Schema.optional(ProviderUserInputAnswers),
  }),
  Schema.Struct({
    operation: Schema.Literal("CANCEL"),
    ...destination,
    commandId: CommandId,
    threadId: ThreadId,
    runId: Schema.optional(RunId),
  }),
]);
export type ConveneNativeRequest = typeof ConveneNativeRequest.Type;

export const ConveneNativeResult = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("options"),
    defaultModelSelection: Schema.NullOr(ModelSelection),
    providers: Schema.Array(Schema.Struct({ provider: ServerProvider, supported: Schema.Boolean })),
  }),
  Schema.Struct({
    type: Schema.Literal("threads"),
    threads: Schema.Array(OrchestrationV2ThreadShellJson),
  }),
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    thread: OrchestrationV2AppThreadJson,
    runs: Schema.Array(OrchestrationV2RunJson),
    requests: Schema.Array(
      Schema.Struct({
        ...OrchestrationV2RuntimeRequestJson.fields,
        item: Schema.NullOr(OrchestrationV2TurnItemJson),
      }),
    ),
    items: Schema.Array(OrchestrationV2ProjectedTurnItemJson),
    sequence: Schema.Number,
    hasMore: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("receipt"),
    threadId: ThreadId,
    accepted: Schema.Boolean,
    sequence: Schema.NullOr(Schema.Number),
    runId: Schema.NullOr(RunId),
  }),
]);
export type ConveneNativeResult = typeof ConveneNativeResult.Type;

export const ConveneDataControl = Schema.Struct({
  TYPE: Schema.Literals(["OPEN_DATA_CHANNEL", "CANCEL_DATA_CHANNEL"]),
  REQUEST_ID: Schema.String,
  CONNECTION_ID: Schema.String,
  KIND: Schema.optional(Schema.Literals(["HTTP", "WS"])),
});
export const ConveneHttpOpen = Schema.Struct({
  TYPE: Schema.Literal("HTTP_OPEN"),
  METHOD: Schema.Literals(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
  PATH: Schema.String,
  HEADERS: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
  ACCESS: Schema.Literals(["NATIVE", "WEB"]),
});
export const ConveneWsOpen = Schema.Struct({
  TYPE: Schema.Literal("WS_OPEN"),
  PATH: Schema.String,
  PROTOCOL: Schema.NullOr(Schema.String),
  ACCESS: Schema.Literal("WEB"),
});
export const ConveneHttpEnd = Schema.Struct({ TYPE: Schema.Literal("HTTP_END") });

export const ConveneStatus = Schema.Struct({
  platformUrls: Schema.Array(Schema.String),
  phase: Schema.Literals(["unpaired", "connecting", "online", "offline"]),
  baseUrl: Schema.NullOr(Schema.String),
  runnerId: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export type ConveneStatus = typeof ConveneStatus.Type;
export const ConvenePairing = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  expires_in: Schema.Number,
  interval: Schema.Number,
});
export const ConveneTarget = Schema.Struct({
  target_id: Schema.String,
  native_workspace_key: Schema.String,
  path: Schema.NullOr(Schema.String),
  workspace_display_name: Schema.String,
  branch: Schema.NullOr(Schema.String),
  availability: Schema.Literals(["AVAILABLE", "UNAVAILABLE"]),
});
const ConveneBinding = Schema.Struct({
  binding_id: Schema.String,
  module_id: Schema.String,
  runner_id: Schema.String,
  client_project_id: Schema.String,
  target_id: Schema.NullOr(Schema.String),
  status: Schema.Literals(["ACTIVE", "DISABLED", "REVOKED"]),
});
export const ConveneMcpScope = Schema.Struct({
  module_id: Schema.String,
  permission: Schema.Literals(["READ", "WRITE"]),
});
export const ConveneMcpCapabilities = Schema.Struct({
  code_graph_enabled: Schema.Boolean,
  forge_enabled: Schema.Boolean,
  issue_enabled: Schema.Boolean,
});
const ConveneModuleDetail = Schema.Struct({
  module_id: Schema.String,
  module_name: Schema.String,
  project_id: Schema.String,
  project_name: Schema.String,
  can_write: Schema.Boolean,
});
export const ConveneProjectConfiguration = Schema.Struct({
  runner_id: Schema.String,
  runner_name: Schema.String,
  client_project_id: Schema.String,
  project: Schema.Struct({ native_project_id: Schema.String, display_name: Schema.String }),
  targets: Schema.Array(ConveneTarget),
  bindings: Schema.Array(ConveneBinding),
  mcp_enabled: Schema.Boolean,
  mcp_scope_modules: Schema.Array(ConveneMcpScope),
  mcp_capabilities: ConveneMcpCapabilities,
  mcp_scope_details: Schema.Array(ConveneModuleDetail),
  binding_module_details: Schema.Array(ConveneModuleDetail),
});
export type ConveneProjectConfiguration = typeof ConveneProjectConfiguration.Type;
export const ConveneProjectView = Schema.Struct({
  configuration: Schema.NullOr(ConveneProjectConfiguration),
  fresh: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
});
export const ConveneManageInput = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("pair"), baseUrl: Schema.NonEmptyString }),
  Schema.Struct({ operation: Schema.Literal("change-address"), baseUrl: Schema.NonEmptyString }),
  Schema.Struct({
    operation: Schema.Literal("exchange"),
    baseUrl: Schema.NonEmptyString,
    deviceCode: Schema.NonEmptyString,
  }),
  Schema.Struct({ operation: Schema.Literals(["reconnect", "disconnect"]) }),
]);
export const ConveneManageResult = Schema.Union([
  Schema.Struct({ type: Schema.Literal("pairing"), pairing: ConvenePairing }),
  Schema.Struct({ type: Schema.Literal("pending") }),
  Schema.Struct({ type: Schema.Literal("status"), status: ConveneStatus }),
]);
export const ConveneProjectMutation = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("save"),
    projectId: ProjectId,
    mcp_enabled: Schema.Boolean,
    mcp_scope_modules: Schema.Array(ConveneMcpScope),
    mcp_capabilities: ConveneMcpCapabilities,
  }),
  Schema.Struct({
    operation: Schema.Literal("bind"),
    projectId: ProjectId,
    module_id: Schema.String,
  }),
  Schema.Struct({
    operation: Schema.Literals(["unbind", "deactivate"]),
    projectId: ProjectId,
    binding_id: Schema.String,
  }),
  Schema.Struct({
    operation: Schema.Literal("select-target"),
    projectId: ProjectId,
    binding_id: Schema.String,
    target_id: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    operation: Schema.Literal("activate"),
    projectId: ProjectId,
    binding_id: Schema.String,
    target_id: Schema.String,
  }),
]);
export type ConveneProjectMutation = typeof ConveneProjectMutation.Type;
export const ConveneProjectOptionsInput = Schema.Struct({
  projectId: Schema.optional(Schema.String),
  page: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  search: Schema.String,
});
export const ConveneProjectOptions = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      display_name: Schema.NullOr(Schema.String),
      path: Schema.String,
      can_write: Schema.optional(Schema.Boolean),
    }),
  ),
  total: Schema.Number,
  truncated: Schema.Boolean,
});
export class ConveneIntegrationError extends Schema.TaggedError<ConveneIntegrationError>()(
  "ConveneIntegrationError",
  {
    operation: Schema.String,
    code: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Convene ${this.operation} failed (${this.code}).`;
  }
}
