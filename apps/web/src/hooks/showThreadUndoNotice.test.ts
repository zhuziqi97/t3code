import * as Cause from "effect/Cause";
import { undoLatestThreadAction } from "./showThreadUndoNotice";
import { AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { toastManager } from "../components/ui/toast";
import { changeLanguage, i18n } from "../i18n";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { announce, cancelAnnouncement } from "../lib/announce";
import {
  releaseThreadUndoShortcut,
  showThreadUndoNotice,
  threadUndoClaimsShortcut,
  useThreadUndoNotice,
} from "./showThreadUndoNotice";
import * as ThreadUndo from "@t3tools/client-runtime/state/thread-undo";

vi.mock("../lib/announce", () => ({ announce: vi.fn(), cancelAnnouncement: vi.fn() }));

beforeEach(async () => {
  await changeLanguage("en");
  vi.useFakeTimers();
});
afterEach(async () => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  await changeLanguage("en");
});

function setup() {
  const add = vi.spyOn(toastManager, "add").mockReturnValue("error-toast");
  const undo = vi.fn(async () => AsyncResult.success(undefined));
  const claim = ThreadUndo.begin("pin", "env/thread");
  const options = {
    action: "Unpinned" as const,
    failureTitle: () => "Restore failed",
    undo,
    claim,
  };
  return { add, undo, claim, options };
}

function notice() {
  const value = useThreadUndoNotice.getState().notice;
  if (!value) throw new Error("Undo notice is missing");
  return value;
}

describe("thread undo notice", () => {
  it.each(["failure", "rejection"] as const)(
    "uses the completion language for a pending undo %s and preserves diagnostics",
    async (mode) => {
      const { add, options, claim } = setup();
      let finish!: (result: AtomCommandResult<void, Error>) => void;
      let reject!: (error: Error) => void;
      const undo = vi.fn(
        () =>
          new Promise<AtomCommandResult<void, Error>>((resolve, fail) => {
            finish = resolve;
            reject = fail;
          }),
      );
      const failureTitle = vi.fn(() => i18n.t("thread.action.undoUnpinFailed"));
      showThreadUndoNotice({ ...options, undo, failureTitle });
      const pending = notice().undo();
      expect(undo).toHaveBeenCalledOnce();
      expect(failureTitle).not.toHaveBeenCalled();
      await changeLanguage("zh");
      const diagnostic = new Error("Network /tmp/原文 404");
      if (mode === "failure") finish(AsyncResult.failure(Cause.fail(diagnostic)));
      else reject(diagnostic);
      await pending;
      expect(add).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: "error",
          title: "撤销取消置顶失败",
          description: diagnostic.message,
        }),
      );
      expect(failureTitle).toHaveBeenCalledOnce();
      expect(claim.isCurrent()).toBe(false);
      expect(undoLatestThreadAction()).toBe(false);
    },
  );
  it("aggregates consecutive actions without success toasts and restores the group once", async () => {
    const { add, undo, options } = setup();
    showThreadUndoNotice({
      ...options,
      action: "Settled",
      claim: ThreadUndo.begin("settle", "env/a"),
    });
    showThreadUndoNotice({
      ...options,
      action: "Settled",
      claim: ThreadUndo.begin("settle", "env/b"),
    });
    expect(notice()).toMatchObject({ action: "Settled", count: 2 });
    expect(add).not.toHaveBeenCalled();
    const group = notice();
    await group.undo();
    await group.undo();
    expect(undo).toHaveBeenCalledTimes(2);
    expect(undoLatestThreadAction()).toBe(false);
  });

  it("drops invalidated claims immediately and rejects a captured stale undo", async () => {
    const { undo, options } = setup();
    showThreadUndoNotice(options);
    const stale = notice();
    ThreadUndo.invalidate("pin", "env/thread");
    expect(useThreadUndoNotice.getState().notice).toBeNull();
    showThreadUndoNotice({ ...options, claim: ThreadUndo.begin("pin", "env/thread") });
    await stale.undo();
    expect(undo).not.toHaveBeenCalled();
    await notice().undo();
    expect(undo).toHaveBeenCalledOnce();
  });

  it("claims mod+z from text fields until the user types, then again for a new notice", () => {
    const { options } = setup();
    expect(threadUndoClaimsShortcut()).toBe(false);
    showThreadUndoNotice(options);
    expect(threadUndoClaimsShortcut()).toBe(true);
    releaseThreadUndoShortcut();
    expect(threadUndoClaimsShortcut()).toBe(false);
    showThreadUndoNotice({ ...options, claim: ThreadUndo.begin("pin", "env/next") });
    expect(threadUndoClaimsShortcut()).toBe(true);
  });

  it("stops claiming mod+z once nothing is left to undo", async () => {
    const { options } = setup();
    showThreadUndoNotice(options);
    await notice().undo();
    expect(threadUndoClaimsShortcut()).toBe(false);
    showThreadUndoNotice({ ...options, claim: ThreadUndo.begin("pin", "env/expiring") });
    vi.advanceTimersByTime(5_000);
    expect(threadUndoClaimsShortcut()).toBe(false);
  });

  it("announces each new summary once, and cancels it when the notice clears", async () => {
    const { options } = setup();
    vi.mocked(announce).mockClear();
    vi.mocked(cancelAnnouncement).mockClear();
    showThreadUndoNotice(options);
    expect(announce).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/^Unpinned 1 thread, /),
      "thread-undo-notice",
    );
    ThreadUndo.invalidate("pin", "env/other");
    expect(announce).toHaveBeenCalledOnce();
    showThreadUndoNotice({ ...options, claim: ThreadUndo.begin("pin", "env/second") });
    expect(announce).toHaveBeenLastCalledWith(
      expect.stringMatching(/^Unpinned 2 threads, /),
      "thread-undo-notice",
    );
    await notice().undo();
    expect(cancelAnnouncement).toHaveBeenCalledWith("thread-undo-notice");
  });
});
