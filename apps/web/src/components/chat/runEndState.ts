import type { TimelineLatestRun } from "./MessagesTimeline.logic";

export function runEndState(run: TimelineLatestRun | null) {
  if (!run) return null;
  const kind =
    run.status === "completed"
      ? "ended"
      : run.status === "failed"
        ? "failed"
        : run.status === "cancelled" || run.status === "interrupted"
          ? "stopped"
          : run.status === "rolled_back"
            ? "rolledBack"
            : null;
  if (kind === null) return null;
  return {
    kind,
    completedAt:
      run.completedAt !== null && Number.isFinite(Date.parse(run.completedAt))
        ? run.completedAt
        : null,
  };
}
