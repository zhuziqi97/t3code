import type { TFunction } from "i18next";
import type { SidebarThreadSummary } from "../../types";
import { resolveSidebarThreadStatus, resolveThreadStatusPill } from "../Sidebar.logic";
import type { ThreadStatusPill } from "../Sidebar.logic";

type Input = Parameters<typeof resolveThreadStatusPill>[0]["thread"];
export type ProjectThreadStatus = Omit<ThreadStatusPill, "label"> & {
  label: ThreadStatusPill["label"] | "Stopped" | "Rolled back" | "Limited";
};

const priority: Record<ProjectThreadStatus["label"], number> = {
  "Pending Approval": 5,
  "Awaiting Input": 4,
  "Guest Request": 4,
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

const ROW_STATUS = {
  "Pending Approval": {
    key: "thread.approval",
    icon: "approval",
    className: "text-warning-foreground",
  },
  "Awaiting Input": {
    key: "thread.input",
    icon: "input",
    className: "text-indigo-600 dark:text-indigo-300",
  },
  "Guest Request": { key: "thread.request", icon: "request", className: "text-guest-foreground" },
  Working: { key: "thread.working", icon: "working", className: "text-info-foreground" },
  Connecting: { key: "thread.connecting", icon: "working", className: "text-info-foreground" },
  Waiting: { key: "thread.waiting", icon: "waiting", className: "text-muted-foreground" },
  Failed: { key: "thread.failed", icon: "failed", className: "text-error-foreground" },
  Limited: { key: "thread.limited", icon: "failed", className: "text-warning-foreground" },
  "Plan Ready": {
    key: "thread.planReady",
    icon: "plan",
    className: "text-violet-600 dark:text-violet-300",
  },
  Completed: { key: "thread.done", icon: "done", className: "text-success-foreground" },
  Stopped: { key: "chat.status.stopped", icon: "stopped", className: "text-muted-foreground" },
  "Rolled back": {
    key: "chat.timeline.runRolledBack",
    icon: "stopped",
    className: "text-muted-foreground",
  },
} as const;

export function resolveSidebarThreadRowStatus(
  thread: Input & { readonly goal?: SidebarThreadSummary["goal"] },
  input: { readonly isWoke: boolean },
  t: TFunction,
) {
  const status = resolveProjectThreadStatus(thread);
  if (status) {
    const display = ROW_STATUS[status.label];
    return {
      label: t(
        status.label === "Working" && thread.goal?.status === "active"
          ? "thread.goal"
          : display.key,
      ),
      icon: display.icon,
      className: display.className,
    };
  }
  if (!input.isWoke) return null;
  const completed = thread.latestRun?.status === "completed";
  return {
    label: t(
      thread.latestRun?.status === "cancelled" || thread.latestRun?.status === "interrupted"
        ? "chat.status.stopped"
        : thread.latestRun?.status === "rolled_back"
          ? "chat.timeline.runRolledBack"
          : "chat.timeline.runEnded",
    ),
    icon: completed ? ("done" as const) : ("stopped" as const),
    className: completed ? "text-success" : "text-muted-foreground",
  };
}
