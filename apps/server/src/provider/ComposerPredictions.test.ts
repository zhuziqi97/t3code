import { assert, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  NodeId,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Random from "effect/Random";
import type * as Schema from "effect/Schema";
import { CodexPredictionConfig } from "./CodexPredictionPolicy.ts";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ComposerPredictions from "./ComposerPredictions.ts";

const input = {
  threadId: ThreadId.make("thread-a"),
  sourceRunId: RunId.make("run-a"),
  requestId: "prediction-a",
  trigger: "live" as const,
};
const config = {
  is_enabled: true,
  prompt: "official fixture prompt",
  prompt_version: "fixture",
  prediction_reasoning_effort: "high",
  live_sample_rate: 1,
  catch_up_sample_rate: 1,
};
const token = (accountId: string) =>
  `fixture.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } })).toString("base64url")}.fixture`;
const projectionFixture = () =>
  ({
    thread: {
      id: "thread-a",
      interactionMode: "default",
      activeProviderThreadId: "provider-thread",
      modelSelection: { instanceId: "codex", model: null },
    },
    runs: [
      {
        id: "run-a",
        ordinal: 1,
        status: "completed",
        rootNodeId: "root-node",
        activeAttemptId: "attempt-a",
        providerThreadId: "provider-thread",
      },
    ],
    attempts: [
      {
        id: "attempt-a",
        runId: "run-a",
        rootNodeId: "root-node",
        providerThreadId: "provider-thread",
        providerTurnId: null,
        status: "completed",
      },
    ],
    nodes: [
      { id: "root-node", kind: "root_turn", runId: "run-a", providerTurnId: null },
      {
        id: "assistant-node",
        kind: "assistant_message",
        runId: "run-a",
        parentNodeId: "root-node",
        providerTurnId: "provider-turn",
      },
    ],
    providerThreads: [
      {
        id: "provider-thread",
        driver: "codex",
        providerInstanceId: "codex",
        providerSessionId: "session-a",
        ownerNodeId: null,
        nativeThreadRef: { nativeId: "native-root" },
        status: "idle",
      },
    ],
    providerTurns: [
      {
        id: "provider-turn",
        providerThreadId: "provider-thread",
        nodeId: "root-node",
        runAttemptId: "attempt-a",
        ordinal: 1,
        status: "completed",
        nativeTurnRef: { nativeId: "native-turn" },
      },
    ],
  }) as unknown as OrchestrationV2ThreadProjection;

const setup = (policy: Schema.Codec.Encoded<typeof CodexPredictionConfig> = config) =>
  Effect.gen(function* () {
    let projection = projectionFixture();
    let currentToken = token("account-a");
    let currentModel = "native-model";
    let contextAvailable = true;
    const arrived = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const retryArrived = yield* Deferred.make<void>();
    const retryRelease = yield* Deferred.make<void>();
    const configArrived = yield* Deferred.make<void>();
    const configRelease = yield* Deferred.make<void>();
    let heldRetry = false;
    let heldConfig = false;
    let held = false;
    let interrupted = false;
    let sampleText: string | null = '{"suggestion":"Editable suggestion"}';
    let sampleSource: string | null = null;
    let failSample = false;
    let failConfig = false;
    let draws = 0;
    let randomValue = 0.25;
    const samples: Array<
      Parameters<
        NonNullable<ProviderAdapter.ProviderAdapterV2SessionRuntime["nativePrediction"]>["sample"]
      >[0]
    > = [];
    const requests: Array<{ url: string; headers: Readonly<Record<string, string>> }> = [];
    const nativePrediction: NonNullable<
      ProviderAdapter.ProviderAdapterV2SessionRuntime["nativePrediction"]
    > = {
      context: () =>
        Effect.sync(() => (contextAvailable ? { token: currentToken, model: currentModel } : null)),
      sample: (value) =>
        Effect.gen(function* () {
          samples.push(value);
          if (samples.length === 2) {
            yield* Deferred.succeed(retryArrived, undefined);
            if (heldRetry) yield* Deferred.await(retryRelease);
          }
          yield* Deferred.succeed(arrived, undefined);
          if (held) yield* Deferred.await(release);
          if (failSample)
            return yield* new ProviderAdapter.ProviderAdapterProtocolError({
              driver: ProviderDriverKind.make("codex"),
              detail: "fixture failure",
              cause: null,
            });
          return { sourceTurnId: sampleSource ?? value.sourceTurnId, text: sampleText };
        }).pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              interrupted = true;
            }),
          ),
        ),
    };
    let runtime = {
      nativePrediction,
      providerSessionId: "session-a",
    } as unknown as ProviderAdapter.ProviderAdapterV2SessionRuntime;
    const context = yield* Layer.build(
      ComposerPredictions.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(ProjectionStore.ProjectionStoreV2)({
              getThreadProjection: () => Effect.sync(() => projection),
            }),
            Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
              get: () => Effect.succeedSome(runtime),
            }),
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make((request) =>
                Effect.gen(function* () {
                  requests.push({ url: request.url, headers: request.headers });
                  yield* Deferred.succeed(configArrived, undefined);
                  if (heldConfig) yield* Deferred.await(configRelease);
                  return HttpClientResponse.fromWeb(
                    request,
                    Response.json(policy, { status: failConfig ? 503 : 200 }),
                  );
                }),
              ),
            ),
          ),
        ),
      ),
    );
    const service = yield* ComposerPredictions.ComposerPredictions.pipe(Effect.provide(context));
    return {
      service: {
        ...service,
        request: (value: Parameters<typeof service.request>[0]) =>
          service.request(value).pipe(
            Effect.provideService(Random.Random, {
              nextIntUnsafe: () => 0,
              nextDoubleUnsafe: () => {
                draws++;
                return randomValue;
              },
            }),
          ),
      },
      draws: () => draws,
      setContextAvailable: (value: boolean) => {
        contextAvailable = value;
      },
      setRandom: (value: number) => {
        randomValue = value;
      },
      failConfig: (value: boolean) => {
        failConfig = value;
      },
      samples,
      requests,
      arrived,
      release,
      retryArrived,
      retryRelease,
      configArrived,
      configRelease,
      holdConfig: () => {
        heldConfig = true;
      },
      holdRetry: () => {
        heldRetry = true;
      },
      hold: () => {
        held = true;
      },
      interrupted: () => interrupted,
      setText: (text: string | null) => {
        sampleText = text;
      },
      wrongSource: () => {
        sampleSource = "older-native-turn";
      },
      fail: (value = true) => {
        failSample = value;
      },
      changeSession: () => {
        projection = {
          ...projection,
          providerThreads: [
            {
              ...projection.providerThreads[0]!,
              providerSessionId:
                "session-b" as ProviderAdapter.ProviderAdapterV2SessionRuntime["providerSessionId"],
            },
          ],
        };
      },
      changeProvider: () => {
        projection = {
          ...projection,
          thread: {
            ...projection.thread,
            modelSelection: {
              ...projection.thread.modelSelection,
              instanceId: "other-provider" as typeof projection.thread.modelSelection.instanceId,
            },
          },
        };
      },
      changeModel: () => {
        projection = {
          ...projection,
          thread: {
            ...projection.thread,
            modelSelection: { ...projection.thread.modelSelection, model: "other-model" },
          },
        };
      },
      changeNativeModel: () => {
        currentModel = "other-native-model";
      },
      changeRuntime: () => {
        runtime = { ...runtime, nativePrediction: { ...nativePrediction } };
      },
      changeAccount: () => {
        currentToken = token("account-b");
      },
      advanceParent: () => {
        const runId = RunId.make("run-b");
        const rootNodeId = NodeId.make("root-node-b");
        const attemptId = RunAttemptId.make("attempt-b");
        projection = {
          ...projection,
          runs: [
            ...projection.runs,
            {
              ...projection.runs[0]!,
              id: runId,
              ordinal: 2,
              rootNodeId,
              activeAttemptId: attemptId,
            },
          ],
          attempts: [
            ...projection.attempts,
            { ...projection.attempts[0]!, id: attemptId, runId, rootNodeId },
          ],
          nodes: [...projection.nodes, { ...projection.nodes[0]!, id: rootNodeId, runId }],
          providerTurns: [
            ...projection.providerTurns,
            {
              ...projection.providerTurns[0]!,
              id: ProviderTurnId.make("provider-turn-b"),
              runAttemptId: attemptId,
              nodeId: rootNodeId,
              ordinal: 2,
              nativeTurnRef: {
                ...projection.providerTurns[0]!.nativeTurnRef!,
                nativeId: "native-turn-b",
              },
            },
          ],
        };
      },
    };
  });

