import {
  ConveneNativeRequest,
  type ConveneNativeResult,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ConveneWorkspaces from "./ConveneWorkspaces.ts";

export class ConveneNativeError extends Schema.TaggedError<ConveneNativeError>()(
  "ConveneNativeError",
  {
    operation: Schema.String,
    category: Schema.Literals([
      "invalid_request",
      "workspace_unavailable",
      "wrong_workspace",
      "unsupported_provider",
      "native_operation",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Convene native ${this.operation} failed (${this.category}).`;
  }
}

export class ConveneNative extends Context.Service<
  ConveneNative,
  {
    readonly handle: (
      request: ConveneNativeRequest,
    ) => Effect.Effect<ConveneNativeResult, ConveneNativeError>;
  }
>()("t3/convene/ConveneNative") {}

const decodeNativeRequest = Schema.decodeEffect(ConveneNativeRequest);
const isNativeError = Schema.is(ConveneNativeError);
const supportedDrivers = new Set(["codex", "claudeAgent"]);

const make = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const fs = yield* FileSystem.FileSystem;
  const workspaces = yield* ConveneWorkspaces.ConveneWorkspaces;

  const destination = Effect.fn("ConveneNative.destination")(function* (
    request: ConveneNativeRequest,
  ) {
    const project = yield* projects.get(request.projectId);
    if (Option.isNone(project)) {
      return yield* new ConveneNativeError({
        operation: request.operation,
        category: "workspace_unavailable",
      });
    }
    const workspace = yield* workspaces.resolve(request.projectId, request.workspaceKey);
    if (workspace === null) {
      return yield* new ConveneNativeError({
        operation: request.operation,
        category: "wrong_workspace",
      });
    }
    return { ...project.value, workspace };
  });

  const threadAtDestination = Effect.fn("ConveneNative.threadAtDestination")(function* (
    projectId: ProjectId,
    threadId: ThreadId,
    operation: string,
    worktreePath: string | null,
    workspaceKey: string,
  ) {
    const projection = yield* threads.getProjectThreadRecords({ projectId, threadId }, []);
    const originalKey = yield* workspaces.threadKey(projectId, threadId);
    if (
      projection.thread.worktreePath !== worktreePath ||
      (originalKey !== null && originalKey !== workspaceKey)
    ) {
      return yield* new ConveneNativeError({ operation, category: "wrong_workspace" });
    }
    return projection;
  });

  const handle = Effect.fn("ConveneNative.handle")(function* (
    request: ConveneNativeRequest,
  ): Effect.fn.Return<ConveneNativeResult, ConveneNativeError> {
    // Public callers can reach the service from more than one transport.
    const input = yield* decodeNativeRequest(request).pipe(
      Effect.mapError(
        (cause) =>
          new ConveneNativeError({
            operation: request.operation,
            category: "invalid_request",
            cause,
          }),
      ),
    );
    const native = Effect.gen(function* () {
      const project = yield* destination(input);
      if (input.operation === "OPTIONS") {
        return {
          type: "options" as const,
          defaultModelSelection: project.defaultModelSelection,
          providers: (yield* providers.getProviders).map((provider) => ({
            provider,
            supported: supportedDrivers.has(provider.driver),
          })),
        };
      }
      if (input.operation === "LIST") {
        const listed = yield* threads.listProjectThreads({
          projectId: input.projectId,
          includeSubagents: false,
        });
        const matching = yield* Effect.filter(listed, (thread) =>
          workspaces
            .threadKey(input.projectId, thread.id)
            .pipe(
              Effect.map((key) =>
                key === null
                  ? thread.worktreePath ===
                    (input.workspaceKey === "root" ? null : project.workspace.path)
                  : key === input.workspaceKey,
              ),
            ),
        );
        for (const thread of matching)
          yield* workspaces.rememberThread(input.projectId, thread.id, input.workspaceKey);
        return {
          type: "threads" as const,
          threads: matching,
        };
      }
      if (input.operation === "CREATE" || input.operation === "SEND") {
        if (!project.workspace.available) {
          return yield* new ConveneNativeError({
            operation: input.operation,
            category: "workspace_unavailable",
          });
        }
        const stat = yield* fs.stat(project.workspace.path).pipe(
          Effect.mapError(
            (cause) =>
              new ConveneNativeError({
                operation: input.operation,
                category: "workspace_unavailable",
                cause,
              }),
          ),
        );
        if (stat.type !== "Directory") {
          return yield* new ConveneNativeError({
            operation: input.operation,
            category: "workspace_unavailable",
          });
        }
      }
      if (input.operation === "CREATE") {
        const provider = (yield* providers.getProviders).find(
          (candidate) => candidate.instanceId === input.modelSelection.instanceId,
        );
        if (!provider || !supportedDrivers.has(provider.driver)) {
          return yield* new ConveneNativeError({
            operation: input.operation,
            category: "unsupported_provider",
          });
        }
        const receipt = yield* threads.dispatch({
          type: "thread.create",
          commandId: input.commandId,
          threadId: input.threadId,
          projectId: input.projectId,
          title: input.title,
          modelSelection: input.modelSelection,
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
          branch: project.workspace.branch,
          worktreePath: input.workspaceKey === "root" ? null : project.workspace.path,
          createdBy: "agent",
          creationSource: "server",
        });
        yield* workspaces.rememberThread(input.projectId, input.threadId, input.workspaceKey);
        return {
          type: "receipt" as const,
          threadId: input.threadId,
          accepted: true,
          sequence: receipt.sequence,
          runId: null,
        };
      }
      const located = yield* threadAtDestination(
        input.projectId,
        input.threadId,
        input.operation,
        input.workspaceKey === "root" ? null : project.workspace.path,
        input.workspaceKey,
      );
      if (input.operation === "SEND") {
        const provider = (yield* providers.getProviders).find(
          (candidate) => candidate.instanceId === located.thread.modelSelection.instanceId,
        );
        if (!provider || !supportedDrivers.has(provider.driver))
          return yield* new ConveneNativeError({
            operation: input.operation,
            category: "unsupported_provider",
          });
      }
      if (input.operation === "QUERY") {
        const snapshot = yield* threads.getThreadSnapshotWindow(input.threadId, {
          rowLimit: input.limit,
        });
        const page = yield* threads.getTimelinePage(input.threadId, {
          limit: input.limit,
          ...(input.afterPosition === undefined ? {} : { afterPosition: input.afterPosition }),
        });
        return {
          type: "snapshot" as const,
          thread: snapshot.projection.thread,
          runs: snapshot.projection.runs,
          requests: snapshot.projection.runtimeRequests.filter(
            (request) => request.status === "pending",
          ),
          items: page.items,
          sequence: snapshot.snapshotSequence,
          hasMore: page.hasMore,
        };
      }
      if (input.operation === "SEND") {
        const sent = yield* threads.sendToThread({
          projectId: input.projectId,
          threadId: input.threadId,
          commandId: input.commandId,
          messageId: input.messageId,
          text: input.message,
          attachments: [],
          mode: "auto",
          createdBy: "agent",
          creationSource: "server",
        });
        return {
          type: "receipt" as const,
          threadId: input.threadId,
          accepted: true,
          sequence: sent.dispatch.sequence,
          runId: sent.run.id,
        };
      }
      if (input.operation === "CANCEL") {
        const result = yield* threads.interruptThread({
          projectId: input.projectId,
          threadId: input.threadId,
          commandId: input.commandId,
          ...(input.runId === undefined ? {} : { runId: input.runId }),
        });
        return {
          type: "receipt" as const,
          threadId: input.threadId,
          accepted: result.type === "interrupt_requested",
          sequence: result.type === "interrupt_requested" ? result.dispatch.sequence : null,
          runId: result.type === "no_active_run" ? null : result.run.id,
        };
      }
      const receipt = yield* threads
        .dispatch({
          type: "runtime-request.respond",
          commandId: input.commandId,
          threadId: input.threadId,
          requestId: input.requestId,
          ...(input.decision === undefined ? {} : { decision: input.decision }),
          ...(input.answers === undefined ? {} : { answers: input.answers }),
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ConveneNativeError({
                operation: input.operation,
                category: "invalid_request",
                cause,
              }),
          ),
        );
      return {
        type: "receipt" as const,
        threadId: input.threadId,
        accepted: true,
        sequence: receipt.sequence,
        runId: null,
      };
    });
    return yield* native.pipe(
      Effect.mapError((cause) =>
        isNativeError(cause)
          ? cause
          : new ConveneNativeError({
              operation: input.operation,
              category: "native_operation",
              cause,
            }),
      ),
    );
  });
  return ConveneNative.of({ handle });
});

export const layer = Layer.effect(ConveneNative, make);
