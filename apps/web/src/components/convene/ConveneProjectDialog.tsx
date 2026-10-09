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
          <DialogTitle>Configure project in Convene</DialogTitle>
          <DialogDescription>
            Associate execution modules and configure independent MCP access for this native
            project.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Suspense fallback={<p role="status">Loading Convene configuration…</p>}>
            <ConveneProjectPanel {...project} />
          </Suspense>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Done for now
          </Button>
          {projects.length > 1 && (
            <Button variant="ghost" onClick={() => useRequests.setState({ projects: [] })}>
              Configure remaining projects later
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