it.effect(
  "uses the destination native session and official prompt without a moderation hard block",
  () =>
    Effect.gen(function* () {
      const h = yield* setup();
      const result = yield* h.service.request(input);
      assert.equal(result.status, "suggestion");
      assert.equal(result.text, "Editable suggestion");
      assert.equal(h.samples[0]?.providerThread.nativeThreadRef?.nativeId, "native-root");
      assert.equal(h.samples[0]?.sourceTurnId, "native-turn");
      assert.isTrue(h.samples[0]!.prompt.startsWith("official fixture prompt\n\nReturn only JSON"));
      assert.equal(h.samples[0]?.effort, "high");
      assert.equal(h.requests[0]?.url, "https://chatgpt.com/backend-api/wham/predictions/config");
      assert.equal(h.requests[0]?.headers["chatgpt-account-id"], "account-a");
      assert.isUndefined(h.requests[0]?.headers.originator);
      yield* h.service.request({ ...input, requestId: "same-account", intent: "manual" });
      yield* h.service.request({ ...input, requestId: "reopen-suggestion", intent: "manual" });
      assert.equal(h.draws(), 1);
      assert.equal(h.requests.length, 1);
      assert.equal(h.samples.length, 1);
      h.changeAccount();
      yield* h.service.request({ ...input, requestId: "new-account" });
      assert.equal(h.requests.length, 2);
      assert.equal(h.requests[1]?.headers["chatgpt-account-id"], "account-b");
    }).pipe(Effect.scoped),
);

