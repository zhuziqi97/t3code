import {
  ANTIGRAVITY_DEFAULT_MODEL,
  ProviderDriverKind,
  ProviderInstanceId,
  type OrchestrationV2ProviderCapabilities,
  type ProviderSetupError,
} from "@t3tools/contracts";
import type { SelfInvocation } from "@t3tools/shared/nodeRuntime";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/compat";

import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import type { AntigravityAuth } from "../../provider/AntigravityAuth.ts";
import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import {
  antigravityPermissionMode,
  applyAntigravityAcpModelSelection,
  buildAntigravityPrompt,
  type AntigravityAcpRuntimeInput,
} from "../../provider/acp/AntigravityAcpSupport.ts";
import {
  readAntigravityClientTextFile,
  writeAntigravityClientTextFile,
} from "../../provider/acp/AntigravityClientFiles.ts";
import {
  antigravityApprovalOptions,
  antigravitySubagentOutput,
  classifyAntigravitySubagentToolCall,
  extractAntigravityUserInputQuestion,
  makeAntigravityUserInputResponse,
  normalizeAntigravityToolCall,
} from "../../provider/acp/AntigravityProtocol.ts";
import {
  AcpProviderCapabilitiesV2,
  makeAcpAdapterV2,
  type AcpAdapterV2Flavor,
  type AcpAdapterV2RuntimeInput,
} from "@t3tools/provider-acp/server/adapter";

const ANTIGRAVITY_PROVIDER = ProviderDriverKind.make("antigravity");

const AntigravityProviderCapabilitiesV2 = {
  ...AcpProviderCapabilitiesV2,
  sessions: {
    ...AcpProviderCapabilitiesV2.sessions,
    supportsModelSwitchInSession: true,
    supportsRuntimeModeSwitchInSession: true,
  },
  tools: {
    ...AcpProviderCapabilitiesV2.tools,
    supportsMcpTools: true,
  },
  subagents: {
    ...AcpProviderCapabilitiesV2.subagents,
    supportsSubagents: true,
  },
} satisfies OrchestrationV2ProviderCapabilities;

export interface AntigravityAdapterV2Options {
  readonly userMcpServers: (cwd: string) => Effect.Effect<ReadonlyArray<EffectAcpSchema.McpServer>>;
  readonly instanceId: ProviderInstanceId;
  readonly selfInvocation: SelfInvocation;
  readonly makeRuntime: (
    input: Omit<AntigravityAcpRuntimeInput, "spawn" | "childProcessSpawner">,
  ) => Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError | ProviderSetupError,
    Scope.Scope
  >;
  readonly withProcess: AntigravityAuth["withProcess"];
  readonly defaultModel: Effect.Effect<string | undefined>;
  readonly onSessionStarted?: (
    started: AcpSessionRuntime.AcpSessionRuntimeStartResult,
    cwd: string,
  ) => Effect.Effect<void>;
  readonly onSessionEvent?: AcpAdapterV2Flavor["onSessionEvent"];
  readonly nativeLogging?: Parameters<typeof makeAcpAdapterV2>[0]["nativeLogging"];
  readonly continuationRequests?: Parameters<typeof makeAcpAdapterV2>[0]["continuationRequests"];
}

/** ACP 1.1.1 reports `start_subagent` tools without child session ids. */
const extractAntigravitySubagentUpdate: NonNullable<AcpAdapterV2Flavor["extractSubagentUpdate"]> = (
  toolCall,
) => {
  if (classifyAntigravitySubagentToolCall(toolCall) !== "subagent") {
    return undefined;
  }
  const status =
    toolCall.status === "failed" ? "failed" : toolCall.status === "pending" ? "pending" : "running";
  return {
    nativeTaskId: toolCall.toolCallId,
    prompt:
      antigravitySubagentOutput(toolCall) ??
      toolCall.detail ??
      toolCall.title ??
      "Antigravity subagent batch",
    title: "Antigravity subagent batch",
    model: null,
    status,
    childSessionId: null,
    result: status === "failed" ? (antigravitySubagentOutput(toolCall) ?? null) : null,
  };
};

interface AntigravityFlavorServices {
  readonly crypto: Crypto.Crypto;
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly host: ProviderHost.ProviderHost["Service"];
}

