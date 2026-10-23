import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

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
  const commands: Array<ChildProcess.StandardCommand> = [];
  let installations = 0;
  let stops = 0;
  const spawner = ChildProcessSpawner.make((command) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        assert.equal(command._tag, "StandardCommand");
        if (command._tag === "StandardCommand") commands.push(command);
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(123),
          exitCode: Deferred.await(exit),
          isRunning: Deferred.isDone(exit).pipe(Effect.map((done) => !done)),
          kill: () =>
            Deferred.succeed(exit, ChildProcessSpawner.ExitCode(0)).pipe(
              Effect.tap((first) =>
                Effect.sync(() => {
                  if (first) stops++;
                }),
              ),
              Effect.asVoid,
            ),
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
        ensure: Effect.sync(() => installations++).pipe(Effect.andThen(Deferred.await(install))),
      }),
    ),
    Layer.provide(Layer.succeed(ConveneWorkspaces.ConveneWorkspaces, workspaces)),
    Layer.provide(WorkspacePaths.layer),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-managed-ide-" })),
    Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
    Layer.provide(NodeServices.layer),
  );
  return { install, exit, commands, layer, counts: () => ({ installations, stops }) };
});

const awaitPhase = (ide: ConveneIde.ConveneIde["Service"], phase: "ready" | "failed") =>
  ide.changes.pipe(
    Stream.filter((value) => value.phase === phase),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
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
      yield* ide.handle({ service: "code-server", operation: "STOP", runtimeId: first.runtimeId! });
      assert.equal((yield* ide.handle(QUERY)).phase, "stopped");
      assert.equal(fixture.commands.length, 0);
      const second = yield* ide.handle(OPEN);
      assert.notEqual(second.runtimeId, first.runtimeId);
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