it.effect.each([
  ["disabled", { ...config, is_enabled: false }, "disabled"],
  ["model exclusion", { ...config, unsupported_models: ["native-model"] }, "unsupported"],
  ["zero live rate", { ...config, live_sample_rate: 0 }, "not_selected"],
  ["not selected", { ...config, live_sample_rate: 0.1 }, "not_selected"],
] as const)("does not sample for %s", ([_name, policy, expected]) =>
  Effect.gen(function* () {
    const h = yield* setup(policy);
    assert.equal((yield* h.service.request(input)).status, expected);
    h.setContextAvailable(false);
    assert.equal(
      (yield* h.service.request({ ...input, intent: "manual", requestId: "no-context" })).status,
      "unsupported",
    );
    h.setContextAvailable(true);
    h.setRandom(0);
    yield* h.service.request({
      ...input,
      requestId: "manual",
      trigger: "catch_up",
      intent: "manual",
    });
    yield* h.service.request({ ...input, requestId: "manual-again", intent: "manual" });
    assert.equal(h.draws(), 1);
    assert.equal(h.requests.length, 1);
    assert.equal(h.samples.length, 0);
  }).pipe(Effect.scoped),
);

it.effect(
  "shares concurrent live and catch-up work while cancelling each caller independently",
  () =>
    Effect.gen(function* () {
      const h = yield* setup();
      h.hold();
      const first = yield* h.service
        .request(input)
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(h.arrived);
      const second = yield* h.service
        .request({ ...input, requestId: "second-client", trigger: "catch_up", intent: "manual" })
        .pipe(Effect.forkChild({ startImmediately: true }));
      assert.equal(h.samples.length, 1);
      yield* h.service.cancel(input);
      assert.equal((yield* Fiber.join(first)).status, "cancelled");
      assert.isFalse(h.interrupted());
      yield* Deferred.succeed(h.release, undefined);
      assert.deepEqual(yield* Fiber.join(second), {
        requestId: "second-client",
        sourceRunId: input.sourceRunId,
        status: "suggestion",
        text: "Editable suggestion",
      });
      assert.equal(
        (yield* h.service.request({ ...input, requestId: "reopen" })).status,
        "suggestion",
      );
      assert.equal(h.samples.length, 1);
    }).pipe(Effect.scoped),
);

