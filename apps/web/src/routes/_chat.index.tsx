import { RefreshIcon } from "~/components/ui/refresh-icon";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { isElectron } from "../env";
import { NoProjectsHero } from "../components/NoProjectsHero";
import { useSidebarNewThread } from "../hooks/useSidebarNewThread";
import { openCommandPalette } from "../commandPaletteBus";
import { useScratchProject } from "../hooks/useScratchProject";
import { usePrimaryEnvironmentId } from "../state/environments";
import { Button } from "../components/ui/button";
import { HostedEmptyState } from "../components/HostedEmptyState";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { readProject, useAllEnvironmentShellsBootstrapped, useProjects } from "../state/entities";
import { useEnvironments } from "../state/environments";

function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const { environments, isReady } = useEnvironments();

  if (authGateState.status === "hosted-static") {
    if (!isReady) return null;
    if (environments.length === 0) return <HostedEmptyState />;
  }

  return <IndexDraftLanding />;
}

function IndexDraftLanding() {
  const projects = useProjects();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const handleNewThread = useNewThreadHandler();
  const { target } = useSidebarNewThread();
  const { scratchEnvironmentId, startScratchThread } = useScratchProject();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const scratchTarget = scratchEnvironmentId(primaryEnvironmentId);
  const router = useRouter();
  // Read at effect time: this page stays mounted while a navigation away from
  // "/" is still loading, but the router already points at the new location.
  const isStillOnIndex = useEffectEvent(() => router.state.location.pathname === "/");
  const startedAttemptRef = useRef<number | null>(null);
  const [startState, setStartState] = useState({ failed: false, retryRequest: 0 });

  const attempt = startState.retryRequest;
  const targetProject = (() => {
    if (!bootstrapped) return null;
    const explicit = projects.find((project) => project.id === window.__T3_INITIAL_PROJECT_ID__);
    if (explicit) return explicit;
    if (target.kind !== "project") return null;
    return (
      projects.find(
        (project) =>
          project.environmentId === target.projectRef.environmentId &&
          project.id === target.projectRef.projectId,
      ) ?? null
    );
  })();

  useEffect(() => {
    // Starting a draft after the user has left would replace the page they picked.
    if (targetProject === null || startedAttemptRef.current === attempt || !isStillOnIndex()) {
      return;
    }
    const projectRef = scopeProjectRef(targetProject.environmentId, targetProject.id);
    // A project removed since this render is gone from the store; the next
    // render picks another one.
    if (readProject(projectRef) === null) {
      return;
    }
    startedAttemptRef.current = attempt;
    void handleNewThread(projectRef, { replace: true })
      .then((opened) => {
        if (opened === null) {
          setStartState((state) => ({ ...state, retryRequest: state.retryRequest + 1 }));
        }
      })
      .catch(() => {
        setStartState((state) => ({ ...state, failed: true }));
      });
  }, [handleNewThread, targetProject, attempt]);

  if (!bootstrapped) {
    return null;
  }
  if (targetProject !== null) {
    return startState.failed ? (
      <DraftStartError
        onRetry={() => {
          setStartState((state) => ({
            failed: false,
            retryRequest: state.retryRequest + 1,
          }));
        }}
      />
    ) : null;
  }
  if (target.kind === "picker") {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
        {isElectron ? <WorkspacePageHeader electron /> : null}
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle>Choose a project to start</EmptyTitle>
            <EmptyDescription>
              Select a project in the sidebar or choose where to start a new thread.
            </EmptyDescription>
            <Button onClick={() => openCommandPalette({ open: "new-thread-in" })}>
              New thread…
            </Button>
            {scratchTarget !== null && (
              <Button variant="ghost" onClick={() => void startScratchThread(scratchTarget)}>
                Start without a project
              </Button>
            )}
          </EmptyHeader>
        </Empty>
      </SidebarInset>
    );
  }
  // First-run routing to the welcome wizard happens in FirstRunGate at the
  // root, before this route ever renders.
  return <NoProjectsHero />;
}

function DraftStartError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      {isElectron ? <WorkspacePageHeader electron /> : null}
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyTitle>Couldn’t start a new thread</EmptyTitle>
          <EmptyDescription>
            The project is still available. Try opening the draft again.
          </EmptyDescription>
          <div className="mt-5 flex justify-center">
            <Button size="sm" onClick={onRetry}>
              <RefreshIcon size="md" />
              Try again
            </Button>
          </div>
        </EmptyHeader>
      </Empty>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
