import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { CodexSettings } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import {
  applyNativeCodexDefaultModel,
  checkCodexProviderStatus,
  mapCodexModelCapabilities,
} from "./CodexProvider.ts";

it("maps current Codex model capability fields", () => {
  const capabilities = mapCodexModelCapabilities({
    additionalSpeedTiers: [],
    defaultReasoningEffort: "super-high",
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    defaultServiceTier: "flex",
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "Lower latency responses.",
      },
      {
        id: "flex",
        name: "Flex",
        description: "Lower-cost asynchronous routing.",
      },
    ],
    supportedReasoningEfforts: [
      {
        description: "Maximum reasoning",
        reasoningEffort: "super-high",
      },
    ],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [{ id: "super-high", label: "super-high", isDefault: true }],
      currentValue: "super-high",
    },
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard" },
        {
          id: "priority",
          label: "Fast",
          description: "Lower latency responses.",
        },
        {
          id: "flex",
          label: "Flex",
          description: "Lower-cost asynchronous routing.",
          isDefault: true,
        },
      ],
      currentValue: "flex",
    },
  ]);
});

it("uses standard routing when the catalog has no default service tier", () => {
  const capabilities = mapCodexModelCapabilities({
    additionalSpeedTiers: ["fast"],
    defaultReasoningEffort: "medium",
    defaultServiceTier: null,
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "1.5x speed, increased usage",
      },
      {
        id: "ultrafast",
        name: "Ultrafast",
        description: "The fastest available responses for latency-sensitive work.",
      },
    ],
    supportedReasoningEfforts: [],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard", isDefault: true },
        {
          id: "priority",
          label: "Fast",
          description: "1.5x speed, increased usage",
        },
        {
          id: "ultrafast",
          label: "Ultrafast",
          description: "Even faster, more expensive",
        },
      ],
      currentValue: "default",
    },
  ]);
});

it("uses configured native model over the catalog recommendation", () => {
  const models = applyNativeCodexDefaultModel(
    [
      { slug: "catalog", name: "Catalog", isCustom: false, isDefault: true, capabilities: null },
      { slug: "configured", name: "Configured", isCustom: false, capabilities: null },
    ],
    "configured",
  );
  assert.deepStrictEqual(
    models.filter((m) => m.isDefault).map((m) => m.slug),
    ["configured"],
  );
});
it("preserves a configured model absent from discovery", () => {
  const models = applyNativeCodexDefaultModel([], "provider/model-x");
  assert.equal(models[0]?.slug, "provider/model-x");
  assert.equal(models[0]?.isDefault, true);
});
it("uses a native catalog default only when configuration is unset", () => {
  const models = applyNativeCodexDefaultModel([
    { slug: "native", name: "Native", isDefault: true, isCustom: false, capabilities: null },
  ]);
  assert.equal(models.find((m) => m.isDefault)?.slug, "native");
  assert.equal(
    applyNativeCodexDefaultModel([
      { slug: "first", name: "First", isCustom: false, capabilities: null },
    ]).some((m) => m.isDefault),
    false,
  );
});

const decodeCodexSettings = Schema.decodeSync(CodexSettings);
const decodeRequest = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
      method: Schema.String,
    }),
  ),
);
const account = {
  account: { type: "chatgpt", email: "test@example.com", planType: "pro" },
  requiresOpenaiAuth: false,
} as const;

it.live("retains subprocess diagnostics and exit code in the provider probe failure", () =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const fs = yield* FileSystem.FileSystem;
    const homePath = yield* fs.makeTempDirectoryScoped();
    const diagnostic = "Invalid project config: unknown field in config.toml";
    const substitute = ChildProcessSpawner.make(() =>
      spawner.spawn(
        ChildProcess.make(
          process.execPath,
          [
            "-e",
            `process.stdin.once('data', () => process.stderr.write(${JSON.stringify(`${diagnostic}\nBearer fake-private-value\n`)}, () => process.exit(1)));`,
          ],
          { env: {}, extendEnv: false },
        ),
      ),
    );
    const provider = yield* checkCodexProviderStatus(
      decodeCodexSettings({ binaryPath: "codex-stderr-test", homePath }),
    ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, substitute));

    assert.equal(provider.status, "error");
    assert.equal(provider.auth.status, "unknown");
    assert.equal(
      provider.message,
      `Codex app-server provider probe failed: Codex App Server process exited with code 1\n${diagnostic}\nBearer [REDACTED].`,
    );
    assert.notInclude(JSON.stringify(provider), "fake-private-value");
  }).pipe(Effect.provide(NodeServices.layer)),
);

