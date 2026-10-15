import { useTranslate } from "../../i18n";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useLocation } from "@tanstack/react-router";
import { create } from "zustand";
import { lazy, Suspense } from "react";
import { Dialog, DialogPopup, DialogHeader, DialogTitle } from "../ui/dialog";
const ConveneProjectSetup = lazy(() =>
  import("./ConveneProjectPanel").then((module) => ({ default: module.ConveneProjectSetup })),
);

type Project = { environmentId: EnvironmentId; projectId: ProjectId };
const useRequests = create<{ projects: ReadonlyArray<Project> }>(() => ({ projects: [] }));
export function openConveneProjectConfiguration(project: Project) {
  useRequests.setState((state) =>
    state.projects.some(
      (item) =>
        item.environmentId === project.environmentId && item.projectId === project.projectId,
    )
      ? state
      : { projects: [...state.projects, project] },
  );
}
export function ConveneProjectDialogHost() {
  const t = useTranslate();
  const projects = useRequests((state) => state.projects);
  const pathname = useLocation({ select: (state) => state.pathname });
  const project = projects[0];
  if (!project || pathname === "/welcome") return null;
  const close = () =>
    useRequests.setState((state) => ({
      projects: state.projects.filter(
        (item) =>
          item.environmentId !== project.environmentId || item.projectId !== project.projectId,
      ),
    }));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup key={`${project.environmentId}:${project.projectId}`}>
        <DialogHeader>
          <DialogTitle>{t("convene.dialog.title")}</DialogTitle>
        </DialogHeader>
        <Suspense
          fallback={
            <p role="status" className="px-6 pb-6">
              {t("convene.dialog.loading")}
            </p>
          }
        >
          <ConveneProjectSetup
            {...project}
            onDone={close}
            onLater={() => useRequests.setState({ projects: [] })}
          />
        </Suspense>
      </DialogPopup>
    </Dialog>
  );
}
