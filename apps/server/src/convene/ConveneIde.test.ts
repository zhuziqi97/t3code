import * as NodeVM from "node:vm";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { FetchHttpClient, HttpClient } from "effect/http";
import { build } from "vite-plus/pack";

import serverViteConfig from "../../vite.config.ts";
import * as ServerConfig from "../config.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as CodeServerInstallation from "./CodeServerInstallation.ts";
import * as ConveneIde from "./ConveneIde.ts";
import * as ConveneWorkspaces from "./ConveneWorkspaces.ts";

const PROJECT = ProjectId.make("ide-project");
const OPEN = {
  service: "code-server",
  operation: "OPEN",
  projectId: PROJECT,
  workspaceKey: "root",
} as const;
const QUERY = { ...OPEN, operation: "QUERY" } as const;

const setup = Effect.gen(function* () {
  const install = yield* Deferred.make<
    string,
    CodeServerInstallation.CodeServerInstallationError
  >();
  const exit = yield* Deferred.make<ChildProcessSpawner.ExitCode>();
  const reports =
    yield* Queue.unbounded<
      NonNullable<Parameters<CodeServerInstallation.CodeServerInstallation["Service"]["ensure"]>[0]>
    >();
  const commands: Array<ChildProcess.StandardCommand> = [];
  const languageCommands: Array<ChildProcess.StandardCommand> = [];
  let languageExit = 0;
  let preparationFailed = false;
  let installations = 0;
  let stops = 0;
  const spawner = ChildProcessSpawner.make((command) =>
    Effect.acquireRelease(
      Effect.gen(function* () {
        assert.equal(command._tag, "StandardCommand");
        if (command._tag !== "StandardCommand") return yield* Effect.die("Expected a command");
        const language = command.args.includes("--install-extension");
        const childExit = language
          ? undefined
          : commands.length === 0
            ? exit
            : yield* Deferred.make<ChildProcessSpawner.ExitCode>();
        (language ? languageCommands : commands).push(command);
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(123),
          exitCode: childExit
            ? Deferred.await(childExit)
            : Effect.succeed(ChildProcessSpawner.ExitCode(languageExit)),
          isRunning: childExit
            ? Deferred.isDone(childExit).pipe(Effect.map((done) => !done))
            : Effect.succeed(false),
          kill: () =>
            childExit
              ? Deferred.succeed(childExit, ChildProcessSpawner.ExitCode(0)).pipe(
                  Effect.tap((first) =>
                    Effect.sync(() => {
                      if (first) stops++;
                    }),
                  ),
                  Effect.asVoid,
                )
              : Effect.void,
          unref: Effect.succeed(Effect.void),
          stdin: Sink.drain,
          stdout: Stream.make(
            new TextEncoder().encode("info  HTTP server listening on http://127.0.0.1:45678\n"),
          ),
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
        });
      }),
      (child) => child.kill().pipe(Effect.orDie),
    ),
  );
  const workspaces = ConveneWorkspaces.ConveneWorkspaces.of({
    changes: Stream.never,
    list: () => Effect.succeed([]),
    resolve: (project, key) =>
      Effect.succeed(
        project === PROJECT && (key === "root" || key === "worktree")
          ? {
              projectId: project,
              key,
              path: key === "root" ? "/workspace/project" : "/workspace/worktree",
              displayName: key,
              branch: null,
              available: true,
            }
          : null,
      ),
    rememberThread: () => Effect.void,
    rebindThread: () => Effect.void,
    threadKey: () => Effect.succeed(null),
  });
  const layer = ConveneIde.layer.pipe(
    Layer.provide(
      Layer.succeed(CodeServerInstallation.CodeServerInstallation, {
        prepareLanguage: () =>
          preparationFailed
            ? Effect.fail(
                new CodeServerInstallation.CodeServerInstallationError({ code: "install_failed" }),
              )
            : Effect.void,
        ensure: (report) =>
          Effect.sync(() => installations++).pipe(
            Effect.andThen(report ? Queue.offer(reports, report) : Effect.void),
            Effect.andThen(Deferred.await(install)),
          ),
      }),
    ),
    Layer.provide(Layer.succeed(ConveneWorkspaces.ConveneWorkspaces, workspaces)),
    Layer.provide(WorkspacePaths.layer),
    Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-managed-ide-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  );
  return {
    install,
    exit,
    commands,
    languageCommands,
    reports,
    layer,
    failLanguage: (code: number) => {
      languageExit = code;
    },
    failPreparation: (failed: boolean) => {
      preparationFailed = failed;
    },
    counts: () => ({ installations, stops }),
  };
});

