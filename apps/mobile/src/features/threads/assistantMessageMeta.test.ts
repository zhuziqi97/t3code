import { describe, expect, it } from "vite-plus/test";
import { RunId } from "@t3tools/contracts";
import { presentPendingBackgroundWork } from "@t3tools/client-runtime/state/thread-execution";
import { assistantMessageShowsMeta, mobileRunEndFeedback } from "./assistantMessageMeta";

const runId = RunId.make("completed-run");
const completed = {
  latestRun: {
    runId,
    status: "completed" as const,
    startedAt: null,
    completedAt: "2026-10-23T00:00:00Z",
  },
  runlessWorkActive: false,
  activeWorkStartedAt: null,
};

describe("mobile end feedback", () => {
  it.each(["monitor", "subagent"] as const)(
    "waits for pending %s even when the runtime is idle",
    (kind) => {
      const pending = presentPendingBackgroundWork([{ kind, taskId: "pending-work" }]);
      expect(
        mobileRunEndFeedback({ ...completed, completionHeld: pending?.waiting ?? false }),
      ).toBeNull();
      expect(mobileRunEndFeedback({ ...completed, completionHeld: false })?.kind).toBe("ended");
    },
  );

  it("keeps non-blocking commands from holding a completed reply", () => {
    const pending = presentPendingBackgroundWork([
      { kind: "command", taskId: "background-command" },
    ]);
    expect(
      mobileRunEndFeedback({ ...completed, completionHeld: pending?.waiting ?? false })?.kind,
    ).toBe("ended");
  });

  it("uses the same visible meta predicate for the status owner and the assistant row", () => {
    const input = {
      message: { role: "assistant" as const, runId, streaming: false, attachments: [] },
      terminal: true,
      unsettledTurnId: null,
      renderedText: "Final reply",
    };
    expect(assistantMessageShowsMeta(input)).toBe(true);
    expect(assistantMessageShowsMeta({ ...input, renderedText: " \n " })).toBe(false);
    expect(assistantMessageShowsMeta({ ...input, unsettledTurnId: runId })).toBe(false);
    expect(
      assistantMessageShowsMeta({ ...input, message: { ...input.message, streaming: true } }),
    ).toBe(false);
  });
});