const startProbe = Effect.fn("startProbe")(function* (hang: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem;
  const homePath = yield* fs.makeTempDirectoryScoped();
  yield* fs.writeFileString(
    `${homePath}/models_cache.json`,
    JSON.stringify({ fetched_at: DateTime.formatIso(yield* DateTime.now) }),
  );
  const output = yield* Queue.unbounded<Uint8Array>();
  const requests = new Map(
    yield* Effect.forEach(
      ["account/read", "skills/list", "model/list/1", "model/list/2", "account/rateLimits/read"],
      (method) =>
        Deferred.make<string | number>().pipe(Effect.map((signal) => [method, signal] as const)),
    ),
  );
  const stopped = yield* Deferred.make<void>();
  const reply = (id: string | number, result: unknown) =>
    Queue.offer(output, new TextEncoder().encode(`${JSON.stringify({ id, result })}\n`));
  let modelRequests = 0;
  const spawner = ChildProcessSpawner.make(() =>
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Deferred.succeed(stopped, undefined));
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Deferred.await(stopped).pipe(Effect.as(ChildProcessSpawner.ExitCode(0))),
        isRunning: Deferred.isDone(stopped).pipe(Effect.map((done) => !done)),
        kill: () => Deferred.succeed(stopped, undefined).pipe(Effect.asVoid),
        unref: Effect.succeed(Effect.void),
        stdin: Sink.forEach((bytes: Uint8Array) =>
          Effect.forEach(
            new TextDecoder().decode(bytes).split("\n").filter(Boolean),
            (line) =>
              Effect.gen(function* () {
                const { id, method } = decodeRequest(line);
                if (id === undefined) return;
                const request = method === "model/list" ? `${method}/${++modelRequests}` : method;
                const signal = requests.get(request);
                if (signal) yield* Deferred.succeed(signal, id);
                if (hang.includes(request) || method === "account/read") return;
                if (method === "initialize") {
                  yield* reply(id, {
                    userAgent: "codex/0.163.0",
                    codexHome: homePath,
                    platformFamily: "unix",
                    platformOs: "linux",
                  });
                } else if (method === "model/list") {
                  yield* reply(id, {
                    data: [
                      {
                        id: "gpt-test",
                        model: "gpt-test",
                        displayName: "Test",
                        description: "",
                        hidden: false,
                        isDefault: true,
                        defaultReasoningEffort: "high",
                        supportedReasoningEfforts: [],
                      },
                    ],
                    nextCursor: null,
                  });
                } else if (method === "skills/list") {
                  yield* reply(id, { data: [] });
                } else if (method === "account/rateLimits/read") {
                  yield* reply(id, {
                    rateLimits: { primary: null, secondary: null, credits: null, planType: "pro" },
                  });
                } else if (method === "config/read") {
                  yield* reply(id, { config: {}, origins: {}, layers: null });
                }
              }),
            { discard: true },
          ),
        ),
        stdout: Stream.fromQueue(output),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      });
    }),
  );
  const fiber = yield* checkCodexProviderStatus(
    decodeCodexSettings({ homePath, customModels: [{ slug: "custom-model" }] }),
  ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner), Effect.forkChild);
  const requested = (method: string) => Deferred.await(requests.get(method)!);
  return {
    fiber,
    requested,
    authenticate: requested("account/read").pipe(Effect.flatMap((id) => reply(id, account))),
    finishSkills: requested("skills/list").pipe(Effect.flatMap((id) => reply(id, { data: [] }))),
    stopped,
  };
});