export function makeAntigravityAcpAdapterFlavor(
  options: AntigravityAdapterV2Options & AntigravityFlavorServices,
): AcpAdapterV2Flavor {
  const antigravityClientFileRoots = (cwd: string | null) =>
    cwd === null ? [options.host.paths.attachmentsDir] : [cwd, options.host.paths.attachmentsDir];
  const makeRuntime = Effect.fn("AntigravityAdapterV2.makeRuntime")(
    function* (input: AcpAdapterV2RuntimeInput) {
      const scope = yield* Scope.fork(yield* Effect.scope);
      const systemServers = yield* options.userMcpServers(input.cwd);
      const runtime = yield* options
        .withProcess(
          Scope.close(scope, Exit.void),
          options.makeRuntime({
            ...input,
            mcpServers: [...systemServers, ...input.mcpServers],
            acpMcpServers: [...systemServers, ...(input.acpMcpServers ?? input.mcpServers)],
            clientFileSystem: true,
            additionalDirectories: [options.host.paths.attachmentsDir],
          }),
        )
        .pipe(Effect.provideService(Scope.Scope, scope));
      // New activations re-read the source. The native merge keeps the last
      // client definition of a name, including a project's injected service.
      const systemMcpActivation = (
        activation: AcpSessionRuntime.AcpSessionActivationOptions | undefined,
      ) =>
        options.userMcpServers(input.cwd).pipe(
          Effect.map((servers) => ({
            mcpServers: [...servers, ...(activation?.mcpServers ?? input.mcpServers)],
            acpMcpServers: [
              ...servers,
              ...(activation?.acpMcpServers ?? input.acpMcpServers ?? input.mcpServers),
            ],
          })),
        );
      return {
        ...runtime,
        loadSession: (...[id, activation]: Parameters<typeof runtime.loadSession>) =>
          systemMcpActivation(activation).pipe(
            Effect.flatMap((options) => runtime.loadSession(id, options)),
          ),
        resumeSession: (...[id, activation]: Parameters<typeof runtime.resumeSession>) =>
          systemMcpActivation(activation).pipe(
            Effect.flatMap((options) => runtime.resumeSession(id, options)),
          ),
        forkSession: (...[id, activation]: Parameters<typeof runtime.forkSession>) =>
          systemMcpActivation(activation).pipe(
            Effect.flatMap((options) => runtime.forkSession(id, options)),
          ),
        start: () =>
          runtime
            .start()
            .pipe(
              Effect.tap(
                (started) => options.onSessionStarted?.(started, input.cwd) ?? Effect.void,
              ),
            ),
      };
    },
    Effect.provideService(Crypto.Crypto, options.crypto),
    Effect.mapError((cause): EffectAcpErrors.AcpError =>
      cause._tag === "ProviderSetupError"
        ? new EffectAcpErrors.AcpTransportError({ detail: cause.detail, cause })
        : cause,
    ),
  );

  return {
    driver: ANTIGRAVITY_PROVIDER,
    runtimeHarness: "Antigravity",
    capabilities: AntigravityProviderCapabilitiesV2,
    makeRuntime,
    buildPrompt: ({ text, attachments, promptCapabilities }) =>
      buildAntigravityPrompt({
        input: text,
        attachments,
        attachmentsDir: options.host.paths.attachmentsDir,
        promptCapabilities,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, options.fileSystem),
        Effect.provideService(Path.Path, options.path),
      ),
    // Loading history replays tool calls; resume avoids replay.
    preferResumeSession: true,
    subagentsIdleOnTurnCompletion: true,
    ...(options.onSessionEvent === undefined ? {} : { onSessionEvent: options.onSessionEvent }),
    applyModelSelection: Effect.fn("AntigravityAdapterV2.applyModelSelection")(function* ({
      runtime,
      modelSelection,
    }) {
      const defaultModel = yield* options.defaultModel;
      return yield* applyAntigravityAcpModelSelection({
        runtime,
        model:
          modelSelection.model === null || modelSelection.model === ANTIGRAVITY_DEFAULT_MODEL
            ? undefined
            : modelSelection.model,
        defaultModel,
        mapError: (cause) => cause,
      });
    }),
    sessionModeForPolicy: (policy) => antigravityPermissionMode(policy.runtimeMode),
    clientFileSystem: {
      readTextFile: (request, cwd) =>
        readAntigravityClientTextFile({
          fileSystem: options.fileSystem,
          path: options.path,
          allowedRoots: antigravityClientFileRoots(cwd),
          request,
        }),
      writeTextFile: (request, cwd) =>
        writeAntigravityClientTextFile({
          fileSystem: options.fileSystem,
          path: options.path,
          allowedRoots: antigravityClientFileRoots(cwd),
          request,
        }),
    },
    approvalOptions: antigravityApprovalOptions,
    extractPermissionQuestion: (request) => {
      const question = extractAntigravityUserInputQuestion(request);
      if (question === undefined) return undefined;
      return {
        question,
        respond: (answers) => makeAntigravityUserInputResponse(request, answers),
      };
    },
    normalizeToolCall: normalizeAntigravityToolCall,
    extractSubagentUpdate: extractAntigravitySubagentUpdate,
    supportsImagePrompts: true,
    supportsCompaction: true,
  };
}

export const makeAntigravityAdapterV2 = Effect.fn("makeAntigravityAdapterV2")(function* (
  options: AntigravityAdapterV2Options,
) {
  const services: AntigravityFlavorServices = {
    crypto: yield* Crypto.Crypto,
    fileSystem: yield* FileSystem.FileSystem,
    path: yield* Path.Path,
    host: yield* ProviderHost.ProviderHost,
  };
  return yield* makeAcpAdapterV2({
    instanceId: options.instanceId,
    flavor: makeAntigravityAcpAdapterFlavor({ ...options, ...services }),
    selfInvocation: options.selfInvocation,
    ...(options.nativeLogging === undefined ? {} : { nativeLogging: options.nativeLogging }),
    ...(options.continuationRequests === undefined
      ? {}
      : { continuationRequests: options.continuationRequests }),
  });
});
