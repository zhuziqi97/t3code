import { localizedProjectCloneProgressSummary } from "../lib/projectClonePresentation";
import { i18n, useTranslate } from "../i18n";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { useParams } from "@tanstack/react-router";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  projectCloneDisplayName,
  type EnvironmentId,
  type ProjectCloneSnapshot,
  type ProjectId,
} from "@t3tools/contracts";
import { useEffect, useRef } from "react";
import { msg } from "gt-react";

import { m } from "../i18n/messages";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useRemoveClonedProject } from "../hooks/useRemoveClonedProject";
import { useEnvironments } from "../state/environments";
import {
  isProjectCloneToastSilenced,
  silenceProjectCloneToasts,
  useEnvironmentProjectClones,
  useProjectCloneToastHolds,
} from "../state/projectClones";
import { sourceControlEnvironment } from "../state/sourceControl";
import { useAtomCommand } from "../state/use-atom-command";
import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { toastManager } from "./ui/toast";
import { stackedThreadToast } from "./ui/toastHelpers";

export function ProjectCloneToastCoordinator() {
  const { environments } = useEnvironments();
  return environments.map((environment) => (
    <EnvironmentCloneToasts
      key={environment.environmentId}
      environmentId={environment.environmentId}
    />
  ));
}

interface TrackedToast {
  readonly toastId: ReturnType<typeof toastManager.add>;
  readonly renderedKey: string;
  readonly phase: ProjectCloneSnapshot["phase"];
  readonly startedAt: ProjectCloneSnapshot["startedAt"];
  readonly closed?: true;
}

function renderKey(clone: ProjectCloneSnapshot): string {
  return `${clone.phase}:${clone.stage}:${clone.percent ?? ""}:${clone.detail ?? ""}:${clone.stalled === true}:${clone.error ?? ""}`;
}

async function runCloneAction(
  title: string,
  action: () => Promise<AtomCommandResult<unknown, unknown>>,
) {
  const result = await action();
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        description: thrownErrorMessage(error, m) ?? m(msg("An error occurred.")),
      }),
    );
  }
}

