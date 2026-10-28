import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Exit from "effect/Exit";
import * as PlatformError from "effect/PlatformError";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/process";

import * as CodexError from "../errors.ts";
import { collectChildStderr, makeTerminationError } from "./stdio.ts";

const encoder = new TextEncoder();

describe("Codex App Server child process termination", () => {
  it.effect.each([0, 1, 7])("retains exit code %i without stderr", (code) =>
    Effect.gen(function* () {
      const stderr = yield* collectChildStderr({ stderr: Stream.empty });
      const error = yield* makeTerminationError(
        {
          pid: ChildProcessSpawner.ProcessId(52),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(code)),
        },
        stderr,
      );
      assert.instanceOf(error, CodexError.CodexAppServerProcessExitedError);
      assert.equal(error.code, code);
      assert.equal(error.stderr, undefined);
      assert.equal(error.message, `Codex App Server process exited with code ${code}`);
    }),
  );

  it.effect("keeps stderr out of successful process exit errors", () =>
    Effect.gen(function* () {
      const stderr = yield* collectChildStderr({
        stderr: Stream.make(encoder.encode("ordinary diagnostic\n")),
      });
      const error = yield* makeTerminationError(
        {
          pid: ChildProcessSpawner.ProcessId(52),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        },
        stderr,
      );
      assert.equal(error.message, "Codex App Server process exited with code 0");
    }),
  );

  it.effect("redacts credentials split across stderr chunks before exposing an exit error", () =>
    Effect.gen(function* () {
      const stderr = yield* collectChildStderr({
        stderr: Stream.make(
          encoder.encode("Invalid config\nBearer test-"),
          encoder.encode('credential\nx-api-key: another-secret\n{"access_token":"json-secret"}\n'),
          encoder.encode(
            "https://user:password@example.com/setup?token=url-secret#fragment\nsk-proj-abcdefghijklmnopqrstuv\n",
          ),
        ),
      });
      const error = yield* makeTerminationError(
        {
          pid: ChildProcessSpawner.ProcessId(52),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(1)),
        },
        stderr,
      );
      assert.instanceOf(error, CodexError.CodexAppServerProcessExitedError);
      assert.include(error.stderr!, "Invalid config");
      assert.include(error.stderr!, "[REDACTED]");
      assert.include(error.stderr!, "https://example.com/setup");
      for (const secret of [
        "test-credential",
        "another-secret",
        "json-secret",
        "password",
        "url-secret",
        "sk-proj-",
      ]) {
        assert.notInclude(error.message, secret);
        assert.notInclude(JSON.stringify(error), secret);
      }
    }),
  );

  it.effect("bounds stderr tails and omits credentials cut by truncation", () =>
    Effect.gen(function* () {
      const stderr = yield* collectChildStderr({
        stderr: Stream.make(
          encoder.encode(`old diagnostic\nBearer ${"s".repeat(8_192)}`),
          encoder.encode("\nfinal diagnostic\n"),
        ),
      });
      const excerpt = yield* stderr;
      assert.equal(excerpt, "[stderr truncated]\nfinal diagnostic");
      assert.isAtMost(excerpt.length, 4_096);
    }),
  );

  it.effect("interrupts the stderr drain when its client scope closes", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const stopped = yield* Deferred.make<void>();
      const scope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      yield* collectChildStderr({
        stderr: Stream.fromEffect(Deferred.succeed(started, undefined)).pipe(
          Stream.flatMap(() => Stream.never),
          Stream.ensuring(Deferred.succeed(stopped, undefined)),
        ),
      }).pipe(Effect.provideService(Scope.Scope, scope), Effect.asVoid);
      yield* Deferred.await(started);
      yield* Scope.close(scope, Exit.void);
      yield* Deferred.await(stopped);
    }),
  );

  it.effect("retains the process identifier and exact exit-status cause", () =>
    Effect.gen(function* () {
      const rootCause = new Error("private process diagnostics");
      const cause = PlatformError.systemError({
        _tag: "Unknown",
        module: "ChildProcess",
        method: "exitCode",
        cause: rootCause,
      });
      const error = yield* makeTerminationError({
        pid: ChildProcessSpawner.ProcessId(52),
        exitCode: Effect.fail(cause),
      });

      assert.instanceOf(error, CodexError.CodexAppServerTransportError);
      assert.equal(error.pid, 52);
      assert.strictEqual(error.cause, cause);
      assert.equal(
        error.message,
        "Codex App Server transport operation 'read-process-exit-status' failed.",
      );
      assert.notInclude(error.message, rootCause.message);
    }),
  );
});
