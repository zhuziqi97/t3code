import { useTranslate } from "../i18n";
import { useAtomValue } from "@effect/atom-react";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { openCommandPalette } from "../commandPaletteBus";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { selectProjectGroupingSettings } from "../logicalProject";
import { readProjects, useProjects } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { environmentServerConfigsAtom } from "../state/server";
import { useUiStateStore } from "../uiStateStore";
import {
  resolveSidebarNewThreadTarget,
  resolveThreadActionProjectRef,
} from "../lib/chatThreadActions";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useClientSettings } from "./useSettings";
import { useHandleNewThread } from "./useHandleNewThread";

export function useSidebarNewThread() {
  const t = useTranslate();
  const { activeThread, activeDraftThread, defaultProjectRef, handleNewThread } =
    useHandleNewThread();
  const context = {
    activeThread: activeThread ?? undefined,
    activeDraftThread,
    defaultProjectRef,
    handleNewThread,
  };
  const projects = useProjects();
  const settings = useClientSettings(selectProjectGroupingSettings);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const configs = useAtomValue(environmentServerConfigsAtom);
  const selectedProjectKey = useUiStateStore((state) => state.sidebarProjectScopeKey);
  const resolve = (catalog: typeof projects, key: string | null) => {
    const groups = buildSidebarProjectSnapshots({
      projects: catalog,
      settings,
      primaryEnvironmentId,
      resolveEnvironmentLabel: () => null,
    }).filter(
      (group) =>
        group.projectKey === key ||
        !group.memberProjects.every((project) =>
          isScratchProject(project, configs.get(project.environmentId)?.scratchWorkspaceRoot),
        ),
    );
    const currentProjectRef = resolveThreadActionProjectRef(context);
    return resolveSidebarNewThreadTarget({ groups, selectedProjectKey: key, currentProjectRef });
  };
  const target = resolve(projects, selectedProjectKey);
  const startNewThread = async () => {
    const currentTarget = resolve(
      readProjects(),
      useUiStateStore.getState().sidebarProjectScopeKey,
    );
    if (currentTarget.kind !== "project") {
      openCommandPalette({
        open: currentTarget.kind === "empty" ? "add-project" : "new-thread-in",
      });
      return;
    }
    try {
      await context.handleNewThread(currentTarget.projectRef);
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: t("thread.create.failed"),
          description: error instanceof Error ? error.message : t("common.error"),
        }),
      );
    }
  };
  return { target, startNewThread };
}