it.layer(NodeServices.layer)("Codex probe budget", (it) => {
  it.effect("keeps the first complete catalog when its refresh never answers", () =>
    Effect.gen(function* () {
      const probe = yield* startProbe(["model/list/2"]);
      yield* probe.authenticate;
      yield* probe.requested("model/list/2");
      yield* TestClock.adjust("20 seconds");
      const provider = yield* Fiber.join(probe.fiber);
      assert.strictEqual(provider.status, "ready");
      assert.strictEqual(provider.auth.status, "authenticated");
      assert.deepStrictEqual(
        provider.models.map((model) => model.slug),
        ["gpt-test", "custom-model"],
      );
    }).pipe(Effect.scoped),
  );

  it.effect("warns with authentication and custom models when no catalog arrives", () =>
    Effect.gen(function* () {
      const probe = yield* startProbe(["model/list/1"]);
      yield* probe.authenticate;
      yield* probe.requested("model/list/1");
      yield* TestClock.adjust("20 seconds");
      const provider = yield* Fiber.join(probe.fiber);
      assert.strictEqual(provider.status, "warning");
      assert.strictEqual(provider.auth.status, "authenticated");
      assert.strictEqual(provider.message, "Codex did not return its model catalog in time.");
      assert.deepStrictEqual(
        provider.models.map((model) => model.slug),
        ["custom-model"],
      );
    }).pipe(Effect.scoped),
  );

  it.effect(
    "starts discovery budgets after account readiness and waits for the skills response",
    () =>
      Effect.gen(function* () {
        const probe = yield* startProbe(["skills/list", "account/rateLimits/read"]);
        yield* probe.requested("account/read");
        yield* TestClock.adjust("20 seconds");
        yield* probe.authenticate;
        yield* probe.requested("skills/list");
        yield* probe.requested("account/rateLimits/read");
        yield* probe.requested("model/list/2");
        yield* TestClock.adjust("3 seconds");
        assert.isFalse(yield* Deferred.isDone(probe.stopped));
        yield* probe.finishSkills;
        const provider = yield* Fiber.join(probe.fiber);
        assert.strictEqual(provider.status, "ready");
        assert.strictEqual(provider.auth.status, "authenticated");
        assert.deepStrictEqual(
          provider.models.map((model) => model.slug),
          ["gpt-test", "custom-model"],
        );
        assert.deepStrictEqual(provider.skills, []);
        assert.strictEqual(provider.usageLimits?.unavailable?.reason, "probeFailed");
      }).pipe(Effect.scoped),
  );

  it.effect("retains a completed probe when cleanup exceeds the work budget", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const complete = yield* Deferred.make<void>();
      const cleanupStarted = yield* Deferred.make<void>();
      const cleanupFinished = yield* Deferred.make<void>();
      const fiber = yield* checkCodexProviderStatus(decodeCodexSettings({}), () =>
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Deferred.succeed(cleanupStarted, undefined).pipe(
              Effect.andThen(Deferred.await(cleanupFinished)),
            ),
          );
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(complete);
          return { account, version: undefined, models: [], skills: [] };
        }),
      ).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* TestClock.adjust(18_500);
      yield* Deferred.succeed(complete, undefined);
      yield* Deferred.await(cleanupStarted);
      yield* TestClock.adjust("2 seconds");
      yield* Deferred.succeed(cleanupFinished, undefined);
      const provider = yield* Fiber.join(fiber);
      assert.strictEqual(provider.status, "ready");
      assert.strictEqual(provider.auth.status, "authenticated");
    }),
  );

  it.effect(
    "keeps waiting for account readiness beyond the former budget and releases on cancel",
    () =>
      Effect.gen(function* () {
        const probe = yield* startProbe([]);
        yield* probe.requested("account/read");
        yield* TestClock.adjust("20 seconds");
        assert.isFalse(yield* Deferred.isDone(probe.stopped));
        yield* Fiber.interrupt(probe.fiber);
        assert.isTrue(Exit.hasInterrupts(yield* Fiber.await(probe.fiber)));
        yield* Deferred.await(probe.stopped);
      }).pipe(Effect.scoped),
  );
});
