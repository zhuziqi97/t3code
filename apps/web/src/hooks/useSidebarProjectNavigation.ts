import { useEffect, useRef } from "react";
import { useLocation } from "@tanstack/react-router";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { selectProjectGroupingSettings } from "../logicalProject";
import { useProjects } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useUiStateStore } from "../uiStateStore";
import { useClientSettings } from "./useSettings";
import { useHandleNewThread } from "./useHandleNewThread";

/** Retained by the layout so Settings does not turn a remount into conversation navigation. */
export function useSidebarProjectNavigation() {
  const { activeThread, activeDraftThread, routeThreadRef, routeDraftId } = useHandleNewThread();
  const pathname = useLocation({ select: (location) => location.pathname });
  const projects = useProjects();
  const settings = useClientSettings(selectProjectGroupingSettings);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const groups = buildSidebarProjectSnapshots({
    projects,
    settings,
    primaryEnvironmentId,
    resolveEnvironmentLabel: () => null,
  });
  const route = routeDraftId
    ? `draft:${routeDraftId}`
    : routeThreadRef
      ? `${routeThreadRef.environmentId}:${routeThreadRef.threadId}`
      : null;
  const current = activeThread ?? activeDraftThread;
  const project = current ? scopeProjectRef(current.environmentId, current.projectId) : null;
  const projectKey = project ? `${project.environmentId}:${project.projectId}` : null;
  const observed = useRef({ route, projectKey, pending: false });
  // oxlint-disable-next-line t3code/react-effect-budget -- Route commits synchronize the external sidebar scope and expanded-project store.
  useEffect(() => {
    if (route === null) {
      // Params can briefly be empty while returning from Settings. Only
      // the actual home page ends the previous conversation navigation.
      if (pathname === "/") observed.current = { route: null, projectKey: null, pending: false };
      return;
    }
    const previous = observed.current;
    const pending =
      previous.pending ||
      previous.route !== route ||
      (previous.projectKey !== null && projectKey !== null && previous.projectKey !== projectKey);
    observed.current = { route, projectKey, pending };
    if (!pending || !project) return;
    const group = groups.find((entry) =>
      entry.memberProjectRefs.some(
        (member) =>
          member.environmentId === project.environmentId && member.projectId === project.projectId,
      ),
    );
    if (!group) return;
    observed.current.pending = false;
    const store = useUiStateStore.getState();
    store.setSidebarProjectScopeKey(group.projectKey);
    store.setProjectExpanded(group.projectKey, true);
  }, [groups, pathname, projectKey, route, project]);
}
