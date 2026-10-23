import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type ModelSelection,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  resolveSidebarNewThreadTarget,
  resolveNewThreadModelSelectionOverride,
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

describe("chatThreadActions", () => {
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
