import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { type ClaudeSettings, TextGenerationError } from "@t3tools/contracts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import { deepMerge } from "@t3tools/shared/Struct";

import { compileClaudeModelSelection } from "../claudeModelOptions.ts";
import * as TextGenerationOperations from "@t3tools/provider-core/server/textGenerationOperations";
import {
  normalizeCliError,
  toJsonSchemaObject,
} from "@t3tools/provider-core/server/textGenerationUtils";

import {
  BUNDLED_CLAUDE_MODEL_CATALOG,
  type ClaudeModelCatalog,
  scopeClaudeModelCatalog,
} from "../provider/ClaudeModelCatalog.ts";
import {
  hasClaudeManagedMcpConfig,
  makeClaudeEnvironment,
} from "../provider/Drivers/ClaudeHome.ts";
import { readClaudeUserSettings } from "../provider/Drivers/ClaudeSkills.ts";
import { readClaudeLaunchArgSettings } from "../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import { resolveAttachmentPath } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";

const CLAUDE_TIMEOUT_MS = 180_000;
/** `--tools` takes bare names; patterns go in the allow list. */
const CLAUDE_INVESTIGATION_TOOLS = "Read,Grep,Glob,Bash";
/** In dontAsk mode every call outside this list, Bash included, is refused. */
const CLAUDE_INVESTIGATION_ALLOWED = [
  "Read",
  "Grep",
  "Glob",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git show:*)",
].join(",");
// Denies override allows; block git --output/-o because allowed trailing args can otherwise write anywhere.
const CLAUDE_INVESTIGATION_DENIED = ["Bash(git * --output*)", "Bash(git * -o *)"].join(",");

/** Keep provider settings and deny rules without admitting the user's normal tool approvals. */
function investigationSettings(
  userSettings: Record<string, unknown> | undefined,
  launchArgSettings: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const { permissions: _, ...settings } = deepMerge(userSettings ?? {}, launchArgSettings ?? {});
  const deny = [userSettings, launchArgSettings].flatMap((source) => {
    const permissions = source?.permissions;
    return Predicate.isObject(permissions) && Array.isArray(permissions.deny)
      ? permissions.deny
      : [];
  });
  return deny.length > 0 ? { ...settings, permissions: { deny: [...new Set(deny)] } } : settings;
}

const NO_SESSION_PERSISTENCE = "--no-session-persistence";
const NO_SESSION_PERSISTENCE_REJECTED = `error: unknown option '${NO_SESSION_PERSISTENCE}'`;
const IMAGES_UNSUPPORTED =
  /image[^\n]*(?:not support|unsupported)|(?:not support|unsupported)[^\n]*image/i;

const ClaudeOutputEnvelope = Schema.Struct({
  structured_output: Schema.Unknown,
});
const ClaudeOutputMessage = Schema.Struct({
  type: Schema.String,
  structured_output: Schema.optionalKey(Schema.Unknown),
});
const isClaudeOutputEnvelope = Schema.is(ClaudeOutputEnvelope);

const encodeJsonString = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeClaudeOutput = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Union([ClaudeOutputEnvelope, Schema.Array(ClaudeOutputMessage)])),
);

// Only `success` results carry `result`; error subtypes such as
// error_max_structured_output_retries report through `errors` instead.
const ClaudeErrorResult = Schema.Struct({
  is_error: Schema.Literal(true),
  result: Schema.optionalKey(Schema.String),
  errors: Schema.optionalKey(Schema.Array(Schema.String)),
});
const isClaudeErrorResult = Schema.is(ClaudeErrorResult);
const decodeJsonOption = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

// Claude reports JSON errors on stdout; stderr may contain only wrapper notices.
function claudeErrorResult(stdout: string): string | undefined {
  const output = Option.getOrUndefined(decodeJsonOption(stdout));
  const messages: ReadonlyArray<unknown> = Array.isArray(output) ? output : [output];
  return messages
    .filter(isClaudeErrorResult)
    .map((message) =>
      (
        message.result ??
        // error_during_execution mixes CLI telemetry into the list.
        message.errors?.filter((error) => !error.startsWith("[ede_diagnostic]")).join("\n") ??
        ""
      ).trim(),
    )
    .findLast((result) => result.length > 0);
}