it.effect("keeps a replacement manual attempt independent of the previous callers' cleanup", () =>
  Effect.gen(function* () {
    const h = yield* setup({ ...config, live_sample_rate: 0.5 });
    h.setText(null);
    h.hold();
    h.holdRetry();
    const retryOwner = yield* h.service.request(input).pipe(
      Effect.flatMap((result) => {
        assert.equal(result.status, "empty");
        h.setText('{"suggestion":"Manual retry"}');
        h.setRandom(0.99);
        return h.service.request({ ...input, requestId: "retry-owner", intent: "manual" });
      }),
      Effect.forkChild({ startImmediately: true }),
    );
    yield* Deferred.await(h.arrived);
    const oldCaller = yield* h.service
      .request({ ...input, requestId: "old-client", intent: "manual" })
      .pipe(Effect.forkChild({ startImmediately: true }));
    yield* Deferred.succeed(h.release, undefined);
    yield* Deferred.await(h.retryArrived);
    assert.equal((yield* Fiber.join(oldCaller)).status, "empty");
    const joined = yield* h.service
      .request({ ...input, requestId: "retry-joined", intent: "manual" })
      .pipe(Effect.forkChild({ startImmediately: true }));
    yield* h.service.cancel({ ...input, requestId: "retry-owner" });
    assert.equal((yield* Fiber.join(retryOwner)).status, "cancelled");
    assert.isFalse(h.interrupted());
    assert.equal(h.samples.length, 2);
    assert.equal(h.draws(), 1);
    yield* Deferred.succeed(h.retryRelease, undefined);
    assert.equal((yield* Fiber.join(joined)).text, "Manual retry");
  }).pipe(Effect.scoped),
);

it.effect("cancels preparation before the gate and lets only manual intent restart it", () =>
  Effect.gen(function* () {
    const h = yield* setup({ ...config, live_sample_rate: 0.5, catch_up_sample_rate: 0 });
    h.holdConfig();
    const pending = yield* h.service.request(input).pipe(Effect.forkChild);
    yield* Deferred.await(h.configArrived);
    yield* h.service.cancel(input);
    assert.equal((yield* Fiber.join(pending)).status, "cancelled");
    assert.equal(h.draws(), 0);
    assert.equal(h.samples.length, 0);
    assert.equal(
      (yield* h.service.request({ ...input, requestId: "auto-after-preparation" })).status,
      "cancelled",
    );
    yield* Deferred.succeed(h.configRelease, undefined);
    assert.equal(
      (yield* h.service.request({
        ...input,
        requestId: "retry-preparation",
        intent: "manual",
        trigger: "catch_up",
      })).status,
      "suggestion",
    );
    assert.equal(h.draws(), 1);
    assert.equal(h.requests.length, 2);
    assert.equal(h.samples.length, 1);
  }).pipe(Effect.scoped),
);

it.effect("does not let a stale client cancel another client's current source", () =>
  Effect.gen(function* () {
    const h = yield* setup();
    h.advanceParent();
    h.hold();
    const current = yield* h.service
      .request({ ...input, sourceRunId: RunId.make("run-b"), requestId: "current-client" })
      .pipe(Effect.forkChild);
    yield* Deferred.await(h.arrived);
    assert.equal((yield* h.service.request(input)).status, "not_idle");
    yield* Deferred.succeed(h.release, undefined);
    assert.equal((yield* Fiber.join(current)).status, "suggestion");
    assert.isFalse(h.interrupted());
  }).pipe(Effect.scoped),
);

it.effect("discards the previous source and session result instead of retaining turn history", () =>
  Effect.gen(function* () {
    const h = yield* setup();
    yield* h.service.request(input);
    h.advanceParent();
    yield* h.service.request({
      ...input,
      sourceRunId: RunId.make("run-b"),
      requestId: "next-source",
    });
    assert.equal(h.samples.length, 2);
    h.changeSession();
    yield* h.service.request({
      ...input,
      sourceRunId: RunId.make("run-b"),
      requestId: "next-session",
    });
    assert.equal(h.samples.length, 3);
  }).pipe(Effect.scoped),
);

it.effect.each([null, "invalid JSON", '{"suggestion":null}'])(
  "closes an empty or tool-suppressed native sample: %s",
  (text) =>
    Effect.gen(function* () {
      const h = yield* setup({ ...config, live_sample_rate: 0.5 });
      h.setText(text);
      assert.deepEqual(yield* h.service.request(input), {
        requestId: input.requestId,
        sourceRunId: input.sourceRunId,
        status: "empty",
        text: null,
      });
      yield* h.service.request({ ...input, requestId: "reopen-empty" });
      assert.equal(h.samples.length, 1);
      h.setRandom(0.99);
      assert.equal(
        (yield* h.service.request({ ...input, requestId: "retry-empty", intent: "manual" })).status,
        "empty",
      );
      assert.equal(h.samples.length, 2);
      assert.equal(h.draws(), 1);
      h.setText('{"suggestion":"Retry suggestion"}');
      assert.equal(
        (yield* h.service.request({ ...input, requestId: "retry-empty-success", intent: "manual" }))
          .status,
        "suggestion",
      );
      yield* h.service.request({ ...input, requestId: "cached-success", intent: "manual" });
      assert.equal(h.samples.length, 3);
      assert.equal(h.draws(), 1);
    }).pipe(Effect.scoped),
);

