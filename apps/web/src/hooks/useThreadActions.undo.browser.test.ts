import { fakeTimers } from "../../test/render";
import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../test/render";
import { createElement, useLayoutEffect } from "react";

import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { useThreadActions } from "./useThreadActions";
import { threadEnvironment } from "../state/threads";
import { toastManager } from "../components/ui/toast";
import { useThreadUndoNotice } from "./showThreadUndoNotice";
import { changeLanguage } from "../i18n";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";

const commands = vi.hoisted(() => ({
  pin: vi.fn(),
  unpin: vi.fn(),
  archive: vi.fn(),
  unarchive: vi.fn(),
  settle: vi.fn(),
  unsettle: vi.fn(),
  snooze: vi.fn(),
  unsnooze: vi.fn(),
}));
const router = vi.hoisted(() => ({
  navigate: vi.fn(async () => {}),
  state: { matches: [{ params: {} as Record<string, string> }] },
}));
vi.mock("../state/use-atom-query-runner", async (original) => ({
  ...(await original<typeof import("../state/use-atom-query-runner")>()),
  useAtomQueryRunner: () => vi.fn(),
}));
vi.mock("../state/session", async (original) => ({
  ...(await original<typeof import("../state/session")>()),
  readEnvironmentScope: () => true,
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useRouter: () => router,
}));
vi.mock("./useSettings", async (original) => ({
  ...(await original<typeof import("./useSettings")>()),
  useClientSettings: () => false,
}));
vi.mock("./useHandleNewThread", async (original) => ({
  ...(await original<typeof import("./useHandleNewThread")>()),
  useNewThreadHandler: () => vi.fn(),
}));
vi.mock("../composerDraftStore", async (original) => ({
  ...(await original<typeof import("../composerDraftStore")>()),
  useComposerDraftStore: () => vi.fn(),
}));
vi.mock("../terminalUiStateStore", async (original) => ({
  ...(await original<typeof import("../terminalUiStateStore")>()),
  useTerminalUiStateStore: () => vi.fn(),
}));
vi.mock("../uiStateStore", async (original) => ({
  ...(await original<typeof import("../uiStateStore")>()),
  useUiStateStore: () => vi.fn(),
}));
vi.mock("../lib/archivedThreadsState", async (original) => ({
  ...(await original<typeof import("../lib/archivedThreadsState")>()),
  refreshArchivedThreadsForEnvironment: vi.fn(),
}));
const threadShell = vi.hoisted(() => ({
  title: "Thread",
  pinOrderKey: "a0",
  pinnedAt: null as string | null,
  snoozedUntil: null as string | null,
  projectId: "project",
  environmentId: "undo-env",
  session: null,
}));
vi.mock("../state/entities", async (original) => ({
  ...(await original<typeof import("../state/entities")>()),
  readEnvironmentSupportsPinning: () => true,
  readEnvironmentSupportsPinReorder: () => true,
  readEnvironmentSupportsSettlement: () => true,
  readEnvironmentSupportsSnooze: () => true,
  readThreadShell: () => threadShell,
}));
vi.mock("../state/use-atom-command", async (original) => ({
  ...(await original<typeof import("../state/use-atom-command")>()),
  useAtomCommand: (command: unknown) => {
    switch (command) {
      case threadEnvironment.pin:
        return commands.pin;
      case threadEnvironment.unpin:
        return commands.unpin;
      case threadEnvironment.archive:
        return commands.archive;
      case threadEnvironment.unarchive:
        return commands.unarchive;
      case threadEnvironment.settle:
        return commands.settle;
      case threadEnvironment.unsettle:
        return commands.unsettle;
      case threadEnvironment.snooze:
        return commands.snooze;
      case threadEnvironment.unsnooze:
        return commands.unsnooze;
      default:
        return vi.fn();
    }
  },
}));

const target = {
  environmentId: EnvironmentId.make("undo-env"),
  threadId: ThreadId.make("thread"),
};
function currentUndo() {
  const notice = useThreadUndoNotice.getState().notice;
  expect(notice).not.toBeNull();
  return notice!.undo;
}

