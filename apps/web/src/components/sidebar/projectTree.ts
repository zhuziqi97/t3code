import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { legacyProjectCwdPreferenceKey, resolveProjectExpanded } from "../../uiStateStore";
import type { SidebarListItem, SidebarSection } from "../Sidebar.logic";

type TreeThread = Pick<EnvironmentThreadShell, "environmentId" | "id" | "projectId">;

/** Ordinary project-tree threads follow user sends; provider and metadata events never rank them. */
export function sortProjectTreeActiveThreads<
  T extends Pick<
    EnvironmentThreadShell,
    "environmentId" | "id" | "createdAt" | "latestUserMessageAt"
  >,
>(threads: readonly T[]): T[] {
  return threads
    .map((thread) => ({
      thread,
      timestamp: Date.parse(thread.latestUserMessageAt ?? thread.createdAt),
    }))
    .sort((left, right) => {
      const a = Number.isFinite(left.timestamp) ? left.timestamp : Number.NEGATIVE_INFINITY;
      const b = Number.isFinite(right.timestamp) ? right.timestamp : Number.NEGATIVE_INFINITY;
      return (
        (a === b ? 0 : a > b ? -1 : 1) ||
        scopedThreadKey(scopeThreadRef(left.thread.environmentId, left.thread.id)).localeCompare(
          scopedThreadKey(scopeThreadRef(right.thread.environmentId, right.thread.id)),
        )
      );
    })
    .map(({ thread }) => thread);
}

export function projectExpansionKeys(project: SidebarProjectSnapshot): string[] {
  return [
    project.projectKey,
    ...project.memberProjects.map((member) => member.physicalProjectKey),
    ...project.memberProjects.map((member) => legacyProjectCwdPreferenceKey(member.workspaceRoot)),
  ];
}

export function buildProjectTreeList(input: {
  groups: readonly SidebarProjectSnapshot[];
  pageControls?: ReadonlySet<string>;
  expandedById: Readonly<Record<string, boolean>>;
  pinned: readonly TreeThread[];
  active: readonly TreeThread[];
  working: readonly TreeThread[];
  snoozed: readonly TreeThread[];
  settled: readonly TreeThread[];
  workingAll: readonly TreeThread[];
  snoozedAll: readonly TreeThread[];
  settledAll: readonly TreeThread[];
}): readonly SidebarListItem[] {
  const projectKeyByRef = new Map(
    input.groups.flatMap((group) =>
      group.memberProjectRefs.map(
        (ref) => [`${ref.environmentId}:${ref.projectId}`, group.projectKey] as const,
      ),
    ),
  );
  const buckets = (threads: readonly TreeThread[], section: SidebarSection) => {
    const byGroup = new Map<string, SidebarListItem[]>();
    for (const thread of threads) {
      const projectKey = projectKeyByRef.get(`${thread.environmentId}:${thread.projectId}`);
      if (projectKey === undefined) continue;
      const list = byGroup.get(projectKey) ?? [];
      list.push({
        kind: "thread",
        key: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        section,
        projectKey,
      });
      byGroup.set(projectKey, list);
    }
    return byGroup;
  };
  const active = buckets(input.active, "active");
  const working = buckets(input.working, "working");
  const snoozed = buckets(input.snoozed, "snoozed");
  const settled = buckets(input.settled, "settled");
  const workingAll = buckets(input.workingAll, "working");
  const snoozedAll = buckets(input.snoozedAll, "snoozed");
  const settledAll = buckets(input.settledAll, "settled");
  const pinned = input.pinned.map((thread): SidebarListItem => ({
    kind: "thread",
    key: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
    section: "pinned",
    ...(projectKeyByRef.has(`${thread.environmentId}:${thread.projectId}`)
      ? { projectKey: projectKeyByRef.get(`${thread.environmentId}:${thread.projectId}`)! }
      : {}),
  }));
  const items: SidebarListItem[] = [
    { kind: "marker", marker: "pinned-header" },
    ...pinned,
    { kind: "marker", marker: "projects-header" },
  ];
  for (const group of input.groups) {
    const projectKey = group.projectKey;
    items.push({ kind: "marker", marker: "project-header", projectKey });
    if (!resolveProjectExpanded(input.expandedById, projectExpansionKeys(group))) continue;
    items.push({ kind: "marker", marker: "draft-block", projectKey });
    items.push({ kind: "marker", marker: "active-placeholder", projectKey, section: "active" });
    items.push(...(active.get(projectKey) ?? []));
    if (input.pageControls?.has(`active:${projectKey}`)) {
      items.push({ kind: "marker", marker: "active-more", projectKey, section: "active" });
    }
    for (const [section, visible, all] of [
      ["working", working, workingAll],
      ["snoozed", snoozed, snoozedAll],
      ["settled", settled, settledAll],
    ] as const) {
      if (!all.has(projectKey) && section !== "settled") continue;
      // Settled remains a destination even when a project has no finished work.
      items.push({ kind: "marker", marker: `${section}-header`, projectKey, section });
      items.push(...(visible.get(projectKey) ?? []));
      if (input.pageControls?.has(`${section}:${projectKey}`)) {
        items.push({ kind: "marker", marker: `${section}-more`, projectKey, section });
      }
    }
  }
  return items;
}

/** Page each project's history independently and keep a directly opened thread reachable. */
export function visibleProjectShelfThreads<T extends TreeThread>(input: {
  threads: readonly T[];
  projectKeyByRef: ReadonlyMap<string, string>;
  isExpanded: (projectKey: string) => boolean;
  routeThreadKey: string | null;
  limitForProject?: (projectKey: string) => number;
}): T[] {
  const counts = new Map<string, number>();
  return input.threads.filter((thread) => {
    const group = input.projectKeyByRef.get(`${thread.environmentId}:${thread.projectId}`);
    if (group === undefined) return false;
    const current =
      scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === input.routeThreadKey;
    if (!input.isExpanded(group)) return current;
    const count = counts.get(group) ?? 0;
    counts.set(group, count + 1);
    return current || count < (input.limitForProject?.(group) ?? Infinity);
  });
}