function EnvironmentCloneToasts({ environmentId }: { environmentId: EnvironmentId }) {
  const t = useTranslate();
  const clones = useEnvironmentProjectClones(environmentId);
  const toastHolds = useProjectCloneToastHolds();
  const handleNewThread = useNewThreadHandler();
  const { draftId: routeDraftId } = useParams({ strict: false });
  const cancelClone = useAtomCommand(sourceControlEnvironment.cancelProjectClone, {
    reportFailure: false,
  });
  const retryClone = useAtomCommand(sourceControlEnvironment.retryProjectClone, {
    reportFailure: false,
  });
  const removeClonedProject = useRemoveClonedProject();
  const toasts = useRef(new Map<ProjectId, TrackedToast>());

  const isViewingProjectDraft = (projectId: ProjectId) => {
    if (!routeDraftId) return false;
    const draft = useComposerDraftStore.getState().getDraftSession(routeDraftId as DraftId);
    return draft?.environmentId === environmentId && draft.projectId === projectId;
  };

  const openProject = (projectId: ProjectId) => {
    void handleNewThread(scopeProjectRef(environmentId, projectId));
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens, updates and closes imperative toastManager toasts to match the current project clones
  useEffect(() => {
    const seen = new Set<ProjectId>();
    for (const clone of clones) {
      seen.add(clone.projectId);
      const key = `${i18n.resolvedLanguage}:${renderKey(clone)}`;
      const tracked = toasts.current.get(clone.projectId);
      const sameAttempt = tracked?.startedAt === clone.startedAt;
      const name = projectCloneDisplayName(clone);
      const closeToast = () => {
        const current = toasts.current.get(clone.projectId);
        if (!current) return;
        toastManager.close(current.toastId);
        toasts.current.delete(clone.projectId);
      };
      const ref = { environmentId, projectId: clone.projectId };
      if (isViewingProjectDraft(clone.projectId)) {
        silenceProjectCloneToasts(ref);
        closeToast();
        continue;
      }
      if (
        (isProjectCloneToastSilenced(ref) || toastHolds.has(scopedProjectKey(ref))) &&
        (clone.phase === "running" || clone.phase === "done")
      ) {
        closeToast();
        continue;
      }
      if (sameAttempt && tracked.renderedKey === key) continue;
      if (
        sameAttempt &&
        tracked.closed &&
        (tracked.phase !== "running" || clone.phase !== "failed")
      ) {
        continue;
      }

      const showToast = (options: ReturnType<typeof stackedThreadToast>) => {
        const rendered = { renderedKey: key, phase: clone.phase, startedAt: clone.startedAt };
        if (tracked && !tracked.closed) {
          toastManager.update(tracked.toastId, options);
          toasts.current.set(clone.projectId, { toastId: tracked.toastId, ...rendered });
          return;
        }

        const toastId = toastManager.add({
          ...options,
          // Updates to a closing toast are ignored, even before it has been removed.
          onClose: () => {
            const current = toasts.current.get(clone.projectId);
            if (current?.toastId === toastId) {
              toasts.current.set(clone.projectId, { ...current, closed: true });
            }
          },
        });
        toasts.current.set(clone.projectId, { toastId, ...rendered });
      };

      if (clone.phase === "running") {
        const options = stackedThreadToast({
          type: "loading",
          title: t("project.clone.runningNamed", { name }),
          description: localizedProjectCloneProgressSummary(clone, t),
          timeout: 0,
          actionProps: {
            children: t("common.cancel"),
            onClick: () => {
              void runCloneAction(t("project.clone.cancelFailed"), () =>
                cancelClone({ environmentId, input: { projectId: clone.projectId } }),
              );
            },
          },
          data: { hideCopyButton: true },
        });
        showToast(options);
        continue;
      }

      if (clone.phase === "done") {
        const options = stackedThreadToast({
          type: "success",
          title: t("project.clone.doneNamed", { name }),
          description: clone.destinationPath,
          timeout: 8_000,
          actionProps: {
            children: t("project.clone.open"),
            onClick: () => {
              closeToast();
              openProject(clone.projectId);
            },
          },
          data: { hideCopyButton: true },
        });
        showToast(options);
        continue;
      }

      const cancelled = clone.phase === "cancelled";
      const options = stackedThreadToast({
        type: cancelled ? "info" : "error",
        title: cancelled
          ? t("project.clone.cancelledNamed", { name })
          : t("project.clone.failedNamed", { name }),
        description: cancelled ? clone.destinationPath : (clone.error ?? t("project.clone.failed")),
        timeout: 0,
        actionProps: {
          children: t("common.retry"),
          onClick: () => {
            void runCloneAction(t("project.clone.retryFailed"), () =>
              retryClone({ environmentId, input: { projectId: clone.projectId } }),
            );
          },
        },
        data: {
          ...(cancelled ? { hideCopyButton: true } : {}),
          secondaryActionProps: {
            children: t("project.remove.project"),
            onClick: () => {
              void removeClonedProject({ environmentId, projectId: clone.projectId });
            },
          },
        },
      });
      showToast(options);
    }

    for (const [projectId, tracked] of toasts.current) {
      if (seen.has(projectId)) continue;
      if (tracked.phase !== "done") toastManager.close(tracked.toastId);
      toasts.current.delete(projectId);
    }
  }, [
    cancelClone,
    clones,
    environmentId,
    isViewingProjectDraft,
    openProject,
    removeClonedProject,
    retryClone,
    t,
    toastHolds,
  ]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- closes every tracked clone toast in toastManager when the coordinator unmounts
  useEffect(
    () => () => {
      for (const tracked of toasts.current.values()) toastManager.close(tracked.toastId);
      toasts.current.clear();
    },
    [],
  );

  return null;
}