const hookRenderers: Screen[] = [];
async function renderActions() {
  let result!: ReturnType<typeof useThreadActions>;
  function Harness() {
    const actions = useThreadActions();
    useLayoutEffect(() => {
      result = actions;
    });
    return null;
  }
  await act(async () => {
    const root = renderStack.use(
      await renderTestUi(null, { container: document.createElement("div"), router: false }),
    );
    hookRenderers.push(root);
    await root.rerender(createElement(Harness));
  });
  return result;
}

describe("concurrent thread action Undo", () => {
  it.each([
    ["settleThread", "settle", "unsettle", "Settled"],
    ["snoozeThread", "snooze", "unsnooze", "Snoozed"],
    ["unpinThread", "unpin", "pin", "Unpinned"],
    ["archiveThread", "archive", "unarchive", "Archived"],
  ] as const)(
    "%s retains one undo for concurrent successful requests",
    async (handler, action, inverse, notice) => {
      const actions = useThreadActions();
      const run = () =>
        handler === "snoozeThread"
          ? actions.snoozeThread(target, "2099-01-01T09:00:00.000Z")
          : actions[handler](target);
      await Promise.all([run(), run()]);
      expect(commands[action]).toHaveBeenCalledTimes(2);
      expect(useThreadUndoNotice.getState().notice).toMatchObject({ action: notice, count: 1 });
      await currentUndo()();
      expect(commands[inverse]).toHaveBeenCalledOnce();
    },
  );
});

describe("unpin Undo", () => {
  it("keeps an existing hook action and reports a pending restore in the new language", async () => {
    await using _lifecycle = await setupLifecycle();

    const add = vi.spyOn(toastManager, "add").mockReturnValue("toast");
    const actions = await renderActions();
    await actions.unpinThread(target);
    let finish!: (result: unknown) => void;
    commands.pin.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = currentUndo()();
    await act(async () => changeLanguage("zh"));
    finish(AsyncResult.failure(Cause.fail(new Error("Raw pin diagnostic 原文"))));
    await pending;
    expect(add).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: "撤销取消置顶失败",
        description: "Raw pin diagnostic 原文",
      }),
    );
    expect(commands.pin).toHaveBeenCalledOnce();
    expect(useThreadUndoNotice.getState().notice).toBeNull();
  });
  it("ignores an old notice across hook instances and still restores the latest unpin", async () => {
    await using _lifecycle = await setupLifecycle();

    const sidebar = await renderActions();
    const header = await renderActions();
    await sidebar.unpinThread(target);
    const staleUndo = currentUndo();
    await header.pinThread(target, { orderKey: "a1" });
    await header.unpinThread(target);
    const latestUndo = currentUndo();
    await staleUndo();
    expect(commands.pin).toHaveBeenCalledTimes(1);
    await latestUndo();
    expect(commands.pin).toHaveBeenCalledTimes(2);
    expect(commands.pin).toHaveBeenLastCalledWith({
      environmentId: target.environmentId,
      input: { threadId: target.threadId, orderKey: "a0" },
    });
    await latestUndo();
    expect(commands.pin).toHaveBeenCalledTimes(2);
  });
});

describe("archive Undo", () => {
  it("unarchives and returns to the thread when archiving left it", async () => {
    await using _lifecycle = await setupLifecycle();

    const add = vi.spyOn(toastManager, "add").mockReturnValue("toast");
    router.state.matches[0]!.params = {
      environmentId: target.environmentId,
      threadId: target.threadId,
    };
    const actions = await renderActions();
    await actions.archiveThread(target);
    expect(useThreadUndoNotice.getState().notice).toMatchObject({ action: "Archived", count: 1 });
    expect(add).not.toHaveBeenCalled();
    await currentUndo()();
    expect(commands.unarchive).toHaveBeenCalledExactlyOnceWith({
      environmentId: target.environmentId,
      input: { threadId: target.threadId },
    });
    expect(router.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/$environmentId/$threadId",
        params: { environmentId: target.environmentId, threadId: target.threadId },
      }),
    );
  });

  it("stays put when the archived thread was not open", async () => {
    await using _lifecycle = await setupLifecycle();

    const actions = await renderActions();
    await actions.archiveThread(target);
    await currentUndo()();
    expect(commands.unarchive).toHaveBeenCalledOnce();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("shows no Undo when the archive failed", async () => {
    await using _lifecycle = await setupLifecycle();

    commands.archive.mockResolvedValue({ _tag: "Failure", cause: new Error("nope") });
    await (await renderActions()).archiveThread(target);
    expect(useThreadUndoNotice.getState().notice).toBeNull();
  });
});

