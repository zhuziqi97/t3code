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
import type { ComposerPredictionInput, ComposerPredictionResult } from "@t3tools/contracts";
import {
  ComposerPredictionController,
  predictionAcceptsTab,
  predictionShortcutAction,
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
    mode: "auto" as const,
    available: true,
    idle: true,
    sourceActive: false,
    draftRevision: 0,
    draftEmpty: true,
  };
  const pending: Array<{
    response: Promise<ComposerPredictionResult | null>;
    resolve: (value: ComposerPredictionResult | null) => void;
  }> = [];
  const request = vi.fn(
    (_target: { environmentId: EnvironmentId; input: ComposerPredictionInput }) => {
      let resolve!: (result: ComposerPredictionResult | null) => void;
      const response = new Promise<ComposerPredictionResult | null>((done) => {
        resolve = done;
      });
      pending.push({ response, resolve });
      return response;
    },
  );
  let requestNumber = 0;
  const cancel = vi.fn(async () => {});
  const controller = new ComposerPredictionController({
    read: () => context,
    request,
    cancel,
    requestId: () => `request-${++requestNumber}`,
  });
  return {
    controller,
    request,
    cancel,
    change(patch: Partial<PredictionContext>) {
      context = { ...context, ...patch };
    },
    async finish(patch: Partial<ComposerPredictionResult> | null = {}, index = pending.length - 1) {
      const item = pending[index]!;
      item.resolve(
        patch === null
          ? null
          : {
              requestId: `request-${index + 1}`,
              sourceRunId: RunId.make("completed-run"),
              status: "suggestion",
              text: "Add focused tests",
              ...patch,
            },
      );
      await item.response;
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
          intent: "auto",
        },
      }),
    );
    s.controller.requestManual();
    expect(s.request).toHaveBeenCalledTimes(1);
    await s.finish();
    expect(s.controller.getSnapshot()).toEqual({ status: "suggestion", text: "Add focused tests" });
    s.controller.dismiss();
    expect(s.controller.getSnapshot().status).toBe("idle");
    expect(s.controller.requestManual()).toBe(true);
    expect(s.request).toHaveBeenCalledTimes(1);
    expect(s.controller.getSnapshot().status).toBe("suggestion");
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
    { mode: "off" as const },
    { mode: "manual" as const },
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
    { mode: "off" as const },
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
  ] as const)("retains the outcome without accepting or retrying %s", async (status) => {
    const s = setup();
    s.controller.update();
    await s.finish({ status });
    expect(s.controller.getSnapshot()).toEqual({ status, text: null });
    s.controller.update();
    expect(s.request).toHaveBeenCalledTimes(1);
    s.change({ draftRevision: 1 });
    s.controller.update();
    expect(s.controller.getSnapshot().status).toBe("idle");
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
  expect(s.controller.getSnapshot().status).toBe("error");
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
    mode: "auto" as const,
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
    input: {
      threadId: completed.id,
      sourceRunId,
      requestId: "shell-request",
      trigger: "live",
      intent: "auto",
    },
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
    mode: "auto" as const,
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

it.each([
  [{}, true],
  [{ key: "Enter" }, false],
  [{ shiftKey: true }, false],
  [{ altKey: true }, false],
  [{ ctrlKey: true }, false],
  [{ metaKey: true }, false],
  [{ isComposing: true }, false],
  [{ keyCode: 229 }, false],
  [{ defaultPrevented: true }, false],
  [{ focused: false }, false],
  [{ menuActive: true }, false],
  [{ editorEmpty: false }, false],
] as const)("only accepts an unmodified Tab in the focused empty editor: %j", (patch, expected) => {
  expect(
    predictionAcceptsTab({
      key: "Tab",
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      isComposing: false,
      keyCode: 9,
      defaultPrevented: false,
      focused: true,
      menuActive: false,
      editorEmpty: true,
      ...patch,
    }),
  ).toBe(expected);
});

it("requests only on manual intent in manual mode and never in off mode", async () => {
  const s = setup();
  s.change({ mode: "manual" });
  s.controller.update();
  expect(s.request).not.toHaveBeenCalled();
  expect(s.controller.requestManual()).toBe(true);
  expect(s.request).toHaveBeenCalledWith(
    expect.objectContaining({ input: expect.objectContaining({ intent: "manual" }) }),
  );
  s.controller.requestManual();
  expect(s.request).toHaveBeenCalledTimes(1);
  await s.finish();
  s.change({ mode: "off" });
  s.controller.update();
  s.controller.requestManual("pending_input");
  expect(s.controller.getSnapshot().status).toBe("off");
  expect(s.request).toHaveBeenCalledTimes(1);
});
it.each(["empty", "error", "cancelled"] as const)(
  "only explicit manual intent retries %s with a fresh request id",
  async (status) => {
    const s = setup();
    s.controller.update();
    await s.finish({ status });
    s.controller.update();
    expect(s.request).toHaveBeenCalledTimes(1);
    s.controller.dismiss();
    s.controller.requestManual();
    expect(s.request).toHaveBeenCalledTimes(2);
    expect(s.request.mock.calls[1]?.[0].input).toMatchObject({
      requestId: "request-2",
      intent: "manual",
    });
    s.controller.requestManual();
    expect(s.request).toHaveBeenCalledTimes(2);
    await s.finish();
    expect(s.controller.accept()).toBe("Add focused tests");
  },
);
it.each(["disabled", "unsupported", "not_selected", "not_idle", "stale"] as const)(
  "repeats the reason without re-requesting %s",
  async (status) => {
    const s = setup();
    s.controller.update();
    await s.finish({ status, ...(status === "not_idle" ? { reason: "plan_mode" as const } : {}) });
    if (status === "not_idle")
      expect(s.controller.getSnapshot()).toMatchObject({ reason: "plan_mode" });
    s.controller.dismiss();
    s.controller.requestManual();
    expect(s.controller.getSnapshot().status).toBe(status);
    expect(s.request).toHaveBeenCalledTimes(1);
  },
);
it.each([
  null,
  { draftRevision: 1, draftEmpty: false },
  { sourceRunId: RunId.make("replacement-source") },
  { connectionGeneration: 2 },
])("orders explicit retry after cancel ACK and checks ownership again: %j", async (change) => {
  const s = setup();
  let acknowledge!: () => void;
  const cancelAck = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  s.cancel.mockReturnValue(cancelAck);
  s.change({ mode: "manual" });
  s.controller.requestManual();
  s.controller.dismiss();
  s.controller.requestManual();
  s.controller.requestManual();
  expect(s.request).toHaveBeenCalledTimes(1);
  if (change) {
    s.change(change);
    s.controller.update();
  }
  acknowledge();
  await cancelAck;
  expect(s.request).toHaveBeenCalledTimes(change ? 1 : 2);
  if (!change) await s.finish({ text: "Current" }, 1);
  await s.finish({ text: "Late" }, 0);
  expect(s.controller.accept()).toBe(change ? null : "Current");
  expect(s.cancel).toHaveBeenCalledTimes(1);
});

it.each([{ draftRevision: 1 }, { connectionGeneration: 2 }, { sourceRunId: RunId.make("new") }])(
  "invalidates an Esc-hidden candidate when ownership changes: %j",
  async (patch) => {
    const s = setup();
    s.change({ mode: "manual" });
    s.controller.requestManual();
    await s.finish();
    s.controller.dismiss();
    s.change(patch);
    s.controller.update();
    s.controller.requestManual();
    expect(s.controller.getSnapshot().status).toBe("pending");
    expect(s.request).toHaveBeenCalledTimes(2);
  },
);
it.each([
  { isComposing: true },
  { keyCode: 229 },
  { menuActive: true },
  { focused: false },
  { editorEmpty: false },
  { defaultPrevented: true },
  { matched: false },
])("does not consume a prediction shortcut during editing: %j", (patch) => {
  expect(
    predictionShortcutAction({
      matched: true,
      repeat: false,
      isComposing: false,
      keyCode: 13,
      menuActive: false,
      focused: true,
      editorEmpty: true,
      defaultPrevented: false,
      ...patch,
    }),
  ).toBe("pass");
});

it("consumes repeated request keys without starting another action", () => {
  const input = {
    matched: true,
    repeat: false,
    isComposing: false,
    keyCode: 13,
    menuActive: false,
    focused: true,
    editorEmpty: true,
    defaultPrevented: false,
  };
  expect(predictionShortcutAction(input)).toBe("request");
  expect(predictionShortcutAction({ ...input, repeat: true })).toBe("ignore");
});

it.each([
  [{ mode: "off" as const }, "off", undefined, undefined],
  [{ available: false }, "unsupported", undefined, undefined],
  [{ idle: false }, "not_idle", undefined, undefined],
  [
    { available: false, idle: false, unavailableReason: "permission" },
    "unsupported",
    "permission",
    undefined,
  ],
  [{ idle: false, unavailableReason: "plan_mode" }, "not_idle", "plan_mode", undefined],
  [{}, "unsupported", "thread_required", "thread_required"],
  [{}, "not_idle", "pending_input", "pending_input"],
  [{}, "not_idle", "pending_approval", "pending_approval"],
  [{}, "not_idle", "editing_queued_message", "editing_queued_message"],
  [{}, "unsupported", "attached_context", "attached_context"],
] as const)(
  "keeps a local explanation visible without requesting: %j",
  (patch, status, reason, blocked) => {
    const s = setup();
    s.change({ mode: "manual", ...patch });
    s.controller.update();
    expect(s.controller.requestManual(blocked)).toBe(true);
    s.controller.update();
    expect(s.controller.getSnapshot().status).toBe(status);
    expect(s.controller.getSnapshot()).toMatchObject(reason ? { reason } : {});
    expect(s.request).not.toHaveBeenCalled();
  },
);

it("does not dispatch after a failed cancel until an explicit retry gets an ACK", async () => {
  const s = setup();
  let fail!: (error: Error) => void;
  const cancelAck = new Promise<void>((_resolve, reject) => {
    fail = reject;
  });
  s.cancel.mockReturnValueOnce(cancelAck);
  s.change({ mode: "manual" });
  s.controller.requestManual();
  s.controller.dismiss();
  s.controller.requestManual();
  fail(new Error("Cancel did not reach the server"));
  await cancelAck.catch(() => {});
  expect(s.controller.getSnapshot().status).toBe("error");
  expect(s.request).toHaveBeenCalledTimes(1);
  s.controller.requestManual();
  expect(s.cancel).toHaveBeenCalledTimes(2);
  await s.cancel.mock.results[1]!.value;
  expect(s.request).toHaveBeenCalledTimes(2);
  await s.finish();
  expect(s.controller.accept()).toBe("Add focused tests");
});