const awaitPhase = (ide: ConveneIde.ConveneIde["Service"], phase: "ready" | "failed") =>
  ide.changes.pipe(
    Stream.filter((value) => value.phase === phase),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

it.effect("does not let inherited PORT override the managed loopback binding", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;
    const environment = { PORT: "8272", PATH: "/managed/bin", HOME: "/managed/home" };
    yield* Effect.gen(function* () {
      const ide = yield* ConveneIde.ConveneIde;
      yield* ide.handle(OPEN);
      yield* Deferred.succeed(fixture.install, "/managed/bin/code-server");
      yield* awaitPhase(ide, "ready");
      const command = fixture.commands[0]!;
      assert.deepEqual(command.args.slice(0, 2), ["--bind-addr", "127.0.0.1:0"]);
      assert.equal(command.options.env?.PORT, undefined);
      assert.equal(command.options.env?.PATH, environment.PATH);
      assert.equal(command.options.env?.HOME, environment.HOME);
      assert.equal(environment.PORT, "8272");
    }).pipe(
      Effect.provide(fixture.layer),
      Effect.provideService(HostProcess.Environment, environment),
    );
  }),
);

it.effect("gets or starts one shared runtime and resolves each workspace independently", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;
    yield* Effect.gen(function* () {
      const ide = yield* ConveneIde.ConveneIde;
      assert.equal((yield* ide.handle(QUERY)).phase, "stopped");
      assert.equal(fixture.counts().installations, 0);
      const first = yield* ide.handle(OPEN);
      assert.equal(first.phase, "installing");
      assert.deepEqual(first.progress, { stage: "checking" });
      const repeated = yield* Effect.all([ide.handle(OPEN), ide.handle(OPEN)]);
      assert.ok(repeated.every((item) => item.runtimeId === first.runtimeId));
      yield* Deferred.succeed(fixture.install, "/managed/bin/code-server");
      yield* awaitPhase(ide, "ready");
      const root = yield* ide.handle(OPEN);
      const worktree = yield* ide.handle({ ...OPEN, workspaceKey: "worktree" });
      assert.equal(root.runtimeId, worktree.runtimeId);
      assert.equal(
        new URL(root.entryPath!, "http://entry/session/").searchParams.get("folder"),
        "/workspace/project",
      );
      assert.equal(
        new URL(worktree.entryPath!, "http://entry/session/").searchParams.get("folder"),
        "/workspace/worktree",
      );
      assert.deepEqual(fixture.counts(), { installations: 1, stops: 0 });
      assert.equal(fixture.commands.length, 1);
      assert.ok(fixture.commands[0]!.args.includes("--disable-proxy"));
      assert.equal(yield* ide.upstream(root.runtimeId!), "http://127.0.0.1:45678");
    }).pipe(Effect.provide(fixture.layer));
    assert.equal(fixture.counts().stops, 1);
  }),
);

it.effect("sets the default locale in the isolated native argv file before starting", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;
    yield* Effect.gen(function* () {
      const ide = yield* ConveneIde.ConveneIde;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* ide.handle(OPEN);
      yield* Deferred.succeed(fixture.install, "/managed/bin/code-server");
      yield* awaitPhase(ide, "ready");
      const command = fixture.commands[0]!;
      const dataDir = command.args[command.args.indexOf("--user-data-dir") + 1]!;
      assert.equal(
        JSON.parse(yield* fs.readFileString(path.join(dataDir, "User", "argv.json"))).locale,
        "zh-cn",
      );
      assert.ok(yield* fs.exists(path.join(dataDir, ".t3-default-language")));
      const language = fixture.languageCommands[0]!;
      assert.deepEqual(
        language.args.slice(0, 6),
        command.args.slice(command.args.indexOf("--user-data-dir")),
      );
      assert.deepEqual(language.args.slice(6), [
        "--install-extension",
        "MS-CEINTL.vscode-language-pack-zh-hans@1.131.0",
      ]);
      assert.ok(!command.args.includes("--locale"));
      assert.ok(!command.args.includes("--disable-workspace-trust"));
      assert.ok(
        !(yield* fs.readFileString(path.join(dataDir, "User", "settings.json"))).includes("locale"),
      );
      assert.isUndefined((yield* ide.handle(QUERY)).warning);
    }).pipe(Effect.provide(fixture.layer));
  }),
);

