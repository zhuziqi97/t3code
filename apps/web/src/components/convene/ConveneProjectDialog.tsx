import { useTranslate } from "../../i18n";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useLocation } from "@tanstack/react-router";
import { create } from "zustand";
import { lazy, Suspense } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";
const ConveneProjectPanel = lazy(() =>
  import("./ConveneProjectPanel").then((module) => ({ default: module.ConveneProjectPanel })),
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
  const close = () => useRequests.setState((state) => ({ projects: state.projects.slice(1) }));
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
          <DialogDescription>{t("convene.dialog.description")}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Suspense fallback={<p role="status">{t("convene.dialog.loading")}</p>}>
            <ConveneProjectPanel {...project} />
          </Suspense>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {t("convene.dialog.done")}
          </Button>
          {projects.length > 1 && (
            <Button variant="ghost" onClick={() => useRequests.setState({ projects: [] })}>
              {t("convene.dialog.later")}
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
