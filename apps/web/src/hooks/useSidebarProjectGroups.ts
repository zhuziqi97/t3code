import { orderItemsByPreferredIds, sortSidebarV2ProjectGroups } from "../components/Sidebar.logic";
import {
  getProjectOrderKey,
  selectProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { useEnvironmentIdentities, usePrimaryEnvironmentId } from "../state/environments";
import { useDelegatedUnderParent, useProjects, useQuietThreadShells } from "../state/entities";
import { legacyProjectCwdPreferenceKey, useUiStateStore } from "../uiStateStore";
import { useClientSettings } from "./useSettings";

export function useSidebarProjectGroups() {
  const projects = useProjects();
  // Activity order lags a running thread's streaming ticks until its next
  // real change; reading every tick re-rendered the whole sidebar with it.
  const threads = useQuietThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const sortOrder = useClientSettings((s) => s.sidebarProjectSortOrder);
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const environments = useEnvironmentIdentities();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const orderedProjects = orderItemsByPreferredIds({
    items: projects.toSorted(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        getProjectOrderKey(left).localeCompare(getProjectOrderKey(right)),
    ),
    preferredIds: projectOrder,
    getId: getProjectOrderKey,
    getPreferenceIds: (project) => [
      getProjectOrderKey(project),
      legacyProjectCwdPreferenceKey(project.workspaceRoot),
    ],
  });
  const labels = new Map(
    environments.map((environment) => [environment.environmentId, environment.label] as const),
  );
  const effectiveSortOrder = projectOrder.length > 0 ? "manual" : sortOrder;
  const unsortedGroups = buildSidebarProjectSnapshots({
    projects: effectiveSortOrder === "manual" ? orderedProjects : projects,
    groupScratchProjects: true,
    settings: groupingSettings,
    primaryEnvironmentId,
    resolveEnvironmentLabel: (environmentId) => labels.get(environmentId) ?? null,
  });
  return sortSidebarV2ProjectGroups(
    unsortedGroups,
    threads,
    effectiveSortOrder,
    delegatedUnderParent,
  );
}