it.effect(
  "keeps real preparation stages observable until ready and QUERY does not restart work",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      yield* Effect.gen(function* () {
        const ide = yield* ConveneIde.ConveneIde;
        const subscribed = yield* Deferred.make<void>();
        const changes = yield* ide.changes.pipe(
          Stream.tap(() => Deferred.succeed(subscribed, undefined)),
          Stream.takeUntil((value) => value.phase === "ready"),
          Stream.runCollect,
          Effect.forkScoped,
        );
        yield* Deferred.await(subscribed);
        yield* ide.handle(OPEN);
        const report = yield* Queue.take(fixture.reports);
        yield* report({ stage: "downloading", receivedBytes: 17, totalBytes: 23 });
        assert.deepEqual((yield* ide.handle(QUERY)).progress, {
          stage: "downloading",
          receivedBytes: 17,
          totalBytes: 23,
        });
        yield* report({ stage: "extracting" });
        assert.deepEqual((yield* ide.handle(QUERY)).progress, { stage: "extracting" });
        yield* Deferred.succeed(fixture.install, "/managed/bin/code-server");
        const values = yield* Fiber.join(changes);
        assert.deepEqual(
          values.map((value) => value.progress?.stage),
          [
            undefined,
            "checking",
            "downloading",
            "extracting",
            "configuring-language",
            "starting",
            undefined,
          ],
        );
        assert.isUndefined((yield* ide.handle(QUERY)).progress);
        assert.equal(fixture.counts().installations, 1);
        assert.equal(fixture.languageCommands.length, 1);
      }).pipe(Effect.provide(fixture.layer));
    }),
);

it.effect("adds only a missing locale while preserving JSONC properties and comments", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;
    yield* Effect.gen(function* () {
      const ide = yield* ConveneIde.ConveneIde;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const user = path.join(config.baseDir, "tools", "code-server", "data", "User");
      yield* fs.makeDirectory(user, { recursive: true });
      const argv =
        '// custom startup\n{\n  // keep this preference\n  "disable-hardware-acceleration": true\n}\n';
      yield* fs.writeFileString(path.join(user, "argv.json"), argv);
      yield* ide.handle(OPEN);
      yield* Deferred.succeed(fixture.install, "/managed/bin/code-server");
      yield* awaitPhase(ide, "ready");
      const written = yield* fs.readFileString(path.join(user, "argv.json"));
      assert.include(written, "// custom startup");
      assert.include(written, "// keep this preference");
      assert.include(written, '"disable-hardware-acceleration": true');
      assert.include(written, '"locale": "zh-cn"');
    }).pipe(Effect.provide(fixture.layer));
  }),
);

it.effect.each(["existing choice", "applied default"] as const)(
  "respects %s and a later locale or extension removal across STOP and OPEN",
  (choice) =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      yield* Effect.gen(function* () {
        const ide = yield* ConveneIde.ConveneIde;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const config = yield* ServerConfig.ServerConfig;
        const dataDir = path.join(config.baseDir, "tools", "code-server", "data");
        const argvPath = path.join(dataDir, "User", "argv.json");
        const existing = '{\n // user choice\n "locale": "en", "enable-crash-reporter": false\n}\n';
        if (choice === "existing choice") {
          yield* fs.makeDirectory(path.dirname(argvPath), { recursive: true });
          yield* fs.writeFileString(argvPath, existing);
        }
        assert.equal((yield* ide.handle(QUERY)).phase, "stopped");
        assert.equal(fixture.languageCommands.length, 0);
        assert.ok(!(yield* fs.exists(path.join(dataDir, ".t3-default-language"))));
        const first = yield* ide.handle(OPEN);
        yield* Deferred.succeed(fixture.install, "/managed/bin/code-server");
        yield* awaitPhase(ide, "ready");
        if (choice === "existing choice") {
          assert.equal(yield* fs.readFileString(argvPath), existing);
        }
        assert.equal(fixture.languageCommands.length, choice === "existing choice" ? 0 : 1);
        assert.ok(yield* fs.exists(path.join(dataDir, ".t3-default-language")));
        yield* ide.handle({
          service: "code-server",
          operation: "STOP",
          runtimeId: first.runtimeId!,
        });
        yield* fs.writeFileString(argvPath, "{}\n");
        yield* fs.remove(path.join(config.baseDir, "tools", "code-server", "extensions"), {
          recursive: true,
          force: true,
        });
        assert.equal((yield* ide.handle(QUERY)).phase, "stopped");
        yield* ide.handle(OPEN);
        yield* awaitPhase(ide, "ready");
        assert.equal(yield* fs.readFileString(argvPath), "{}\n");
        assert.equal(fixture.languageCommands.length, choice === "existing choice" ? 0 : 1);
        assert.ok(
          !(yield* fs.exists(path.join(config.baseDir, "tools", "code-server", "extensions"))),
        );
      }).pipe(Effect.provide(fixture.layer));
    }),
);

