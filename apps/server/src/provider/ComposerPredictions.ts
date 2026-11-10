import { decodeJwt } from "jose";
import {
  latestProviderTurnForAttempt,
  type ComposerPredictionInput,
  type ComposerPredictionResult,
  type OrchestrationV2ThreadProjection,
  type ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { HttpClient, HttpClientRequest } from "effect/http";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import {
  CodexPredictionConfig,
  formatPredictionPrompt,
  parsePrediction,
  predictionGate,
} from "./CodexPredictionPolicy.ts";

export function predictionSource(projection: OrchestrationV2ThreadProjection, sourceRunId: string) {
  const latest = projection.runs.reduce<(typeof projection.runs)[number] | undefined>(
    (a, b) => (!a || b.ordinal > a.ordinal ? b : a),
    undefined,
  );
  if (
    !latest ||
    latest.id !== sourceRunId ||
    latest.status !== "completed" ||
    projection.thread.interactionMode === "plan"
  )
    return null;
  const thread = projection.providerThreads.find(
    (t) => t.id === projection.thread.activeProviderThreadId,
  );
  if (
    !thread ||
    thread.driver !== "codex" ||
    thread.ownerNodeId !== null ||
    thread.status !== "idle" ||
    !thread.providerSessionId ||
    !thread.nativeThreadRef?.nativeId ||
    thread.providerInstanceId !== projection.thread.modelSelection.instanceId
  )
    return null;
  const turn = latestProviderTurnForAttempt(projection.providerTurns, latest.activeAttemptId);
  if (
    !turn ||
    turn.nodeId !== latest.rootNodeId ||
    turn.status !== "completed" ||
    turn.providerThreadId !== thread.id ||
    !turn.nativeTurnRef?.nativeId
  )
    return null;
  return {
    thread,
    turn,
    key: JSON.stringify([
      latest.id,
      thread.providerSessionId,
      thread.nativeThreadRef.nativeId,
      turn.nativeTurnRef.nativeId,
      projection.thread.modelSelection,
    ]),
  };
}

export class ComposerPredictions extends Context.Service<
  ComposerPredictions,
  {
    readonly request: (input: ComposerPredictionInput) => Effect.Effect<ComposerPredictionResult>;
    readonly cancel: (input: {
      readonly threadId: ThreadId;
      readonly requestId: string;
    }) => Effect.Effect<void>;
  }
>()("t3/provider/ComposerPredictions") {}

const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const http = yield* HttpClient.HttpClient;
  const scope = yield* Scope.Scope;
  type Outcome = Pick<ComposerPredictionResult, "status" | "text">;
  type Attempt = {
    result: Deferred.Deferred<Outcome>;
    cancel: Deferred.Deferred<void>;
    callers: Map<Deferred.Deferred<void>, string>;
    outcome?: Outcome;
  };
  type Source = {
    key: string;
    runtime: object;
    token: string;
    model: string;
    trigger: ComposerPredictionInput["trigger"];
    gate?: { config: CodexPredictionConfig; status: ReturnType<typeof predictionGate> };
    attempt?: Attempt;
  };
  const sources = new Map<ThreadId, Source>();
  const discard = Effect.fn("ComposerPredictions.discard")(function* (
    threadId: ThreadId,
    entry: Source | undefined,
  ) {
    if (entry && sources.get(threadId) === entry) {
      sources.delete(threadId);
      if (entry.attempt) yield* Deferred.succeed(entry.attempt.cancel, undefined);
    }
  });
  const configs = new WeakMap<
    object,
    { token: string; at: number; config: CodexPredictionConfig }
  >();
  const decodeConfig = Schema.decodeUnknownEffect(CodexPredictionConfig);
  const accountClaims = Schema.decodeUnknownEffect(
    Schema.Struct({
      "https://api.openai.com/auth": Schema.Struct({
        chatgpt_account_id: Schema.optionalKey(Schema.String),
        account_id: Schema.optionalKey(Schema.String),
      }),
    }),
  );
  const request = Effect.fn("ComposerPredictions.request")(
    function* (input: ComposerPredictionInput) {
      const result = (
        status: ComposerPredictionResult["status"],
        text: string | null = null,
      ): ComposerPredictionResult => ({
        requestId: input.requestId,
        sourceRunId: input.sourceRunId,
        status,
        text,
      });
      const before = predictionSource(
        yield* projections.getThreadProjection(input.threadId),
        input.sourceRunId,
      );
      if (!before) return result("not_idle");
      const observed = sources.get(input.threadId);
      const runtime = Option.getOrNull(yield* sessions.get(before.thread.providerSessionId!));
      const native = runtime?.nativePrediction;
      const context = native
        ? yield* native.context(before.thread).pipe(Effect.orElseSucceed(() => null))
        : null;
      if (!native || !context) {
        if (observed?.key === before.key && observed.runtime === native) {
          if (observed.attempt) yield* Deferred.succeed(observed.attempt.cancel, undefined);
        } else {
          yield* discard(input.threadId, observed);
        }
        return result("unsupported");
      }
      if (
        predictionSource(yield* projections.getThreadProjection(input.threadId), input.sourceRunId)
          ?.key !== before.key
      ) {
        yield* discard(input.threadId, observed);
        return result("stale");
      }
      let entry = sources.get(input.threadId);
      if (
        entry &&
        (entry.key !== before.key ||
          entry.runtime !== native ||
          entry.token !== context.token ||
          entry.model !== context.model)
      ) {
        yield* discard(input.threadId, entry);
        entry = undefined;
      }
      if (!entry) {
        entry = {
          key: before.key,
          runtime: native,
          token: context.token,
          model: context.model,
          trigger: input.trigger,
        };
        sources.set(input.threadId, entry);
      }
      const source = entry;
      const isCurrent = Effect.gen(function* () {
        const runtime = Option.getOrNull(yield* sessions.get(before.thread.providerSessionId!));
        if (runtime?.nativePrediction !== native) return false;
        const latestContext = yield* native
          .context(before.thread)
          .pipe(Effect.orElseSucceed(() => null));
        return (
          sources.get(input.threadId) === source &&
          latestContext?.token === source.token &&
          latestContext.model === source.model &&
          predictionSource(
            yield* projections.getThreadProjection(input.threadId),
            input.sourceRunId,
          )?.key === source.key
        );
      });
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          let attempt = source.attempt;
          const retry =
            input.intent === "manual" &&
            (attempt?.outcome?.status === "empty" ||
              attempt?.outcome?.status === "error" ||
              attempt?.outcome?.status === "cancelled");
          const start = !attempt || retry;
          if (start) {
            attempt = {
              result: Deferred.makeUnsafe<Outcome>(),
              cancel: Deferred.makeUnsafe<void>(),
              callers: new Map(),
            };
            source.attempt = attempt;
          }
          const current = attempt!;
          const caller = Deferred.makeUnsafe<void>();
          current.callers.set(caller, input.requestId);
          if (start) {
            const started = current;

            const work = Effect.gen(function* () {
              if (!source.gate) {
                const now = yield* Clock.currentTimeMillis;
                const cached = configs.get(native);
                let config: CodexPredictionConfig;
                if (cached?.token === context.token && now - cached.at < 300_000) {
                  config = cached.config;
                } else {
                  const claims = yield* Effect.try({
                    try: () => decodeJwt(context.token),
                    catch: (cause) => new Cause.UnknownError(cause),
                  }).pipe(Effect.flatMap(accountClaims));
                  const auth = claims["https://api.openai.com/auth"];
                  const accountId = auth.chatgpt_account_id ?? auth.account_id;
                  if (!accountId) return result("unsupported");
                  const response = yield* http.execute(
                    HttpClientRequest.get(
                      "https://chatgpt.com/backend-api/wham/predictions/config",
                    ).pipe(
                      HttpClientRequest.bearerToken(context.token),
                      HttpClientRequest.setHeaders({
                        "ChatGPT-Account-Id": accountId,
                        "User-Agent": "T3-Code-native-predictions/1.0",
                        Accept: "application/json",
                      }),
                    ),
                  );
                  if (response.status !== 200) return result("error");
                  config = yield* response.json.pipe(Effect.flatMap(decodeConfig));
                  configs.set(native, { token: context.token, at: now, config });
                }
                const random = yield* Random.Random;
                // Store the official decision with its draw; cancellation only retires the attempt.
                yield* Effect.sync(() => {
                  source.gate = {
                    config,
                    status: predictionGate(
                      config,
                      context.model,
                      source.trigger,
                      random.nextDoubleUnsafe(),
                    ),
                  };
                });
              }
              const { config, status } = source.gate!;
              if (status) return result(status);
              if (!(yield* isCurrent)) return result("stale");
              const sample = yield* native.sample({
                providerThread: before.thread,
                sourceTurnId: before.turn.nativeTurnRef!.nativeId!,
                prompt: formatPredictionPrompt(config.prompt),
                effort: config.prediction_reasoning_effort,
              });
              if (
                !(yield* isCurrent) ||
                (sample && sample.sourceTurnId !== before.turn.nativeTurnRef!.nativeId)
              )
                return result("stale");
              const text = parsePrediction(sample?.text ?? null);
              return result(text ? "suggestion" : "empty", text);
            });
            yield* work.pipe(
              Effect.raceFirst(Deferred.await(started.cancel).pipe(Effect.as(result("cancelled")))),
              Effect.orElseSucceed(() => result("error")),
              Effect.flatMap((outcome) =>
                Effect.gen(function* () {
                  started.outcome = { status: outcome.status, text: outcome.text };
                  yield* Deferred.succeed(started.result, {
                    status: outcome.status,
                    text: outcome.text,
                  });
                }),
              ),
              Effect.interruptible,
              Effect.forkIn(scope),
            );
          }
          return yield* restore(
            Deferred.await(current.result).pipe(
              Effect.map((outcome) => result(outcome.status, outcome.text)),
              Effect.raceFirst(Deferred.await(caller).pipe(Effect.as(result("cancelled")))),
            ),
          ).pipe(
            Effect.ensuring(
              Effect.gen(function* () {
                current.callers.delete(caller);
                if (current.callers.size === 0 && !(yield* Deferred.isDone(current.result))) {
                  yield* Deferred.succeed(current.cancel, undefined);
                  yield* Deferred.await(current.result);
                }
              }),
            ),
          );
        }),
      );
    },
    (effect, input) =>
      effect.pipe(
        Effect.orElseSucceed((): ComposerPredictionResult => ({
          requestId: input.requestId,
          sourceRunId: input.sourceRunId,
          status: "error",
          text: null,
        })),
      ),
  );
  const cancel = Effect.fn("ComposerPredictions.cancel")(function* (input: {
    readonly threadId: ThreadId;
    readonly requestId: string;
  }) {
    const attempt = sources.get(input.threadId)?.attempt;
    if (attempt) {
      for (const [caller, requestId] of attempt.callers) {
        if (requestId === input.requestId) {
          attempt.callers.delete(caller);
          yield* Deferred.succeed(caller, undefined);
        }
      }
      if (attempt.callers.size === 0 && !(yield* Deferred.isDone(attempt.result))) {
        yield* Deferred.succeed(attempt.cancel, undefined);
        yield* Deferred.await(attempt.result);
      }
    }
  });
  return ComposerPredictions.of({ request, cancel });
});
export const layer = Layer.effect(ComposerPredictions, make);
