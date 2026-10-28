import { assert, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
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
    runs: [{ id: "run-a", ordinal: 1, status: "completed", rootNodeId: "root-node" }],
    nodes: [{ id: "root-node", providerTurnId: "provider-turn" }],
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
        status: "completed",
        nativeTurnRef: { nativeId: "native-turn" },
      },
    ],
  }) as unknown as OrchestrationV2ThreadProjection;

const setup = (policy: Schema.Codec.Encoded<typeof CodexPredictionConfig> = config) =>
  Effect.gen(function* () {
    let projection = projectionFixture();
    let currentToken = token("account-a");
    const arrived = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let held = false;
    let interrupted = false;
    let sampleText: string | null = '{"suggestion":"Editable suggestion"}';
    let sampleSource = "native-turn";
    let failSample = false;
    const samples: Array<
      Parameters<
        NonNullable<ProviderAdapter.ProviderAdapterV2SessionRuntime["nativePrediction"]>["sample"]
      >[0]
    > = [];
    const requests: Array<{ url: string; headers: Readonly<Record<string, string>> }> = [];
    const nativePrediction: NonNullable<
      ProviderAdapter.ProviderAdapterV2SessionRuntime["nativePrediction"]
    > = {
      context: () => Effect.sync(() => ({ token: currentToken, model: "native-model" })),
      sample: (value) =>
        Effect.gen(function* () {
          samples.push(value);
          yield* Deferred.succeed(arrived, undefined);
          if (held) yield* Deferred.await(release);
          if (failSample)
            return yield* new ProviderAdapter.ProviderAdapterProtocolError({
              driver: ProviderDriverKind.make("codex"),
              detail: "fixture failure",
              cause: null,
            });
          return { sourceTurnId: sampleSource, text: sampleText };
        }).pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              interrupted = true;
            }),
          ),
        ),
    };
    const runtime = {
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
                Effect.sync(() => {
                  requests.push({ url: request.url, headers: request.headers });
                  return HttpClientResponse.fromWeb(request, Response.json(policy));
                }),
              ),
            ),
          ),
        ),
      ),
    );
    const service = yield* ComposerPredictions.ComposerPredictions.pipe(Effect.provide(context));
    return {
      service,
      samples,
      requests,
      arrived,
      release,
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
      fail: () => {
        failSample = true;
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
      changeAccount: () => {
        currentToken = token("account-b");
      },
      advanceParent: () => {
        projection = {
          ...projection,
          runs: [
            ...projection.runs,
            { ...projection.runs[0]!, id: RunId.make("run-b"), ordinal: 2 },
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
      yield* h.service.request({ ...input, requestId: "same-account" });
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
] as const)("does not sample for %s", ([_name, policy, expected]) =>
  Effect.gen(function* () {
    const h = yield* setup(policy);
    assert.equal((yield* h.service.request(input)).status, expected);
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
        .request({ ...input, requestId: "second-client", trigger: "catch_up" })
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
      const h = yield* setup();
      h.setText(text);
      assert.deepEqual(yield* h.service.request(input), {
        requestId: input.requestId,
        sourceRunId: input.sourceRunId,
        status: "empty",
        text: null,
      });
      yield* h.service.request({ ...input, requestId: "reopen-empty" });
      assert.equal(h.samples.length, 1);
    }).pipe(Effect.scoped),
);

it.effect("closes a native error without repeating a potentially charged sample", () =>
  Effect.gen(function* () {
    const h = yield* setup();
    h.fail();
    assert.equal((yield* h.service.request(input)).status, "error");
    assert.equal(
      (yield* h.service.request({ ...input, requestId: "reopen-error" })).status,
      "error",
    );
    assert.equal(h.samples.length, 1);
  }).pipe(Effect.scoped),
);

it.effect("rejects a native response belonging to another source turn", () =>
  Effect.gen(function* () {
    const h = yield* setup();
    h.wrongSource();
    assert.equal((yield* h.service.request(input)).status, "stale");
  }).pipe(Effect.scoped),
);

it.effect.each(["changeSession", "changeProvider"] as const)(
  "invalidates an in-flight prediction on %s",
  (change) =>
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
      "suggestion",
    );
    assert.equal(h.samples.length, 2);
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
  }).pipe(Effect.scoped),
);

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