it.effect.each(["package", "config", "trailing comma", "native initialization"] as const)(
  "continues ready after a language %s failure and retries only after STOP and OPEN",
  (failure) =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      if (failure === "package") fixture.failLanguage(1);
      if (failure === "native initialization") fixture.failPreparation(true);
      yield* Effect.gen(function* () {
        const ide = yield* ConveneIde.ConveneIde;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const config = yield* ServerConfig.ServerConfig;
        const dataDir = path.join(config.baseDir, "tools", "code-server", "data");
        const argvPath = path.join(dataDir, "User", "argv.json");
        const invalid = failure === "trailing comma" ? '{"locale":"en",}' : "{ invalid JSONC";
        const configFailure = failure === "config" || failure === "trailing comma";
        if (configFailure) {
          yield* fs.makeDirectory(path.dirname(argvPath), { recursive: true });
          yield* fs.writeFileString(argvPath, invalid);
        }
        const first = yield* ide.handle(OPEN);
        yield* Deferred.succeed(fixture.install, "/managed/bin/code-server");
        const ready = yield* awaitPhase(ide, "ready");
        assert.deepEqual(ready.warning, { code: "language_setup_failed" });
        assert.isUndefined(ready.progress);
        assert.isNull(ready.error);
        assert.ok(!(yield* fs.exists(path.join(dataDir, ".t3-default-language"))));
        if (!configFailure) assert.ok(!(yield* fs.exists(argvPath)));
        else assert.equal(yield* fs.readFileString(argvPath), invalid);
        const calls = fixture.languageCommands.length;
        yield* ide.handle(QUERY);
        yield* ide.handle(OPEN);
        assert.equal(fixture.languageCommands.length, calls);
        const stopped = yield* ide.handle({
          service: "code-server",
          operation: "STOP",
          runtimeId: first.runtimeId!,
        });
        assert.isUndefined(stopped.warning);
        assert.isUndefined(stopped.progress);
        assert.equal((yield* ide.handle(QUERY)).phase, "stopped");
        fixture.failLanguage(0);
        fixture.failPreparation(false);
        if (configFailure) yield* fs.writeFileString(argvPath, "{}\n");
        const next = yield* ide.handle(OPEN);
        assert.isUndefined(next.warning);
        assert.isNull(next.error);
        const recovered = yield* awaitPhase(ide, "ready");
        assert.isUndefined(recovered.warning);
        assert.ok(yield* fs.exists(path.join(dataDir, ".t3-default-language")));
        assert.equal(JSON.parse(yield* fs.readFileString(argvPath)).locale, "zh-cn");
        assert.equal(fixture.languageCommands.length, calls + 1);
      }).pipe(Effect.provide(fixture.layer));
    }),
);

it.effect("keeps failures until an explicit stop instead of replaying installation", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;
    yield* Effect.gen(function* () {
      const ide = yield* ConveneIde.ConveneIde;
      const first = yield* ide.handle(OPEN);
      yield* Deferred.fail(
        fixture.install,
        new CodeServerInstallation.CodeServerInstallationError({ code: "install_failed" }),
      );
      const failed = yield* awaitPhase(ide, "failed");
      assert.deepEqual(failed.error, { code: "install_failed" });
      assert.isUndefined(failed.progress);
      const repeated = yield* ide.handle(OPEN);
      assert.equal(repeated.runtimeId, first.runtimeId);
      assert.equal(repeated.phase, "failed");
      assert.equal(fixture.counts().installations, 1);
      assert.equal(
        (yield* ide.handle({
          service: "code-server",
          operation: "STOP",
          runtimeId: first.runtimeId!,
        })).phase,
        "stopped",
      );
    }).pipe(Effect.provide(fixture.layer));
  }),
);