describe("settle and snooze Undo", () => {
  it("un-settles from the notice and expires the Undo after a manual un-settle", async () => {
    await using _lifecycle = await setupLifecycle();

    const add = vi.spyOn(toastManager, "add").mockReturnValue("toast");
    const actions = await renderActions();
    await actions.settleThread(target);
    expect(useThreadUndoNotice.getState().notice).toMatchObject({ action: "Settled", count: 1 });
    expect(add).not.toHaveBeenCalled();
    const undo = currentUndo();
    await actions.unsettleThread(target);
    await undo();
    expect(commands.unsettle).toHaveBeenCalledOnce();
  });

  it("re-pins and re-snoozes a thread that settling had cleared", async () => {
    await using _lifecycle = await setupLifecycle();

    const snoozedUntil = "2030-01-01T09:00:00.000Z";
    threadShell.pinnedAt = "2026-01-01T00:00:00.000Z";
    threadShell.snoozedUntil = snoozedUntil;
    const actions = await renderActions();
    await actions.settleThread(target);
    await currentUndo()();
    expect(commands.unsettle).toHaveBeenCalledOnce();
    expect(commands.pin).toHaveBeenCalledExactlyOnceWith({
      environmentId: target.environmentId,
      input: { threadId: target.threadId, orderKey: "a0" },
    });
    expect(commands.snooze).toHaveBeenCalledExactlyOnceWith({
      environmentId: target.environmentId,
      input: { threadId: target.threadId, snoozedUntil },
    });
  });

  it("stops settle restoration if restoring the pin fails", async () => {
    threadShell.pinnedAt = "2026-01-01T00:00:00.000Z";
    threadShell.snoozedUntil = "2030-01-01T09:00:00.000Z";
    commands.pin.mockResolvedValue({ _tag: "Failure", cause: Cause.fail(new Error("Pin failed")) });
    vi.spyOn(toastManager, "add").mockReturnValue("toast");
    await useThreadActions().settleThread(target);
    await currentUndo()();
    expect(commands.unsettle).toHaveBeenCalledOnce();
    expect(commands.pin).toHaveBeenCalledOnce();
    expect(commands.snooze).not.toHaveBeenCalled();
  });

  it("expires an older unpin Undo when the thread is settled", async () => {
    await using _lifecycle = await setupLifecycle();

    const actions = await renderActions();
    await actions.unpinThread(target);
    const staleUnpinUndo = currentUndo();
    await actions.settleThread(target);
    await staleUnpinUndo();
    expect(commands.pin).not.toHaveBeenCalled();
  });

  // regression: #12972 the sidebar undo notice must reverse a snooze
  it("wakes the thread from the snooze notice", async () => {
    await using _lifecycle = await setupLifecycle();

    const add = vi.spyOn(toastManager, "add").mockReturnValue("toast");
    const actions = await renderActions();
    await actions.snoozeThread(target, "2026-10-23T00:01:00.000Z");
    expect(useThreadUndoNotice.getState().notice).toMatchObject({ action: "Snoozed", count: 1 });
    expect(add).not.toHaveBeenCalled();
    await currentUndo()();
    expect(commands.unsnooze).toHaveBeenCalledExactlyOnceWith({
      environmentId: target.environmentId,
      input: { threadId: target.threadId, reason: "user" },
    });
  });
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    await act(() => hookRenderers.splice(0).forEach((renderer) => renderer.unmount()));
    vi.unstubAllGlobals();

    vi.runAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    await changeLanguage("en");
  });

  await changeLanguage("en");

  stack.use(fakeTimers());
  vi.setSystemTime(new Date("2026-10-23T00:00:00.000Z"));
  for (const command of Object.values(commands)) {
    command.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  }
  router.navigate.mockClear();
  router.state.matches[0]!.params = {};
  threadShell.pinnedAt = null;
  threadShell.snoozedUntil = null;

  renderStack = stack.move();
  return renderStack;
}
