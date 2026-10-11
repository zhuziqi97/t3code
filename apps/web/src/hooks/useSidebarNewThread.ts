import { useTranslate } from "../i18n";
import { useAtomValue } from "@effect/atom-react";
import { useCallback, useMemo } from "react";
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
import { useClientSettings, useLegacySidebarEnabled } from "./useSettings";
import { useHandleNewThread } from "./useHandleNewThread";

export function useSidebarNewThread() {
  const t = useTranslate();
  const { activeThread, activeDraftThread, defaultProjectRef, handleNewThread } =
    useHandleNewThread();
  const context = useMemo(
    () => ({
      activeThread: activeThread ?? undefined,
      activeDraftThread,
      defaultProjectRef,
      handleNewThread,
    }),
    [activeThread, activeDraftThread, defaultProjectRef, handleNewThread],
  );
  const projects = useProjects();
  const settings = useClientSettings(selectProjectGroupingSettings);
  const legacy = useLegacySidebarEnabled();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const configs = useAtomValue(environmentServerConfigsAtom);
  const selectedProjectKey = useUiStateStore((state) => state.sidebarProjectScopeKey);
  const resolve = useCallback(
    (catalog: typeof projects, key: string | null) => {
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
      if (legacy) {
        const project = catalog.find(
          (entry) =>
            entry.environmentId === currentProjectRef?.environmentId &&
            entry.id === currentProjectRef.projectId,
        );
        return project && currentProjectRef
          ? { kind: "project" as const, projectRef: currentProjectRef, label: project.title }
          : { kind: "empty" as const };
      }
      return resolveSidebarNewThreadTarget({ groups, selectedProjectKey: key, currentProjectRef });
    },
    [configs, context, legacy, primaryEnvironmentId, settings],
  );
  const target = useMemo(
    () => resolve(projects, selectedProjectKey),
    [projects, resolve, selectedProjectKey],
  );
  const startNewThread = useCallback(async () => {
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
  }, [context, resolve, t]);
  return { target, startNewThread };
}
