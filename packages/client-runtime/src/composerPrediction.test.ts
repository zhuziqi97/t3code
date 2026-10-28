import { presentThreadShell } from "./state/models.ts";
import { v2ThreadShell } from "./state/orchestrationV2TestFixtures.ts";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProviderInstanceId,
  RunId,
  ProviderThreadId,
  ThreadId,
} from "@t3tools/contracts";
import type { ComposerPredictionResult } from "@t3tools/contracts";
import {
  ComposerPredictionController,
  threadPredictionContext,
  type PredictionContext,
} from "./composerPrediction.ts";

function setup() {
  let context: PredictionContext = {
    environmentId: EnvironmentId.make("remote"),
    threadId: ThreadId.make("thread"),
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerThreadId: "native-root",
    connectionGeneration: 1,
    sourceRunId: RunId.make("completed-run"),
    enabled: true,
    available: true,
    idle: true,
    sourceActive: false,
    draftRevision: 0,
    draftEmpty: true,
  };
  let resolve!: (result: ComposerPredictionResult | null) => void;
  const response = new Promise<ComposerPredictionResult | null>((done) => {
    resolve = done;
  });
  const request = vi.fn(() => response);
  const cancel = vi.fn(async () => {});
  const controller = new ComposerPredictionController({
    read: () => context,
    request,
    cancel,
    requestId: () => "request-1",
  });
  return {
    controller,
    request,
    cancel,
    change(patch: Partial<PredictionContext>) {
      context = { ...context, ...patch };
    },
    async finish(patch: Partial<ComposerPredictionResult> | null = {}) {
      resolve(
        patch === null
          ? null
          : {
              requestId: "request-1",
              sourceRunId: RunId.make("completed-run"),
              status: "suggestion",
              text: "Add focused tests",
              ...patch,
            },
      );
      await response;
    },
  };
}

describe("composer predictions", () => {
  it("requests catch-up once and accepts only as draft text", async () => {
    const s = setup();
    s.controller.update();
    expect(s.request).toHaveBeenCalledWith(
      expect.objectContaining({
        environmentId: "remote",
        input: {
          threadId: "thread",
          sourceRunId: "completed-run",
          requestId: "request-1",
          trigger: "catch_up",
        },
      }),
    );
    await s.finish();
    expect(s.controller.getSnapshot()).toEqual({ status: "suggestion", text: "Add focused tests" });
    expect(s.controller.accept()).toBe("Add focused tests");
    expect(s.controller.accept()).toBeNull();
    s.controller.update();
    expect(s.request).toHaveBeenCalledTimes(1);
  });

  it("uses live only after observing a running source finish", () => {
    const s = setup();
    s.change({ idle: false, sourceActive: true });
    s.controller.update();
    s.change({ idle: true, sourceActive: false });
    s.controller.update();
    expect(s.request).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ trigger: "live" }) }),
    );
  });

  it.each([
    { enabled: false },
    { available: false },
    { idle: false },
    { draftEmpty: false },
    { providerThreadId: null },
    { sourceRunId: null },
  ])("does not request when ineligible: %j", (patch) => {
    const s = setup();
    s.change(patch);
    s.controller.update();
    expect(s.request).not.toHaveBeenCalled();
  });

  it.each([
    { environmentId: EnvironmentId.make("other") },
    { threadId: ThreadId.make("other") },
    { providerInstanceId: ProviderInstanceId.make("other") },
    { providerThreadId: "other-native-root" },
    { connectionGeneration: 2 },
    { sourceRunId: RunId.make("new-run") },
    { enabled: false },
    { available: false },
    { idle: false },
    { draftRevision: 2 },
    { draftEmpty: false },
  ])("rejects late results and acceptance after ownership changes: %j", async (patch) => {
    const s = setup();
    s.controller.update();
    s.change(patch);
    await s.finish();
    expect(s.controller.accept()).toBeNull();
    expect(s.controller.getSnapshot().status).toBe("idle");
    expect(s.cancel).toHaveBeenCalledWith({
      environmentId: "remote",
      input: { threadId: "thread", requestId: "request-1" },
    });
  });

  it("invalidates a visible candidate if typing and deleting returns to an empty draft", async () => {
    const s = setup();
    s.controller.update();
    await s.finish();
    s.change({ draftRevision: 2 });
    expect(s.controller.accept()).toBeNull();
  });

  it("dismisses pending work immediately even if native cancel ACK arrives before a result", async () => {
    const s = setup();
    s.controller.update();
    s.controller.dismiss();
    await s.finish();
    expect(s.controller.accept()).toBeNull();
    s.controller.update();
    expect(s.request).toHaveBeenCalledTimes(1);
    expect(s.cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    "empty",
    "disabled",
    "not_selected",
    "unsupported",
    "not_idle",
    "stale",
    "cancelled",
    "error",
  ] as const)("does not present or retry %s", async (status) => {
    const s = setup();
    s.controller.update();
    await s.finish({ status });
    expect(s.controller.accept()).toBeNull();
    s.controller.update();
    expect(s.request).toHaveBeenCalledTimes(1);
  });

  it.each([{ requestId: "other" }, { sourceRunId: RunId.make("other") }, { text: "   " }])(
    "rejects mismatched or empty result: %j",
    async (patch) => {
      const s = setup();
      s.controller.update();
      await s.finish(patch);
      expect(s.controller.accept()).toBeNull();
    },
  );
});

