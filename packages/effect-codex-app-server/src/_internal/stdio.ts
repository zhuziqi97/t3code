import * as NodeUtil from "node:util";

import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Sink from "effect/Sink";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/process";

import * as CodexError from "../errors.ts";

const encoder = new TextEncoder();
const MAX_STDERR_CHARS = 4_096;
const STDERR_TRUNCATED = "[stderr truncated]\n";

function redactStderrExcerpt(text: string, truncated: boolean): string {
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

export const makeChildStdio = (
  handle: Pick<ChildProcessSpawner.ChildProcessHandle, "stdin" | "stdout">,
  stderrDrained: Effect.Effect<void>,
) =>
  Stdio.make({
    args: Effect.succeed([]),
    // Finish stderr separately from the protocol's exit-status deadline.
    stdin: handle.stdout.pipe(Stream.onEnd(stderrDrained)),
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

const STDERR_TAIL_MAX_CHARS = 8_192;
const STDERR_EXCERPT_MAX_CHARS = 512;
// `Error: …`, `TypeError: …`, `Error [ERR_MODULE_NOT_FOUND]: …`, `error: …`, `ERROR: …`, `fatal: …`
const ERROR_LINE_PATTERN = /^(?:[a-z]*error|fatal)(?: ?\[[^\]]+\])?:\s*\S/i;

export const appendStderrTail = (current: string, chunk: string): string => {
  const next = `${current}${chunk}`;
  return next.length <= STDERR_TAIL_MAX_CHARS ? next : next.slice(-STDERR_TAIL_MAX_CHARS);
};

// Node launchers print the actionable error between a source excerpt and stack frames.
export const stderrExcerpt = (tail: string): string | undefined => {
  const lines = redactStderrExcerpt(NodeUtil.stripVTControlCharacters(tail), false)
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter((line) => line.length > 0);
  const line = lines.findLast((candidate) => ERROR_LINE_PATTERN.test(candidate)) ?? lines.at(-1);
  if (line === undefined) {
    return undefined;
  }
  return line.length <= STDERR_EXCERPT_MAX_CHARS
    ? line
    : `${line.slice(0, STDERR_EXCERPT_MAX_CHARS - 1)}…`;
};

export const makeStderrTail = Effect.fn("makeStderrTail")(function* (
  stderr: ChildProcessSpawner.ChildProcessHandle["stderr"],
) {
  const tail = yield* Ref.make("");
  const drain = yield* stderr.pipe(
    Stream.decodeText(),
    Stream.runForEach((chunk) => Ref.update(tail, (current) => appendStderrTail(current, chunk))),
    Effect.ignore,
    Effect.forkScoped,
  );
  return {
    read: Ref.get(tail),
    awaitDrained: Fiber.join(drain).pipe(Effect.timeout("250 millis"), Effect.ignore),
  };
});

type ChildProcessTerminationHandle = Pick<
  ChildProcessSpawner.ChildProcessHandle,
  "exitCode" | "pid"
>;

export const makeTerminationError = (
  handle: ChildProcessTerminationHandle,
  stderrTail: Effect.Effect<string>,
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
      Effect.map(stderrTail, (tail) => {
        const stderr = stderrExcerpt(tail);
        return new CodexError.CodexAppServerProcessExitedError({
          code,
          pid: handle.pid,
          ...(stderr ? { stderr } : {}),
        });
      }),
  });
