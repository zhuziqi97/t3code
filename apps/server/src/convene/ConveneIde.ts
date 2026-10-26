import { ConveneIdeRequest, type ConveneIdeResult } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { applyEdits, findNodeAtLocation, modify, parseTree, type ParseError } from "jsonc-parser";

import * as ServerConfig from "../config.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as CodeServerInstallation from "./CodeServerInstallation.ts";
import * as ConveneWorkspaces from "./ConveneWorkspaces.ts";

export const MANAGEMENT_PATH = "/api/convene/ide";
export const RUNTIME_PREFIX = `${MANAGEMENT_PATH}/code-server/`;

class LanguageSetupError extends Schema.TaggedError<LanguageSetupError>()(
  "LanguageSetupError",
  {},
) {}

export class ConveneIdeError extends Schema.TaggedError<ConveneIdeError>()("ConveneIdeError", {
  code: Schema.Literals([
    "invalid_request",
    "workspace_unavailable",
    "file_outside_workspace",
    "runtime_unavailable",
    "internal_error",
  ]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Could not access this environment's IDE (${this.code}).`;
  }
}

export class ConveneIde extends Context.Service<
  ConveneIde,
  {
    readonly handle: (
      request: ConveneIdeRequest,
    ) => Effect.Effect<ConveneIdeResult, ConveneIdeError>;
    readonly changes: Stream.Stream<ConveneIdeResult>;
    readonly upstream: (runtimeId: string) => Effect.Effect<string, ConveneIdeError>;
  }
>()("t3/convene/ConveneIde") {}

const decodeRequest = Schema.decodeUnknownEffect(ConveneIdeRequest);
const encodePayload = Schema.encodeSync(
  Schema.fromJsonString(Schema.Array(Schema.Tuple([Schema.String, Schema.String]))),
);

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const installation = yield* CodeServerInstallation.CodeServerInstallation;
  const workspaces = yield* ConveneWorkspaces.ConveneWorkspaces;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const environment = yield* HostProcess.Environment;
  const lock = yield* Semaphore.make(1);
  const state = yield* SubscriptionRef.make<ConveneIdeResult>({
    service: "code-server",
    version: CodeServerInstallation.VERSION,
    phase: "stopped",
    runtimeId: null,
    entryPath: null,
    error: null,
  });
  let attempt: { id: string; scope: Scope.Closeable; origin: string | null } | undefined;
  const dataDir = path.join(config.baseDir, "tools", "code-server", "data");
  const isolationArgs = [
    "--user-data-dir",
    dataDir,
    "--extensions-dir",
    path.join(config.baseDir, "tools", "code-server", "extensions"),
    "--config",
    path.join(config.baseDir, "tools", "code-server", "config.yaml"),
  ];
  // code-server lets PORT override --bind-addr, including our ephemeral loopback port.
  const processEnv = { ...environment, PORT: undefined, CS_DISABLE_PROXY: "true" };

  // Download chunks already belong to launch's span; keep each report untraced.
  const reportProgress = Effect.fnUntraced(function* (
    id: string,
    progress: NonNullable<ConveneIdeResult["progress"]>,
  ) {
    yield* SubscriptionRef.update(state, (current) =>
      attempt?.id === id && current.runtimeId === id ? { ...current, progress } : current,
    );
  });

  const configureLanguage = Effect.fn("ConveneIde.configureLanguage")(function* (
    executable: string,
  ) {
    const marker = path.join(dataDir, ".t3-default-language");
    if (yield* fs.exists(marker)) return;
    const argvPath = path.join(dataDir, "User", "argv.json");
    const content = (yield* fs.exists(argvPath)) ? yield* fs.readFileString(argvPath) : "{}\n";
    const errors: ParseError[] = [];
    // code-server strips comments then uses JSON.parse, which rejects trailing commas.
    const root = parseTree(content, errors);
    if (!root || root.type !== "object" || errors.length > 0) {
      return yield* new LanguageSetupError({});
    }
    if (!findNodeAtLocation(root, ["locale"])) {
      const exit = yield* spawner.exitCode(
        ChildProcess.make(
          executable,
          [
            ...isolationArgs,
            "--install-extension",
            "MS-CEINTL.vscode-language-pack-zh-hans@1.131.0",
          ],
          { cwd: config.cwd, env: processEnv, stdin: "ignore", stdout: "ignore", stderr: "ignore" },
        ),
      );
      if (exit !== 0) return yield* new LanguageSetupError({});
      yield* fs.writeFileString(
        argvPath,
        applyEdits(
          content,
          modify(content, ["locale"], "zh-cn", {
            formattingOptions: { insertSpaces: true, tabSize: 2 },
          }),
        ),
      );
    }
    // Once handled, a user can remove the locale or extension without OPEN undoing it.
    yield* fs.writeFileString(marker, "");
  });

  const launch = Effect.fn("ConveneIde.launch")(function* (id: string) {
    const executable = yield* installation.ensure((progress) => reportProgress(id, progress));
    yield* fs.makeDirectory(path.join(dataDir, "User"), { recursive: true });
    const settingsPath = path.join(dataDir, "User", "settings.json");
    if (!(yield* fs.exists(settingsPath))) {
      yield* fs.writeFileString(
        settingsPath,
        '{"remote.autoForwardPorts":false,"telemetry.telemetryLevel":"off"}\n',
      );
    }
    yield* reportProgress(id, { stage: "configuring-language" });
    yield* configureLanguage(executable).pipe(
      // A language download must not indefinitely block an otherwise usable editor.
      Effect.timeout("2 minutes"),
      Effect.catch(() =>
        SubscriptionRef.update(state, (current) =>
          attempt?.id === id && current.runtimeId === id
            ? { ...current, warning: { code: "language_setup_failed" as const } }
            : current,
        ),
      ),
    );
    yield* SubscriptionRef.update(state, (current) =>
      attempt?.id === id && current.runtimeId === id
        ? { ...current, phase: "starting" as const, progress: { stage: "starting" as const } }
        : current,
    );
    const ready = yield* Deferred.make<string>();
    const child = yield* spawner.spawn(
      ChildProcess.make(
        executable,
        [
          "--bind-addr",
          "127.0.0.1:0",
          "--auth",
          "none",
          "--disable-proxy",
          "--disable-telemetry",
          "--disable-update-check",
          "--ignore-last-opened",
          ...isolationArgs,
        ],
        {
          cwd: config.cwd,
          env: processEnv,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        },
      ),
    );
    yield* Stream.merge(child.stdout, child.stderr).pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runForEach((line) => {
        const match = /HTTP server listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(line);
        return match ? Deferred.succeed(ready, match[1]!) : Effect.void;
      }),
      Effect.forkScoped,
    );
    const exited = child.exitCode.pipe(
      Effect.flatMap(() => Effect.fail({ code: "runtime_exited" as const })),
    );
    const origin = yield* Effect.raceFirst(Deferred.await(ready), exited).pipe(
      Effect.timeout("90 seconds"),
    );
    if (attempt?.id !== id) return;
    attempt.origin = origin;
    yield* SubscriptionRef.update(state, (current) => ({
      ...current,
      phase: "ready" as const,
      progress: undefined,
    }));
    return yield* exited;
  });

  const start = Effect.gen(function* () {
    const current = yield* SubscriptionRef.get(state);
    if (current.phase !== "stopped") return current;
    const id = yield* crypto
      .randomUUIDv4()
      .pipe(Effect.mapError((cause) => new ConveneIdeError({ code: "internal_error", cause })));
    const scope = yield* Scope.make();
    attempt = { id, scope, origin: null };
    const next = {
      ...current,
      phase: "installing" as const,
      runtimeId: id,
      progress: { stage: "checking" as const },
      warning: undefined,
      error: null,
    };
    yield* SubscriptionRef.set(state, next);
    yield* launch(id).pipe(
      Effect.scoped,
      Effect.catch((cause) =>
        Effect.gen(function* () {
          if (attempt?.id !== id) return;
          const current = yield* SubscriptionRef.get(state);
          const code = CodeServerInstallation.isCodeServerInstallationError(cause)
            ? cause.code
            : current.phase === "ready"
              ? "runtime_exited"
              : "start_failed";
          attempt.origin = null;
          yield* SubscriptionRef.set(state, {
            ...current,
            phase: "failed",
            progress: undefined,
            error: { code },
          });
          yield* Effect.logWarning("Managed code-server stopped", { runtimeId: id, code, cause });
        }),
      ),
      Effect.forkIn(scope),
    );
    return next;
  });

  const stop = Effect.fn("ConveneIde.stop")(function* (id: string) {
    if (attempt?.id !== id) return yield* new ConveneIdeError({ code: "runtime_unavailable" });
    yield* Scope.close(attempt.scope, Exit.void);
    attempt = undefined;
    return yield* SubscriptionRef.updateAndGet(state, (current) => ({
      ...current,
      phase: "stopped" as const,
      runtimeId: null,
      entryPath: null,
      progress: undefined,
      warning: undefined,
      error: null,
    }));
  });
  yield* Effect.addFinalizer(() => (attempt ? Scope.close(attempt.scope, Exit.void) : Effect.void));

  const handle = Effect.fn("ConveneIde.handle")(function* (
    request: ConveneIdeRequest,
  ): Effect.fn.Return<ConveneIdeResult, ConveneIdeError> {
    const input = yield* decodeRequest(request).pipe(
      Effect.mapError((cause) => new ConveneIdeError({ code: "invalid_request", cause })),
    );
    if (input.operation === "STOP") return yield* lock.withPermit(stop(input.runtimeId));
    const workspace = yield* workspaces
      .resolve(input.projectId, input.workspaceKey)
      .pipe(
        Effect.mapError((cause) => new ConveneIdeError({ code: "workspace_unavailable", cause })),
      );
    if (!workspace?.available) return yield* new ConveneIdeError({ code: "workspace_unavailable" });
    const file = input.file
      ? yield* workspacePaths
          .resolveRelativePathWithinRoot({
            workspaceRoot: workspace.path,
            relativePath: input.file.relativePath,
          })
          .pipe(
            Effect.mapError(
              (cause) => new ConveneIdeError({ code: "file_outside_workspace", cause }),
            ),
          )
      : null;
    const current = yield* input.operation === "OPEN"
      ? lock.withPermit(start)
      : SubscriptionRef.get(state);
    if (current.phase !== "ready" || current.runtimeId === null) return current;
    const search = new URLSearchParams({ folder: workspace.path });
    if (file) {
      const line = input.file?.line ?? (input.file?.column ? 1 : undefined);
      const uri = new URL("vscode-remote://remote");
      uri.pathname = file.absolutePath + (line ? `:${line}:${input.file?.column ?? 1}` : "");
      const payload: Array<readonly [string, string]> = [["openFile", uri.toString()]];
      if (line) payload.push(["gotoLineMode", "true"]);
      search.set("payload", encodePayload(payload));
    }
    return { ...current, entryPath: `${RUNTIME_PREFIX.slice(1)}${current.runtimeId}/?${search}` };
  });

  return ConveneIde.of({
    handle,
    changes: SubscriptionRef.changes(state),
    upstream: Effect.fn("ConveneIde.upstream")(function* (id) {
      if (attempt?.id !== id || attempt.origin === null) {
        return yield* new ConveneIdeError({ code: "runtime_unavailable" });
      }
      return attempt.origin;
    }),
  });
});

export const layer = Layer.effect(ConveneIde, make);
