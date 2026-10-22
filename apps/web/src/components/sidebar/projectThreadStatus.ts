import { resolveSidebarThreadStatus, resolveThreadStatusPill } from "../Sidebar.logic";
import type { ThreadStatusPill } from "../Sidebar.logic";

type Input = Parameters<typeof resolveThreadStatusPill>[0]["thread"];
export type ProjectThreadStatus = Omit<ThreadStatusPill, "label"> & {
  label: ThreadStatusPill["label"] | "Stopped" | "Rolled back" | "Limited";
};

const priority: Record<ProjectThreadStatus["label"], number> = {
  "Pending Approval": 5,
  "Awaiting Input": 4,
  Failed: 3.5,
  Limited: 3.5,
  Working: 3,
  Connecting: 3,
  Waiting: 2.5,
  "Plan Ready": 2,
  Completed: 1,
  Stopped: 1,
  "Rolled back": 1,
};

export function resolveProjectThreadStatus(thread: Input): ProjectThreadStatus | null {
  const state = resolveSidebarThreadStatus({
    ...thread,
    blockedOnThreadWait: thread.blockedOnThreadWait ?? false,
  });
  if (state === "limited") {
    return {
      label: "Limited",
      colorClass: "text-warning-foreground",
      dotClass: "bg-warning",
      pulse: false,
    };
  }
  const status = resolveThreadStatusPill({ thread });
  if (status?.label === "Completed" && thread.latestRun?.status !== "completed") {
    return {
      label: thread.latestRun?.status === "rolled_back" ? "Rolled back" : "Stopped",
      colorClass: "text-sidebar-muted-foreground",
      dotClass: "bg-sidebar-muted-foreground",
      pulse: false,
    };
  }
  if (status) return status;
  if (state === "failed" || thread.latestRun?.status === "failed") {
    return {
      label: "Failed",
      colorClass: "text-red-600 dark:text-red-300/90",
      dotClass: "bg-red-500 dark:bg-red-300/90",
      pulse: false,
    };
  }
  if (state === "waiting") {
    return {
      label: "Waiting",
      colorClass: "text-sidebar-muted-foreground",
      dotClass: "bg-sidebar-muted-foreground",
      pulse: false,
    };
  }
  return null;
}

export function highestProjectThreadStatus(statuses: readonly (ProjectThreadStatus | null)[]) {
  let result: ProjectThreadStatus | null = null;
  for (const status of statuses) {
    if (status && (!result || priority[status.label] > priority[result.label])) result = status;
  }
  return result;
}