it.effect("refuses stale stop and proxy identities without stopping the active process", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;
    yield* Effect.gen(function* () {
      const ide = yield* ConveneIde.ConveneIde;
      const initial = yield* ide.handle(OPEN);
      yield* Deferred.succeed(fixture.install, "/managed/bin/code-server");
      yield* awaitPhase(ide, "ready");
      assert.equal(
        (yield* ide
          .handle({ service: "code-server", operation: "STOP", runtimeId: "old-runtime" })
          .pipe(Effect.flip)).code,
        "runtime_unavailable",
      );
      assert.equal(
        (yield* ide.upstream("old-runtime").pipe(Effect.flip)).code,
        "runtime_unavailable",
      );
      assert.equal((yield* ide.handle(QUERY)).phase, "ready");
      yield* ide.handle({
        service: "code-server",
        operation: "STOP",
        runtimeId: initial.runtimeId!,
      });
      assert.equal(fixture.counts().stops, 1);
      assert.equal(
        (yield* ide.upstream(initial.runtimeId!).pipe(Effect.flip)).code,
        "runtime_unavailable",
      );
    }).pipe(Effect.provide(fixture.layer));
  }),
);

it.effect("cancels an installation on explicit stop before starting a fresh attempt", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;
    yield* Effect.gen(function* () {
      const ide = yield* ConveneIde.ConveneIde;
      const first = yield* ide.handle(OPEN);
      const oldReport = yield* Queue.take(fixture.reports);
      yield* oldReport({ stage: "downloading", receivedBytes: 4 });
      yield* ide.handle({ service: "code-server", operation: "STOP", runtimeId: first.runtimeId! });
      yield* oldReport({ stage: "extracting" });
      const stopped = yield* ide.handle(QUERY);
      assert.equal(stopped.phase, "stopped");
      assert.isUndefined(stopped.progress);
      assert.isUndefined(stopped.warning);
      assert.equal(fixture.commands.length, 0);
      const second = yield* ide.handle(OPEN);
      assert.notEqual(second.runtimeId, first.runtimeId);
      yield* oldReport({ stage: "downloading", receivedBytes: 999 });
      assert.deepEqual((yield* ide.handle(QUERY)).progress, { stage: "checking" });
      yield* Deferred.succeed(fixture.install, "/managed/bin/code-server");
      yield* awaitPhase(ide, "ready");
      assert.equal(fixture.commands.length, 1);
    }).pipe(Effect.provide(fixture.layer));
  }),
);

it.effect("reports an unexpected exit and does not restart on another open", () =>
  Effect.gen(function* () {
    const fixture = yield* setup;
    yield* Effect.gen(function* () {
      const ide = yield* ConveneIde.ConveneIde;
      yield* ide.handle(OPEN);
      yield* Deferred.succeed(fixture.install, "/managed/bin/code-server");
      yield* awaitPhase(ide, "ready");
      yield* Deferred.succeed(fixture.exit, ChildProcessSpawner.ExitCode(17));
      const failed = yield* awaitPhase(ide, "failed");
      assert.deepEqual(failed.error, { code: "runtime_exited" });
      assert.isUndefined(failed.progress);
      assert.equal((yield* ide.handle(OPEN)).phase, "failed");
      assert.equal(fixture.commands.length, 1);
    }).pipe(Effect.provide(fixture.layer));
  }),
);

it.effect(
  "checks native workspace and relative file before starting, then returns a native file selection",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      yield* Effect.gen(function* () {
        const ide = yield* ConveneIde.ConveneIde;
        assert.equal(
          (yield* ide.handle({ ...OPEN, workspaceKey: "removed" }).pipe(Effect.flip)).code,
          "workspace_unavailable",
        );
        assert.equal(
          (yield* ide.handle({ ...OPEN, file: { relativePath: "../outside" } }).pipe(Effect.flip))
            .code,
          "file_outside_workspace",
        );
        assert.equal(fixture.counts().installations, 0);
        yield* ide.handle(OPEN);
        yield* Deferred.succeed(fixture.install, "/managed/bin/code-server");
        yield* awaitPhase(ide, "ready");
        const result = yield* ide.handle({
          ...QUERY,
          file: { relativePath: "src/target file.ts", line: 3, column: 2 },
        });
        const uri = new URL(result.entryPath!, "http://entry/session/");
        assert.equal(uri.pathname, `/session/api/convene/ide/code-server/${result.runtimeId}/`);
        assert.deepEqual(JSON.parse(uri.searchParams.get("payload")!), [
          ["openFile", "vscode-remote://remote/workspace/project/src/target%20file.ts:3:2"],
          ["gotoLineMode", "true"],
        ]);
        const columnOnly = yield* ide.handle({
          ...QUERY,
          file: { relativePath: "src/target file.ts", column: 2 },
        });
        const columnUri = new URL(columnOnly.entryPath!, "http://entry/session/");
        assert.deepEqual(JSON.parse(columnUri.searchParams.get("payload")!), [
          ["openFile", "vscode-remote://remote/workspace/project/src/target%20file.ts:1:2"],
          ["gotoLineMode", "true"],
        ]);
      }).pipe(Effect.provide(fixture.layer));
    }),
);