it.effect("retries a native error only with manual intent and reuses the gate", () =>
  Effect.gen(function* () {
    const h = yield* setup({ ...config, live_sample_rate: 0.5 });
    h.fail();
    assert.equal((yield* h.service.request(input)).status, "error");
    assert.equal(
      (yield* h.service.request({ ...input, requestId: "reopen-error" })).status,
      "error",
    );
    assert.equal(h.samples.length, 1);
    h.fail(false);
    h.setRandom(0.99);
    assert.equal(
      (yield* h.service.request({ ...input, requestId: "retry-error", intent: "manual" })).status,
      "suggestion",
    );
    assert.equal(h.samples.length, 2);
    assert.equal(h.draws(), 1);
    assert.equal(h.requests.length, 1);
  }).pipe(Effect.scoped),
);

it.effect(
  "retries configuration failure manually before making the source's first gate decision",
  () =>
    Effect.gen(function* () {
      const h = yield* setup({ ...config, live_sample_rate: 0.5, catch_up_sample_rate: 0 });
      h.failConfig(true);
      assert.equal((yield* h.service.request(input)).status, "error");
      yield* h.service.request({ ...input, requestId: "auto-error", intent: "auto" });
      assert.equal(h.requests.length, 1);
      assert.equal(h.draws(), 0);
      h.failConfig(false);
      assert.equal(
        (yield* h.service.request({
          ...input,
          requestId: "manual-config",
          trigger: "catch_up",
          intent: "manual",
        })).status,
        "suggestion",
      );
      assert.equal(h.requests.length, 2);
      assert.equal(h.draws(), 1);
      assert.equal(h.samples.length, 1);
    }).pipe(Effect.scoped),
);

it.effect("rejects a native response belonging to another source turn", () =>
  Effect.gen(function* () {
    const h = yield* setup();
    h.wrongSource();
    assert.equal((yield* h.service.request(input)).status, "stale");
    assert.equal(
      (yield* h.service.request({ ...input, intent: "manual", requestId: "wrong-source-retry" }))
        .status,
      "stale",
    );
    assert.equal(h.samples.length, 1);
  }).pipe(Effect.scoped),
);

it.effect.each([
  "changeSession",
  "changeProvider",
  "changeModel",
  "changeNativeModel",
  "changeAccount",
  "changeRuntime",
] as const)("invalidates an in-flight prediction on %s", (change) =>
  Effect.gen(function* () {
    const h = yield* setup();
    h.hold();
    const pending = yield* h.service.request(input).pipe(Effect.forkChild);
    yield* Deferred.await(h.arrived);
    h[change]();
    yield* Deferred.succeed(h.release, undefined);
    assert.equal((yield* Fiber.join(pending)).status, "stale");
  }).pipe(Effect.scoped),
);

it.effect("drops a late native result after the parent completes another run", () =>
  Effect.gen(function* () {
    const h = yield* setup();
    h.hold();
    const pending = yield* h.service.request(input).pipe(Effect.forkChild);
    yield* Deferred.await(h.arrived);
    h.advanceParent();
    yield* Deferred.succeed(h.release, undefined);
    const result = yield* Fiber.join(pending);
    assert.equal(result.status, "stale");
    assert.isNull(result.text);
  }).pipe(Effect.scoped),
);

it.effect("releases native work when its only RPC caller disconnects", () =>
  Effect.gen(function* () {
    const h = yield* setup();
    h.hold();
    const pending = yield* h.service.request(input).pipe(Effect.forkChild);
    yield* Deferred.await(h.arrived);
    yield* Fiber.interrupt(pending);
    assert.isTrue(h.interrupted());
    yield* Deferred.succeed(h.release, undefined);
    assert.equal(
      (yield* h.service.request({ ...input, requestId: "after-disconnect" })).status,
      "cancelled",
    );
    assert.equal(h.samples.length, 1);
    h.setRandom(0.99);
    assert.equal(
      (yield* h.service.request({
        ...input,
        intent: "manual",
        requestId: "manual-after-disconnect",
      })).status,
      "suggestion",
    );
    assert.equal(h.samples.length, 2);
    assert.equal(h.draws(), 1);
  }).pipe(Effect.scoped),
);

