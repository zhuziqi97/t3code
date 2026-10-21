import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  ModelSelection,
  ProjectId,
  ScopedProjectRef,
} from "@t3tools/contracts";
import type { ComposerThreadDraftState, DraftThreadEnvMode } from "../composerDraftStore";

type ComposerModelSelectionState = Pick<
  ComposerThreadDraftState,
  "activeProvider" | "modelSelectionByProvider" | "modelSelectionExplicit"
>;

interface ThreadContextLike {
  environmentId: EnvironmentId;
  projectId: ProjectId;
}

interface NewThreadHandler {
  (
    projectRef: ScopedProjectRef,
    options?: {
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: DraftThreadEnvMode;
      startFromOrigin?: boolean;
    },
  ): Promise<unknown>;
}

export interface ChatThreadActionContext {
  readonly activeDraftThread: ThreadContextLike | null;
  readonly activeThread: ThreadContextLike | undefined;
  readonly defaultProjectRef: ScopedProjectRef | null;
  readonly handleNewThread: NewThreadHandler;
}

export interface NewThreadProjectGroup {
  readonly projectKey: string;
  readonly displayName: string;
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
  readonly memberProjectRefs: readonly ScopedProjectRef[];
}

export type SidebarNewThreadTarget =
  | { readonly kind: "project"; readonly projectRef: ScopedProjectRef; readonly label: string }
  | { readonly kind: "picker" }
  | { readonly kind: "empty" };

/** A selected group wins over the viewed conversation; All threads requires an explicit choice. */
export function resolveSidebarNewThreadTarget(input: {
  readonly groups: readonly NewThreadProjectGroup[];
  readonly selectedProjectKey: string | null;
  readonly currentProjectRef: ScopedProjectRef | null;
}): SidebarNewThreadTarget {
  const selected =
    input.selectedProjectKey === null
      ? null
      : input.groups.find((group) => group.projectKey === input.selectedProjectKey);
  // A deleted selection must not silently redirect a new task to the remaining project.
  if (input.selectedProjectKey !== null && !selected) return { kind: "picker" };
  const group = selected ?? (input.groups.length === 1 ? input.groups[0] : null);
  if (!group) return { kind: input.groups.length === 0 ? "empty" : "picker" };
  const current = input.currentProjectRef;
  const projectRef =
    current &&
    group.memberProjectRefs.some(
      (member) =>
        member.environmentId === current.environmentId && member.projectId === current.projectId,
    )
      ? current
      : scopeProjectRef(group.environmentId, group.id);
  return { kind: "project", projectRef, label: group.displayName };
}

export function resolveNewDraftStartFromOrigin(input: {
  envMode: DraftThreadEnvMode;
  newWorktreesStartFromOrigin: boolean;
}): boolean {
  return input.envMode === "worktree" && input.newWorktreesStartFromOrigin;
}

export function resolveNewThreadModelSelectionOverride(input: {
  readonly projectDefaultSelection: ModelSelection | null;
  readonly carrySelection: ModelSelection | null;
  readonly carrySourceDraftId: string | null;
  readonly destinationDraftId: string;
}): ModelSelection | null {
  return (
    input.projectDefaultSelection ??
    (input.carrySourceDraftId === input.destinationDraftId ? null : input.carrySelection)
  );
}

export function hasExplicitComposerModelSelection(
  draft: ComposerModelSelectionState | null | undefined,
): boolean {
  const activeProvider = draft?.activeProvider;
  return (
    draft?.modelSelectionExplicit === true &&
    activeProvider !== null &&
    activeProvider !== undefined &&
    draft.modelSelectionByProvider[activeProvider] !== undefined
  );
}

export function resolveThreadActionProjectRef(
  context: ChatThreadActionContext,
): ScopedProjectRef | null {
  if (context.activeThread) {
    return scopeProjectRef(context.activeThread.environmentId, context.activeThread.projectId);
  }
  if (context.activeDraftThread) {
    return scopeProjectRef(
      context.activeDraftThread.environmentId,
      context.activeDraftThread.projectId,
    );
  }
  return context.defaultProjectRef;
}

export async function startNewThreadFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  const projectRef = resolveThreadActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  await context.handleNewThread(projectRef);
  return true;
}
