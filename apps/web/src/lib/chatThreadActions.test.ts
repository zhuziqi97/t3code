import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type ModelSelection,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  resolveThreadActionProjectRef,
  resolveSidebarNewThreadTarget,
  hasExplicitComposerModelSelection,
  resolveNewDraftStartFromOrigin,
  resolveNewThreadModelSelectionOverride,
  startNewThreadFromContext,
  type ChatThreadActionContext,
} from "./chatThreadActions";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const PROJECT_ID = ProjectId.make("project-1");
const FALLBACK_PROJECT_ID = ProjectId.make("project-2");
const PROJECT_DEFAULT_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "project-default",
};
const CARRIED_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "carried-model",
};

function createContext(overrides: Partial<ChatThreadActionContext> = {}): ChatThreadActionContext {
  return {
    activeDraftThread: null,
    activeThread: undefined,
    defaultProjectRef: scopeProjectRef(ENVIRONMENT_ID, FALLBACK_PROJECT_ID),
    handleNewThread: async () => {},
    ...overrides,
  };
}

describe("chatThreadActions", () => {
  it("only treats an active stored selection marked explicit as an explicit pick", () => {
    const draft = {
      activeProvider: PROJECT_DEFAULT_SELECTION.instanceId,
      modelSelectionByProvider: {
        [PROJECT_DEFAULT_SELECTION.instanceId]: PROJECT_DEFAULT_SELECTION,
      },
      modelSelectionExplicit: true,
    };

    expect(hasExplicitComposerModelSelection(draft)).toBe(true);
    expect(hasExplicitComposerModelSelection({ ...draft, modelSelectionExplicit: false })).toBe(
      false,
    );
    expect(hasExplicitComposerModelSelection({ ...draft, activeProvider: null })).toBe(false);
  });

  it("does not carry a non-explicit model from the destination draft back into itself", () => {
    expect(
      resolveNewThreadModelSelectionOverride({
        projectDefaultSelection: null,
        carrySelection: CARRIED_SELECTION,
        carrySourceDraftId: "draft-a",
        destinationDraftId: "draft-a",
      }),
    ).toBeNull();
  });

  it("still carries models between different threads when the project has no default", () => {
    expect(
      resolveNewThreadModelSelectionOverride({
        projectDefaultSelection: null,
        carrySelection: CARRIED_SELECTION,
        carrySourceDraftId: "draft-a",
        destinationDraftId: "draft-b",
      }),
    ).toEqual(CARRIED_SELECTION);
  });

  it("keeps the project default above any carried selection", () => {
    expect(
      resolveNewThreadModelSelectionOverride({
        projectDefaultSelection: PROJECT_DEFAULT_SELECTION,
        carrySelection: CARRIED_SELECTION,
        carrySourceDraftId: "draft-a",
        destinationDraftId: "draft-b",
      }),
    ).toEqual(PROJECT_DEFAULT_SELECTION);
  });

  it("only applies the start-from-origin default to new worktree drafts", () => {
    expect(
      resolveNewDraftStartFromOrigin({
        envMode: "worktree",
        newWorktreesStartFromOrigin: true,
      }),
    ).toBe(true);
    expect(
      resolveNewDraftStartFromOrigin({
        envMode: "local",
        newWorktreesStartFromOrigin: true,
      }),
    ).toBe(false);
  });

  it("prefers the active thread project when resolving thread actions", () => {
    const projectRef = resolveThreadActionProjectRef(
      createContext({
        activeThread: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
        },
      }),
    );

    expect(projectRef).toEqual(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID));
  });

  it("falls back to the active draft thread project when there is no active thread", () => {
    const projectRef = resolveThreadActionProjectRef(
      createContext({
        activeDraftThread: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
        },
      }),
    );

    expect(projectRef).toEqual(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID));
  });

  it("falls back to the default project ref when there is no active thread context", () => {
    const projectRef = resolveThreadActionProjectRef(
      createContext({
        defaultProjectRef: scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID),
      }),
    );

    expect(projectRef).toEqual(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID));
  });

  it("inherits only the project from context, never branch or worktree state", async () => {
    const handleNewThread = vi.fn<ChatThreadActionContext["handleNewThread"]>(async () => {});

    const didStart = await startNewThreadFromContext(
      createContext({
        activeThread: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
        },
        handleNewThread,
      }),
    );

    expect(didStart).toBe(true);
    expect(handleNewThread).toHaveBeenCalledWith(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID));
  });

  it("does not start a thread when there is no project context", async () => {
    const handleNewThread = vi.fn<ChatThreadActionContext["handleNewThread"]>(async () => {});

    const didStart = await startNewThreadFromContext(
      createContext({
        defaultProjectRef: null,
        handleNewThread,
      }),
    );

    expect(didStart).toBe(false);
    expect(handleNewThread).not.toHaveBeenCalled();
  });
});

describe("sidebar new thread destination", () => {
  const a = {
    projectKey: "a",
    displayName: "A",
    environmentId: ENVIRONMENT_ID,
    id: PROJECT_ID,
    memberProjectRefs: [scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID)],
  };
  const remote = scopeProjectRef(EnvironmentId.make("remote"), ProjectId.make("remote-b"));
  const b = {
    projectKey: "b",
    displayName: "B",
    environmentId: ENVIRONMENT_ID,
    id: FALLBACK_PROJECT_ID,
    memberProjectRefs: [scopeProjectRef(ENVIRONMENT_ID, FALLBACK_PROJECT_ID), remote],
  };
  it("creates in selected B while A is still being viewed", () => {
    expect(
      resolveSidebarNewThreadTarget({
        groups: [a, b],
        selectedProjectKey: "b",
        currentProjectRef: a.memberProjectRefs[0]!,
      }),
    ).toEqual({ kind: "project", label: "B", projectRef: b.memberProjectRefs[0] });
  });
  it("keeps the viewed physical member only when it belongs to the selected group", () => {
    expect(
      resolveSidebarNewThreadTarget({
        groups: [a, b],
        selectedProjectKey: "b",
        currentProjectRef: remote,
      }),
    ).toEqual({ kind: "project", label: "B", projectRef: remote });
  });
  it("requires a choice in All threads, even when a conversation is open", () => {
    expect(
      resolveSidebarNewThreadTarget({
        groups: [a, b],
        selectedProjectKey: null,
        currentProjectRef: a.memberProjectRefs[0]!,
      }),
    ).toEqual({ kind: "picker" });
  });
  it("starts directly with one group, and offers onboarding with none", () => {
    expect(
      resolveSidebarNewThreadTarget({
        groups: [a],
        selectedProjectKey: null,
        currentProjectRef: null,
      }),
    ).toEqual({ kind: "project", label: "A", projectRef: a.memberProjectRefs[0] });
    expect(
      resolveSidebarNewThreadTarget({
        groups: [],
        selectedProjectKey: null,
        currentProjectRef: null,
      }),
    ).toEqual({ kind: "empty" });
  });
  it("does not redirect a deleted selection to the only remaining project", () => {
    expect(
      resolveSidebarNewThreadTarget({
        groups: [a],
        selectedProjectKey: "b",
        currentProjectRef: null,
      }),
    ).toEqual({ kind: "picker" });
  });
});