it.effect("cancels only the matching app request and interrupts native sampling", () =>
  Effect.gen(function* () {
    const h = yield* setup();
    h.hold();
    const pending = yield* h.service.request(input).pipe(Effect.forkChild);
    yield* Deferred.await(h.arrived);
    yield* h.service.cancel({ threadId: input.threadId, requestId: "older-request" });
    assert.isFalse(h.interrupted());
    yield* h.service.cancel(input);
    const result = yield* Fiber.join(pending);
    assert.equal(result.status, "cancelled");
    assert.isNull(result.text);
    assert.isTrue(h.interrupted());
    yield* Deferred.succeed(h.release, undefined);
    assert.equal(
      (yield* h.service.request({ ...input, requestId: "auto-after-cancel" })).status,
      "cancelled",
    );
    assert.equal(h.samples.length, 1);
    h.setRandom(0.99);
    assert.equal(
      (yield* h.service.request({ ...input, requestId: "manual-after-cancel", intent: "manual" }))
        .status,
      "suggestion",
    );
    assert.equal(h.samples.length, 2);
    assert.equal(h.draws(), 1);
  }).pipe(Effect.scoped),
);

it("selects the root native turn by active attempt when node and attempt pointers are null", () => {
  const source = ComposerPredictions.predictionSource(projectionFixture(), "run-a");
  assert.equal(source?.turn.nativeTurnRef?.nativeId, "native-turn");
});

it("selects the latest goal turn within the active attempt rather than a newer foreign attempt", () => {
  const projection = projectionFixture();
  const turn = projection.providerTurns[0]!;
  const source = ComposerPredictions.predictionSource(
    {
      ...projection,
      providerTurns: [
        {
          ...turn,
          id: ProviderTurnId.make("latest-goal-turn"),
          ordinal: 2,
          nativeTurnRef: { ...turn.nativeTurnRef!, nativeId: "latest-native-goal-turn" },
        },
        {
          ...turn,
          id: ProviderTurnId.make("foreign-turn"),
          runAttemptId: RunAttemptId.make("other-attempt"),
          ordinal: 20,
        },
        turn,
      ],
    },
    "run-a",
  );
  assert.equal(source?.turn.nativeTurnRef?.nativeId, "latest-native-goal-turn");
});

it.each(["attempt", "thread", "child node", "running", "native ref"] as const)(
  "rejects a source with mismatched %s ownership or state",
  (field) => {
    const projection = projectionFixture();
    const turn = {
      ...projection.providerTurns[0]!,
      ...(field === "attempt" ? { runAttemptId: RunAttemptId.make("other-attempt") } : {}),
      ...(field === "thread"
        ? { providerThreadId: ProviderThreadId.make("other-provider-thread") }
        : {}),
      ...(field === "child node" ? { nodeId: NodeId.make("assistant-node") } : {}),
      ...(field === "running" ? { status: "running" as const } : {}),
      ...(field === "native ref" ? { nativeTurnRef: null } : {}),
    };
    assert.isNull(
      ComposerPredictions.predictionSource({ ...projection, providerTurns: [turn] }, "run-a"),
    );
  },
);

it("does not reuse an earlier completed goal turn while its latest turn is running", () => {
  const projection = projectionFixture();
  assert.isNull(
    ComposerPredictions.predictionSource(
      {
        ...projection,
        providerTurns: [
          ...projection.providerTurns,
          {
            ...projection.providerTurns[0]!,
            id: ProviderTurnId.make("running-goal-turn"),
            ordinal: 2,
            status: "running",
          },
        ],
      },
      "run-a",
    ),
  );
});

it("requires the latest idle root source and never revives an earlier completed run", () => {
  const projection = projectionFixture();
  assert.isNotNull(ComposerPredictions.predictionSource(projection, "run-a"));
  assert.isNull(
    ComposerPredictions.predictionSource(
      {
        ...projection,
        runs: [
          ...projection.runs,
          { ...projection.runs[0]!, id: RunId.make("run-b"), ordinal: 2, status: "running" },
        ],
      },
      "run-a",
    ),
  );
  assert.isNull(
    ComposerPredictions.predictionSource(
      { ...projection, thread: { ...projection.thread, interactionMode: "plan" } },
      "run-a",
    ),
  );
  assert.isNull(
    ComposerPredictions.predictionSource(
      {
        ...projection,
        providerThreads: [
          { ...projection.providerThreads[0]!, ownerNodeId: projection.nodes[0]!.id },
        ],
      },
      "run-a",
    ),
  );
});
