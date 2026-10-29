import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useOlderSettledShelf, useOlderSettledShelfGrowth } from "../../state/olderSettledShelf";
import { ProjectThreadPageControls } from "./ProjectThreadPageControls";
import { createElement, useState } from "react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { visibleProjectShelfThreads } from "./projectTree";

type TreeThread = Pick<EnvironmentThreadShell, "environmentId" | "id" | "projectId">;

export function useProjectThreadPages<T extends TreeThread>(input: {
  threads: readonly T[];
  projectKeyByRef: ReadonlyMap<string, string>;
  routeThreadKey: string | null;
  initialCount: number;
  pageCount?: number;
  isExpanded: (key: string) => boolean;
}) {
  const [limits, setLimits] = useState<Record<string, number>>({});
  const visible = visibleProjectShelfThreads({
    ...input,
    limitForProject: (key) => limits[key] ?? input.initialCount,
  });
  const visibleKeys = new Set(
    visible.map((thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
  );
  const hiddenByProject = new Map<string, T[]>();
  for (const thread of input.threads) {
    const key = input.projectKeyByRef.get(`${thread.environmentId}:${thread.projectId}`);
    if (
      key === undefined ||
      visibleKeys.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)))
    )
      continue;
    const hidden = hiddenByProject.get(key) ?? [];
    hidden.push(thread);
    hiddenByProject.set(key, hidden);
  }
  return {
    visible,
    limitForProject: (key: string) => limits[key] ?? input.initialCount,
    hiddenByProject,
    expandedProjects: new Set(
      Object.keys(limits).filter((key) => limits[key]! > input.initialCount),
    ),
    showMore: (key: string) =>
      setLimits((current) => ({
        ...current,
        [key]: (current[key] ?? input.initialCount) + (input.pageCount ?? input.initialCount),
      })),
    showLess: (key: string) =>
      setLimits((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      }),
  };
}

export function ProjectSettledPageControls(props: {
  project: SidebarProjectSnapshot;
  threads: readonly EnvironmentThreadShell[];
  hiddenThreads: readonly EnvironmentThreadShell[];
  visibleCount: number;
  pageSize: number;
  expanded: boolean;
  onMore: () => void;
  onLess: () => void;
}) {
  const refs = props.project.memberProjectRefs;
  const scopes = [...new Set(refs.map((ref) => ref.environmentId))].map((environmentId) => ({
    environmentId,
    projectIds: refs
      .filter((ref) => ref.environmentId === environmentId)
      .map((ref) => ref.projectId),
  }));
  const shelf = useOlderSettledShelf({ scopes, expanded: true, visibleCount: props.visibleCount });
  const projectThreads = props.threads.filter((thread) =>
    refs.some(
      (ref) => ref.environmentId === thread.environmentId && ref.projectId === thread.projectId,
    ),
  );
  useOlderSettledShelfGrowth(shelf, projectThreads.filter(shelf.isListed));
  return createElement(ProjectThreadPageControls, {
    hiddenThreads: props.hiddenThreads,
    unloadedCount: shelf.unloadedCount(projectThreads),
    loading: shelf.loading,
    failed: shelf.failed,
    pageSize: props.pageSize,
    expanded: props.expanded,
    onMore: () => (shelf.failed ? shelf.retry() : props.onMore()),
    onLess: props.onLess,
  });
}