export const makeClaudeTextGeneration = Effect.fn("makeClaudeTextGeneration")(function* (
  claudeSettings: ClaudeSettings,
  environment?: NodeJS.ProcessEnv,
  modelCatalog: (cwd: string) => Effect.Effect<ClaudeModelCatalog> = () =>
    Effect.succeed(BUNDLED_CLAUDE_MODEL_CATALOG),
) {
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const claudeEnvironment = yield* makeClaudeEnvironment(claudeSettings, environment);
  const textOnlyModels = new Set<string>();

  const readStreamAsString = <E>(
    operation: string,
    stream: Stream.Stream<Uint8Array, E>,
  ): Effect.Effect<string, TextGenerationError> =>
    stream.pipe(
      Stream.decodeText(),
      Stream.runFold(
        () => "",
        (acc, chunk) => acc + chunk,
      ),
      Effect.mapError((cause) =>
        normalizeCliError("claude", operation, cause, "Failed to collect process output"),
      ),
    );

  const encodeJsonForOperation = (
    operation: TextGenerationOperations.Operation,
    value: unknown,
    detail: string,
  ): Effect.Effect<string, TextGenerationError> =>
    encodeJsonString(value).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation,
            detail,
            cause,
          }),
      ),
    );

  const readImageBlocks = Effect.fn("readImageBlocks")(function* (
    attachments: TextGenerationOperations.Request<Schema.Top>["attachments"],
  ) {
    const blocks: Array<{
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    }> = [];
    for (const attachment of attachments ?? []) {
      if (attachment.type !== "image") continue;
      const attachmentPath = resolveAttachmentPath({
        attachmentsDir: serverConfig.attachmentsDir,
        attachment,
      });
      if (!attachmentPath) continue;
      const bytes = yield* fileSystem
        .readFile(attachmentPath)
        .pipe(Effect.orElseSucceed(() => null));
      if (!bytes) continue;
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: attachment.mimeType,
          data: Buffer.from(bytes).toString("base64"),
        },
      });
    }
    return blocks;
  });

  const runClaudeJson = Effect.fn("runClaudeJson")(function* <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchema: outputSchemaJson,
    modelSelection,
    investigate,
    attachments,
  }: TextGenerationOperations.Request<S>): Effect.fn.Return<
    S["Type"],
    TextGenerationError,
    S["DecodingServices"] | Scope.Scope
  > {
    const jsonSchemaStr = yield* encodeJsonForOperation(
      operation,
      toJsonSchemaObject(outputSchemaJson),
      "Failed to encode structured output schema.",
    );
    const runClaudeCommand = Effect.fn("runClaudeJson.runClaudeCommand")(function* (
      noSessionPersistence: boolean,
      withImages: boolean,
    ) {
      const workingDirectory =
        operation === "generateThreadTitle"
          ? yield* fileSystem
              .makeTempDirectoryScoped({ prefix: "t3code-claude-title-" })
              .pipe(
                Effect.mapError((cause) =>
                  normalizeCliError("claude", operation, cause, "Failed to create title directory"),
                ),
              )
          : cwd;
      const catalog = scopeClaudeModelCatalog(
        yield* modelCatalog(workingDirectory),
        claudeSettings.customModels,
      );
      const compiled = yield* Effect.try({
        try: () => compileClaudeModelSelection(modelSelection, catalog),
        catch: (cause) =>
          normalizeCliError("claude", operation, cause, "Invalid Claude model configuration"),
      });
      const cliEffort = compiled.effort;
      const launchArgSettings = yield* readClaudeLaunchArgSettings({
        settings: claudeSettings,
        cwd: investigate?.projectCwd ?? cwd,
        fileSystem,
        path,
      }).pipe(
        Effect.mapError(
          (cause) => new TextGenerationError({ operation, detail: cause.message, cause }),
        ),
      );
      const settings = {
        ...(investigate
          ? investigationSettings(
              yield* readClaudeUserSettings(
                claudeSettings,
                workingDirectory,
                claudeEnvironment,
              ).pipe(
                Effect.provideService(FileSystem.FileSystem, fileSystem),
                Effect.provideService(Path.Path, path),
              ),
              launchArgSettings,
            )
          : launchArgSettings),
        disableAllHooks: true,
        ...compiled.settings,
      };
      const settingsJson = yield* encodeJsonForOperation(
        operation,
        settings,
        "Failed to encode Claude CLI settings.",
      );
      // The user's settings can hold credentials; a file keeps them out of the process list.
      const settingsArgument = investigate
        ? yield* fileSystem
            .makeTempFileScoped({ prefix: "t3code-claude-settings-", suffix: ".json" })
            .pipe(
              Effect.tap((filePath) => fileSystem.writeFileString(filePath, settingsJson)),
              Effect.mapError((cause) =>
                normalizeCliError(
                  "claude",
                  operation,
                  cause,
                  "Failed to write Claude CLI settings",
                ),
              ),
            )
        : settingsJson;

      // `claude -p` accepts images only as content blocks of a stream-json user message.
      const imageBlocks =
        withImages &&
        (compiled.apiModelId === undefined || !textOnlyModels.has(compiled.apiModelId))
          ? yield* readImageBlocks(attachments)
          : [];
      const streamJson = imageBlocks.length > 0;
      const stdin = streamJson
        ? `${yield* encodeJsonForOperation(
            operation,
            {
              type: "user",
              message: { role: "user", content: [{ type: "text", text: prompt }, ...imageBlocks] },
            },
            "Failed to encode Claude CLI input.",
          )}\n`
        : prompt;

      const managedMcpConfig = yield* hasClaudeManagedMcpConfig();
      const spawnCommand = yield* resolveSpawnCommand(
        claudeSettings.binaryPath || "claude",
        [
          "-p",
          ...(streamJson
            ? ["--input-format", "stream-json", "--output-format", "stream-json", "--verbose"]
            : ["--output-format", "json"]),
          "--json-schema",
          jsonSchemaStr,
          ...(compiled.apiModelId === undefined ? [] : ["--model", compiled.apiModelId]),
          ...(cliEffort ? ["--effort", cliEffort] : []),
          "--settings",
          settingsArgument,
          ...(investigate
            ? [
                "--tools",
                CLAUDE_INVESTIGATION_TOOLS,
                "--allowedTools",
                CLAUDE_INVESTIGATION_ALLOWED,
                "--disallowedTools",
                CLAUDE_INVESTIGATION_DENIED,
              ]
            : ["--tools", ""]),
          ...(investigate ? ["--setting-sources", ""] : []),
          "--disable-slash-commands",
          ...(noSessionPersistence ? [NO_SESSION_PERSISTENCE] : []),
          // managed-mcp.json already isolates servers and makes Claude reject this flag.
          ...(managedMcpConfig ? [] : ["--strict-mcp-config"]),
          "--permission-mode",
          "dontAsk",
        ],
        { env: { ...claudeEnvironment, ...compiled.environment } },
      );
      const command = ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: { ...claudeEnvironment, ...compiled.environment },
        cwd: workingDirectory,
        shell: spawnCommand.shell,
        stdin: {
          stream: Stream.encodeText(Stream.make(stdin)),
        },
        forceKillAfter: "1 second",
      });

      const child = yield* commandSpawner
        .spawn(command)
        .pipe(
          Effect.mapError((cause) =>
            normalizeCliError("claude", operation, cause, "Failed to spawn Claude CLI process"),
          ),
        );

      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          readStreamAsString(operation, child.stdout),
          readStreamAsString(operation, child.stderr),
          child.exitCode.pipe(
            Effect.mapError((cause) =>
              normalizeCliError("claude", operation, cause, "Failed to read Claude CLI exit code"),
            ),
          ),
        ],
        { concurrency: "unbounded" },
      );

      // stream-json prints one message per line and ends with the result message.
      return {
        stdout: streamJson ? (stdout.trim().split("\n").at(-1) ?? "") : stdout,
        stderr,
        exitCode,
        sentImages: streamJson,
        apiModelId: compiled.apiModelId,
      };
    });

    const runClaudeAttempt = (withImages: boolean) =>
      runClaudeCommand(true, withImages).pipe(
        Effect.filterOrElse(
          (result) =>
            result.exitCode === 0 || !result.stderr.includes(NO_SESSION_PERSISTENCE_REJECTED),
          () => runClaudeCommand(false, withImages),
        ),
      );
    const rawStdout = yield* runClaudeAttempt(true).pipe(
      Effect.filterOrElse(
        (result) => result.exitCode === 0 || !result.sentImages,
        (imageResult) =>
          runClaudeAttempt(false).pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                // A size or count limit leaves future image attempts enabled.
                if (
                  result.exitCode === 0 &&
                  imageResult.apiModelId !== undefined &&
                  imageResult.apiModelId === result.apiModelId &&
                  IMAGES_UNSUPPORTED.test(`${imageResult.stdout}\n${imageResult.stderr}`)
                ) {
                  textOnlyModels.add(imageResult.apiModelId);
                }
              }),
            ),
          ),
      ),
      Effect.flatMap(({ stdout, stderr, exitCode }) => {
        if (exitCode === 0) return Effect.succeed(stdout);
        const stderrDetail = stderr.trim();
        const stdoutDetail = stdout.trim();
        const detail =
          claudeErrorResult(stdoutDetail) ??
          (stderrDetail.length > 0 ? stderrDetail : stdoutDetail);
        return Effect.fail(
          new TextGenerationError({
            operation,
            detail:
              detail.length > 0
                ? `Claude CLI command failed: ${detail}`
                : `Claude CLI command failed with code ${exitCode}.`,
          }),
        );
      }),
      Effect.scoped,
      Effect.timeoutOption(investigate?.timeoutMs ?? CLAUDE_TIMEOUT_MS),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new TextGenerationError({ operation, detail: "Claude CLI request timed out." }),
            ),
          onSome: (value) => Effect.succeed(value),
        }),
      ),
    );

    const output = yield* decodeClaudeOutput(rawStdout).pipe(
      Effect.catchTags({
        SchemaError: (cause) =>
          Effect.fail(
            new TextGenerationError({
              operation,
              detail: "Claude CLI returned unexpected output format.",
              cause,
            }),
          ),
      }),
    );
    const envelope = isClaudeOutputEnvelope(output)
      ? output
      : output.findLast((message) => message.type === "result");

    const decodeOutput = Schema.decodeEffect(outputSchemaJson);
    return yield* decodeOutput(envelope?.structured_output).pipe(
      Effect.catchTags({
        SchemaError: (cause) =>
          Effect.fail(
            new TextGenerationError({
              operation,
              detail: "Claude returned invalid structured output.",
              cause,
            }),
          ),
      }),
    );
  });

  return TextGenerationOperations.fromRunner(
    "ClaudeTextGeneration",
    <S extends Schema.Top>(request: TextGenerationOperations.Request<S>) =>
      Effect.scoped(runClaudeJson(request)),
  );
});
