import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Sink from "effect/Sink";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/process";

import * as CodexError from "../errors.ts";

const encoder = new TextEncoder();
const MAX_STDERR_CHARS = 4_096;
const STDERR_TRUNCATED = "[stderr truncated]\n";

function stderrExcerpt(text: string, truncated: boolean): string {
  // Match provider failure redaction before exposing diagnostics in errors or traces.
  const redacted = text
    .replace(/\bhttps?:\/\/[^\s<>"']+/giu, (value) => {
      try {
        const url = new URL(value);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.toString();
      } catch {
        return "[REDACTED_URL]";
      }
    })
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/giu, "$1 [REDACTED]")
    .replace(
      /(["'](?:access[_-]?token|api[_-]?key|authorization|credential|password|secret|token)["']\s*:\s*["'])[^"']*(["'])/giu,
      "$1[REDACTED]$2",
    )
    .replace(
      /(\b(?:access[_-]?token|api[_-]?key|authorization|credential|password|secret|token)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      "$1[REDACTED]",
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9][A-Za-z0-9-]{7,}|ghp_[A-Za-z0-9]+|xox[a-zA-Z]-[A-Za-z0-9-]+)\b/gu,
      "[REDACTED]",
    )
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/gu, " ");
  if (!truncated && redacted.length <= MAX_STDERR_CHARS) return redacted.trim();
  const tail = redacted.slice(-(MAX_STDERR_CHARS - STDERR_TRUNCATED.length));
  // A cut credential may no longer match its prefix, so omit the incomplete first line.
  const newline = tail.indexOf("\n");
  return `${STDERR_TRUNCATED}${newline === -1 ? "" : tail.slice(newline + 1).trim()}`.trim();
}

export const collectChildStderr = Effect.fn("CodexAppServerClient.collectChildStderr")(function* (
  handle: Pick<ChildProcessSpawner.ChildProcessHandle, "stderr">,
) {
  let tail = "";
  let truncated = false;
  const drain = yield* handle.stderr.pipe(
    Stream.decodeText(),
    Stream.runForEach((chunk) =>
      Effect.sync(() => {
        const next = tail + chunk;
        truncated ||= next.length > MAX_STDERR_CHARS;
        tail = next.slice(-MAX_STDERR_CHARS);
      }),
    ),
    Effect.ignore,
    Effect.forkScoped,
  );
  return Fiber.join(drain).pipe(Effect.map(() => stderrExcerpt(tail, truncated)));
});

export const makeChildStdio = (handle: ChildProcessSpawner.ChildProcessHandle) =>
  Stdio.make({
    args: Effect.succeed([]),
    stdin: handle.stdout,
    stdout: () =>
      Sink.mapInput(handle.stdin, (chunk: string | Uint8Array) =>
        typeof chunk === "string" ? encoder.encode(chunk) : chunk,
      ),
    stderr: () => Sink.drain,
  });

export const makeInMemoryStdio = Effect.fn("makeInMemoryStdio")(function* () {
  const input = yield* Queue.unbounded<Uint8Array, Cause.Done<void>>();
  const output = yield* Queue.unbounded<string>();
  const decoder = new TextDecoder();

  return {
    stdio: Stdio.make({
      args: Effect.succeed([]),
      stdin: Stream.fromQueue(input),
      stdout: () =>
        Sink.forEach((chunk: string | Uint8Array) =>
          Queue.offer(
            output,
            typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true }),
          ),
        ),
      stderr: () => Sink.drain,
    }),
    input,
    output,
  };
});

type ChildProcessTerminationHandle = Pick<
  ChildProcessSpawner.ChildProcessHandle,
  "exitCode" | "pid"
>;

export const makeTerminationError = (
  handle: ChildProcessTerminationHandle,
  stderr: Effect.Effect<string> = Effect.succeed(""),
): Effect.Effect<CodexError.CodexAppServerError> =>
  Effect.matchEffect(handle.exitCode, {
    onFailure: (cause) =>
      Effect.succeed(
        new CodexError.CodexAppServerTransportError({
          operation: "read-process-exit-status",
          pid: handle.pid,
          cause,
        }),
      ),
    onSuccess: (code) =>
      Effect.map(
        stderr,
        (excerpt) =>
          new CodexError.CodexAppServerProcessExitedError({
            code,
            pid: handle.pid,
            ...(code !== 0 && excerpt ? { stderr: excerpt } : {}),
          }),
      ),
  });
