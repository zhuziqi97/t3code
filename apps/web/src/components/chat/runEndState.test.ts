import { RunId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { runEndState } from "./runEndState";
import type { TimelineLatestRun } from "./MessagesTimeline.logic";

const run = (status: TimelineLatestRun["status"], completedAt: string | null) => ({
  runId: RunId.make("run-1"),
  status,
  startedAt: "2026-10-21T09:00:00.000Z",
  completedAt,
});

it.each([
  ["completed", "ended"],
  ["failed", "failed"],
  ["interrupted", "stopped"],
  ["cancelled", "stopped"],
  ["rolled_back", "rolledBack"],
] as const)("presents %s as %s using the persisted end time", (status, kind) => {
  const completedAt = "2026-10-21T09:04:00.000Z";
  expect(runEndState(run(status, completedAt))).toEqual({ kind, completedAt });
});

it.each([null, "invalid"])("does not invent an end time for %s", (completedAt) => {
  expect(runEndState(run("failed", completedAt))).toEqual({ kind: "failed", completedAt: null });
});

it.each(["running", "waiting", "preparing", "queued", "starting"] as const)(
  "does not present %s as ended even if an old timestamp remains",
  (status) => {
    expect(runEndState(run(status, "2026-10-21T09:04:00.000Z"))).toBeNull();
  },
);