it.live.each(["fresh", "existing marker", "bundled fresh"] as const)(
  "initializes native language packs before the first HTTP bootstrap with %s data",
  (existing) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const http = yield* HttpClient.HttpClient;
      const runtime = path.join(
        config.baseDir,
        "tools",
        "code-server",
        CodeServerInstallation.VERSION + "-linux-x64",
      );
      const executable = path.join(runtime, "bin", "code-server");
      const native = path.join(runtime, "lib", "vscode", "out", "server-main.js");
      yield* fs.makeDirectory(path.dirname(executable), { recursive: true });
      yield* fs.makeDirectory(path.dirname(native), { recursive: true });
      // The pinned runtime constructs NativeLanguagePackService here without updating its cache.
      yield* fs.writeFileString(
        native,
        [
          "module.exports = async function(available) {",
          "let language = 'en', updates = 0;",
          "class pl { async update() { updates++; language = available ? 'zh-cn' : 'en'; } }",
          "const Uu = 'languagePacks', i = new Map();",
          "const F = { createInstance: C => new C(), invokeFunction: fn => fn({ get: key => i.get(key) }) };",
          "i.set(Uu,F.createInstance(pl));",
          "return { locale: language, updates };",
          "};",
        ].join("\n"),
      );
      const data = path.join(config.baseDir, "tools", "code-server", "data");
      const extensions = path.join(config.baseDir, "tools", "code-server", "extensions");
      if (existing === "existing marker") {
        yield* fs.makeDirectory(path.join(data, "User"), { recursive: true });
        yield* fs.makeDirectory(extensions, { recursive: true });
        yield* fs.writeFileString(path.join(data, "User", "argv.json"), '{"locale":"zh-cn"}');
        yield* fs.writeFileString(path.join(data, ".t3-default-language"), "");
        yield* fs.writeFileString(
          path.join(extensions, "fixture-language.json"),
          "already installed",
        );
      }
      yield* fs.writeFileString(
        executable,
        [
          "#!/usr/bin/env node",
          "const fs = require('node:fs');",
          "const path = require('node:path');",
          "const args = process.argv.slice(2);",
          "const data = args[args.indexOf('--user-data-dir') + 1];",
          "const extensions = args[args.indexOf('--extensions-dir') + 1];",
          "if (args.includes('--install-extension')) {",
          "  fs.mkdirSync(extensions, { recursive: true });",
          "  fs.writeFileSync(path.join(extensions, 'fixture-language.json'), JSON.stringify(args));",
          "} else { (async () => {",
          "  const initialize = require(require('node:path').join(__dirname, '..', 'lib', 'vscode', 'out', 'server-main.js'));",
          "  const nls = await initialize(fs.existsSync(path.join(extensions, 'fixture-language.json')));",
          "  const server = require('node:http').createServer((_req, res) => {",
          "    res.writeHead(200, { 'content-type': 'application/json' });",
          "    res.end(JSON.stringify(nls));",
          "  });",
          "  process.on('SIGTERM', () => server.close(() => process.exit(0)));",
          "  server.listen(0, '127.0.0.1', () => {",
          "    process.stdout.write('info HTTP server listening on http://127.0.0.1:' + server.address().port + '\\n');",
          "  });",
          "})().catch(error => { console.error(error); process.exit(1); }); }",
          "",
        ].join("\n"),
      );
      yield* fs.chmod(executable, 0o755);
      let ideModule = ConveneIde;
      if (existing === "bundled fresh") {
        const pack = serverViteConfig.pack;
        assert.ok(pack && !Array.isArray(pack));
        const outDir = path.join(config.baseDir, "service-bundle");
        yield* Effect.promise(() =>
          build({
            ...pack,
            config: false,
            cwd: path.resolve(import.meta.dirname, "../.."),
            entry: [path.join(import.meta.dirname, "ConveneIde.ts")],
            outDir,
            sourcemap: false,
            logLevel: "silent",
          }),
        );
        const bundleUrl = yield* path.toFileUrl(path.join(outDir, "ConveneIde.mjs"));
        // Vitest's source transform must not rewrite the emitted server bundle.
        const loadBundle: (url: string) => Promise<typeof ConveneIde> = NodeVM.runInThisContext(
          "(url) => import(url)",
          { importModuleDynamically: NodeVM.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER },
        );
        ideModule = yield* Effect.promise(() => loadBundle(bundleUrl.href));
      }
      const layer = ideModule.layer.pipe(
        Layer.provide(CodeServerInstallation.layer),
        Layer.provide(
          Layer.mock(ConveneWorkspaces.ConveneWorkspaces, {
            resolve: () =>
              Effect.succeed({
                projectId: PROJECT,
                key: "root",
                path: config.baseDir,
                displayName: "fixture",
                branch: null,
                available: true,
              }),
          }),
        ),
        Layer.provide(WorkspacePaths.layer),
      );
      yield* Effect.gen(function* () {
        const ide = yield* ConveneIde.ConveneIde;
        const opening = yield* ide.handle(OPEN);
        assert.deepEqual(opening.progress, { stage: "checking" });
        const ready = yield* awaitPhase(ide, "ready");
        assert.isUndefined(ready.warning);
        const origin = yield* ide.upstream(ready.runtimeId!);
        const response = yield* http.get(origin);
        assert.equal(response.status, 200);
        assert.deepEqual<unknown>(yield* response.json, { locale: "zh-cn", updates: 1 });
        if (existing !== "existing marker") {
          assert.equal(
            JSON.parse(yield* fs.readFileString(path.join(data, "User", "argv.json"))).locale,
            "zh-cn",
          );
          const cliArgs: unknown = JSON.parse(
            yield* fs.readFileString(
              path.join(
                config.baseDir,
                "tools",
                "code-server",
                "extensions",
                "fixture-language.json",
              ),
            ),
          );
          assert.deepEqual(cliArgs, [
            "--user-data-dir",
            path.join(config.baseDir, "tools", "code-server", "data"),
            "--extensions-dir",
            path.join(config.baseDir, "tools", "code-server", "extensions"),
            "--config",
            path.join(config.baseDir, "tools", "code-server", "config.yaml"),
            "--install-extension",
            "MS-CEINTL.vscode-language-pack-zh-hans@1.131.0",
          ]);
        } else {
          assert.equal(
            yield* fs.readFileString(path.join(extensions, "fixture-language.json")),
            "already installed",
          );
          assert.equal(
            yield* fs.readFileString(path.join(data, "User", "argv.json")),
            '{"locale":"zh-cn"}',
          );
        }
        const stopped = yield* ide.handle({
          service: "code-server",
          operation: "STOP",
          runtimeId: ready.runtimeId!,
        });
        assert.equal(stopped.phase, "stopped");
        assert.equal((yield* ide.handle(QUERY)).phase, "stopped");
        assert.equal(
          (yield* ide.upstream(ready.runtimeId!).pipe(Effect.flip)).code,
          "runtime_unavailable",
        );
        yield* ide.handle(OPEN);
        const reopened = yield* awaitPhase(ide, "ready");
        const reopenedOrigin = yield* ide.upstream(reopened.runtimeId!);
        const reopenedResponse = yield* http.get(reopenedOrigin);
        assert.deepEqual<unknown>(yield* reopenedResponse.json, { locale: "zh-cn", updates: 1 });
        yield* Effect.logInfo(
          "Isolated IDE fixture: checking -> ready; HTTP 200 locale=zh-cn; STOP -> stopped",
        );
      }).pipe(Effect.provide(layer));
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          ServerConfig.layerTest(process.cwd(), { prefix: "t3-managed-ide-runtime-" }).pipe(
            Layer.provideMerge(NodeServices.layer),
          ),
          FetchHttpClient.layer,
        ),
      ),
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.provideService(HostProcess.Architecture, "x64"),
    ),
);