it("does not retry a source after its connection is replaced", async () => {
  const s = setup();
  s.controller.update();
  s.change({ connectionGeneration: 2 });
  s.controller.update();
  await s.finish();
  expect(s.controller.accept()).toBeNull();
  expect(s.request).toHaveBeenCalledTimes(1);
});

it("uses catch-up when an existing completed thread becomes eligible", () => {
  const s = setup();
  s.change({ idle: false });
  s.controller.update();
  s.change({ idle: true });
  s.controller.update();
  expect(s.request).toHaveBeenCalledWith(
    expect.objectContaining({ input: expect.objectContaining({ trigger: "catch_up" }) }),
  );
});

it("settles a permission or transport failure without presenting or retrying", async () => {
  const s = setup();
  s.controller.update();
  await s.finish(null);
  expect(s.controller.getSnapshot().status).toBe("idle");
  expect(s.controller.accept()).toBeNull();
  s.controller.update();
  expect(s.request).toHaveBeenCalledTimes(1);
});

it("observes a completed Codex shell on the destination and rejects a child session", () => {
  const environmentId = EnvironmentId.make("remote-shell");
  const sourceRunId = RunId.make("source-shell");
  const completed = presentThreadShell(environmentId, {
    ...v2ThreadShell,
    latestRunId: sourceRunId,
    activeProviderThreadId: ProviderThreadId.make("root-provider-thread"),
  });
  const options = {
    enabled: true,
    connected: true,
    connectionGeneration: 1,
    permitted: true,
    codex: true,
    selectedInstanceId: completed.providerInstanceId,
    blocked: false,
    draftEmpty: true,
    draftRevision: 0,
  };
  let context = threadPredictionContext(
    {
      ...completed,
      latestRun: completed.latestRun && { ...completed.latestRun, status: "running" },
      runtime: {
        status: "running",
        activeRunId: sourceRunId,
        providerInstanceId: completed.providerInstanceId,
        providerName: "Codex",
        lastError: null,
        updatedAt: completed.updatedAt,
      },
    },
    options,
  );
  const request = vi.fn(async () => null);
  const controller = new ComposerPredictionController({
    read: () => context,
    request,
    cancel: async () => {},
    requestId: () => "shell-request",
  });
  controller.update();
  expect(request).not.toHaveBeenCalled();
  context = threadPredictionContext(completed, options);
  controller.update();
  expect(request).toHaveBeenCalledWith({
    environmentId,
    input: { threadId: completed.id, sourceRunId, requestId: "shell-request", trigger: "live" },
  });
  controller.dismiss();
  context = threadPredictionContext(
    {
      ...completed,
      lineage: {
        ...completed.lineage,
        relationshipToParent: "subagent",
        parentThreadId: ThreadId.make("parent"),
      },
    },
    options,
  );
  expect(context?.available).toBe(false);
  context = threadPredictionContext(completed, { ...options, codex: false });
  expect(context?.available).toBe(false);
  context = threadPredictionContext(completed, {
    ...options,
    selectedInstanceId: ProviderInstanceId.make("other"),
  });
  expect(context?.available).toBe(false);
});

it("keeps a newer source's candidate when a cancelled source finishes late", async () => {
  let context: PredictionContext = {
    environmentId: EnvironmentId.make("remote"),
    threadId: ThreadId.make("thread"),
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerThreadId: "native-root",
    connectionGeneration: 1,
    sourceRunId: RunId.make("old"),
    enabled: true,
    available: true,
    idle: true,
    sourceActive: false,
    draftRevision: 0,
    draftEmpty: true,
  };
  const deferred = () => {
    let resolve!: (value: ComposerPredictionResult) => void;
    const promise = new Promise<ComposerPredictionResult>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  const old = deferred();
  const current = deferred();
  const request = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const cancel = vi.fn(async () => {});
  let requestNumber = 0;
  const controller = new ComposerPredictionController({
    read: () => context,
    request,
    cancel,
    requestId: () => `request-${++requestNumber}`,
  });
  controller.update();
  context = { ...context, sourceRunId: RunId.make("new") };
  controller.update();
  current.resolve({
    requestId: "request-2",
    sourceRunId: RunId.make("new"),
    status: "suggestion",
    text: "Current draft",
  });
  await current.promise;
  old.resolve({
    requestId: "request-1",
    sourceRunId: RunId.make("old"),
    status: "suggestion",
    text: "Stale draft",
  });
  await old.promise;
  expect(controller.accept()).toBe("Current draft");
  expect(request).toHaveBeenCalledTimes(2);
  expect(cancel).toHaveBeenCalledWith({
    environmentId: "remote",
    input: { threadId: "thread", requestId: "request-1" },
  });
});
