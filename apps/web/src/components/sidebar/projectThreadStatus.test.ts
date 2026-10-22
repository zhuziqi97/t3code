import { describe, expect, it } from "vite-plus/test";
import { RunId } from "@t3tools/contracts";
import { highestProjectThreadStatus, resolveProjectThreadStatus } from "./projectThreadStatus";

type Input = Parameters<typeof resolveProjectThreadStatus>[0];
const readAt = "2026-10-22T01:00:00Z";
const completedAt = "2026-10-22T02:00:00Z";
function thread(patch: Partial<Input> = {}): Input {
  return {
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    pendingSubagentRequest: null,
    interactionMode: "default",
    runtime: null,
    latestRun: null,
    lastVisitedAt: readAt,
    ...patch,
  };
}
function ended(status: NonNullable<Input["latestRun"]>["status"]): Input {
  return thread({
    latestRun: {
      runId: RunId.make("status-run"),
      status,
      completedAt,
      requestedAt: readAt,
      startedAt: readAt,
      assistantMessageId: null,
    },
  });
}

describe("project sidebar status", () => {
  it("keeps a successful completion green until that thread is read", () => {
    const source = ended("completed");
    expect(resolveProjectThreadStatus(source)).toMatchObject({
      label: "Completed",
      dotClass: expect.stringContaining("emerald"),
    });
    expect(resolveProjectThreadStatus({ ...source, lastVisitedAt: completedAt })).toBeNull();
  });
  it.each(["cancelled", "interrupted", "rolled_back"] as const)(
    "does not mark %s as successful",
    (status) => {
      expect(resolveProjectThreadStatus(ended(status))).toMatchObject({
        label: status === "rolled_back" ? "Rolled back" : "Stopped",
        dotClass: "bg-sidebar-muted-foreground",
      });
    },
  );
  it("keeps failures red and an active run blue", () => {
    expect(resolveProjectThreadStatus(ended("failed"))).toMatchObject({
      label: "Failed",
      dotClass: expect.stringContaining("red"),
    });
    const runtime = { status: "running" } as NonNullable<Input["runtime"]>;
    expect(resolveProjectThreadStatus(thread({ runtime }))).toMatchObject({
      label: "Working",
      dotClass: expect.stringContaining("sky"),
    });
  });
  it("keeps approval and input distinct from completion, including the project summary", () => {
    const done = resolveProjectThreadStatus(ended("completed"));
    const approval = resolveProjectThreadStatus(thread({ pendingSubagentRequest: "approval" }));
    const input = resolveProjectThreadStatus(thread({ hasPendingUserInput: true }));
    expect(highestProjectThreadStatus([done, input, approval])).toMatchObject({
      label: "Pending Approval",
    });
    expect(highestProjectThreadStatus([done, input])).toMatchObject({ label: "Awaiting Input" });
  });
});
