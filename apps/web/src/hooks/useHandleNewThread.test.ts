import { describe, expect, it, vi } from "vite-plus/test";
import type { RuntimeMode, ScopedProjectRef } from "@t3tools/contracts";

const testState = vi.hoisted(() => {
  let completeProjectFileRead: (value: null) => void = () => undefined;
  let projectFileRead = Promise.resolve<null>(null);
  let completeNavigation: () => void = () => undefined;
  let navigationLoad = Promise.resolve();
  let markNavigationStarted: () => void = () => undefined;
  let navigationStarted = Promise.resolve();
  let projectRemoved = false;
  let targetSettings = {
    defaultThreadEnvMode: "local" as "local" | "worktree" | null,
    newWorktreesStartFromOrigin: false,
    defaultModelSelection: null,
    defaultRuntimeMode: "full-access" as RuntimeMode,
  };
  let storedDraft: {
    readonly draftId: string;
    readonly environmentId: string;
    readonly promotedTo: null;
    readonly threadId: string;
    readonly projectId?: string;
  } | null = null;
  const router = {
    latestLoadPromise: undefined as Promise<void> | undefined,
    state: {
      location: { href: "/", pathname: "/" },
      matches: [{ params: {} as { draftId?: string } }],
    },
    navigate: vi.fn((request: { readonly params: { readonly draftId: string } }) => {
      router.state.location.href = `/draft/${request.params.draftId}`;
      router.state.location.pathname = router.state.location.href;
      router.latestLoadPromise = navigationLoad.then(() => {
        router.state.matches = [{ params: request.params }];
      });
      markNavigationStarted();
      return router.latestLoadPromise;
    }),
  };
  const draftStore = {
    getComposerDraft: vi.fn(() => ({})),
    getDraftSessionByLogicalProjectKey: vi.fn(() => storedDraft),
    getDraftSession: vi.fn((draftId: string) =>
      storedDraft?.draftId === draftId ? storedDraft : null,
    ),
    getDraftThread: vi.fn(() => null),
    applyStickyState: vi.fn(),
    setDraftThreadContext: vi.fn(),
    setLogicalProjectDraftThreadId: vi.fn(
      (
        _logicalProjectKey: string,
        projectRef: { environmentId: string; projectId: string },
        draftId: string,
        options: { threadId: string },
      ) => {
        storedDraft = { ...projectRef, draftId, threadId: options.threadId, promotedTo: null };
      },
    ),
    setModelSelection: vi.fn(),
  };

  return {
    deferNavigation() {
      navigationLoad = new Promise<void>((resolve) => {
        completeNavigation = resolve;
      });
    },
    get navigationStarted() {
      return navigationStarted;
    },
    completeNavigation: () => completeNavigation(),
    completeProjectFileRead: (value: null) => completeProjectFileRead(value),
    draftStore,
    get projectFileRead() {
      return projectFileRead;
    },
    get projectRemoved() {
      return projectRemoved;
    },
    removeProject() {
      projectRemoved = true;
    },
    get targetSettings() {
      return targetSettings;
    },
    reset(
      nextStoredDraft: typeof storedDraft,
      workspaceDefaults = {
        envMode: "local" as "local" | "worktree",
        startFromOrigin: false,
      },
    ) {
      storedDraft = nextStoredDraft ? { projectId: "project-remote", ...nextStoredDraft } : null;
      projectRemoved = false;
      targetSettings = {
        defaultThreadEnvMode: workspaceDefaults.envMode,
        newWorktreesStartFromOrigin: workspaceDefaults.startFromOrigin,
        defaultModelSelection: null,
        defaultRuntimeMode: "full-access",
      };
      router.state.location.href = "/";
      router.state.location.pathname = "/";
      router.state.matches = [{ params: {} }];
      router.latestLoadPromise = undefined;
      navigationLoad = Promise.resolve();
      navigationStarted = new Promise<void>((resolve) => {
        markNavigationStarted = resolve;
      });
      router.navigate.mockClear();
      draftStore.setDraftThreadContext.mockClear();
      draftStore.setLogicalProjectDraftThreadId.mockClear();
      projectFileRead = new Promise<null>((resolve) => {
        completeProjectFileRead = resolve;
      });
    },
    router,
  };
});

const testServerConfigs = () =>
  new Map([
    [
      "environment-primary",
      {
        settings: {
          ...testState.targetSettings,
          newWorktreesStartFromOrigin: !testState.targetSettings.newWorktreesStartFromOrigin,
        },
      },
    ],
    ["environment-ssh", { settings: testState.targetSettings }],
  ]);

vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: { get: () => testServerConfigs() },
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) =>
    atom === "primary-settings"
      ? { newWorktreesStartFromOrigin: !testState.targetSettings.newWorktreesStartFromOrigin }
      : testServerConfigs(),
}));
vi.mock("@t3tools/client-runtime/environment", () => ({
  scopedProjectKey: () => "remote-project",
  scopeProjectRef: (environmentId: string, projectId: string) => ({ environmentId, projectId }),
  scopeThreadRef: (environmentId: string, threadId: string) => ({ environmentId, threadId }),
}));
vi.mock("@t3tools/contracts", () => ({
  DEFAULT_RUNTIME_MODE: "default",
  DEFAULT_SERVER_SETTINGS: {},
}));
vi.mock("@t3tools/shared/projectSettings", () => ({
  resolveProjectSettings: (
    settings: Record<string, unknown>,
    _projectId: unknown,
    _project: unknown,
    projectFile?: { defaultThreadEnvMode?: "local" | "worktree" } | null,
  ) => ({
    settings:
      projectFile === undefined
        ? settings
        : {
            ...settings,
            defaultThreadEnvMode:
              settings.defaultThreadEnvMode ?? projectFile?.defaultThreadEnvMode ?? "local",
          },
    sources: { defaultModelSelection: "environment", defaultThreadEnvMode: "environment" },
    overrides: {},
  }),
  resolveNewThreadEnvMode: (input: {
    projectSettings: { settings: { defaultThreadEnvMode: "local" | "worktree" } };
  }) => input.projectSettings.settings.defaultThreadEnvMode,
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => null,
  useRouter: () => testState.router,
}));
vi.mock("react", () => ({
  useCallback: <T>(callback: T) => callback,
  useMemo: <T>(factory: () => T) => factory(),
}));
vi.mock("../components/Sidebar.logic", () => ({ orderItemsByPreferredIds: () => [] }));
vi.mock("../composerDraftStore", () => {
  const useComposerDraftStore = Object.assign(() => null, {
    getState: () => testState.draftStore,
  });
  return {
    composerDraftHasUserContent: () => false,
    markPromotedDraftThreadByRef: vi.fn(),
    useComposerDraftStore,
  };
});
vi.mock("../lib/chatThreadActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/chatThreadActions")>()),
  hasExplicitComposerModelSelection: () => false,
  resolveNewThreadModelSelectionOverride: () => null,
}));
vi.mock("../lib/t3ProjectFileDefaults", () => ({
  readT3ProjectFile: () => testState.projectFileRead,
}));
vi.mock("../lib/utils", () => ({
  newDraftId: () => "draft-delayed",
  newThreadId: () => "thread-delayed",
}));
vi.mock("../logicalProject", () => ({
  deriveLogicalProjectKeyFromSettings: () => "remote-project",
  getProjectOrderKey: () => "remote-project",
  selectProjectGroupingSettings: () => ({}),
}));
vi.mock("../state/entities", () => {
  const project = {
    id: "project-remote",
    environmentId: "environment-ssh",
    workspaceRoot: "/remote/project",
    defaultThreadEnvMode: null,
    defaultModelSelection: null,
  };
  return {
    readProject: () => (testState.projectRemoved ? null : project),
    readProjects: () => (testState.projectRemoved ? [] : [project]),
    readThreadShell: () => null,
    readThreadShells: () => [],
    useProjects: () => [],
    useThread: () => null,
  };
});
vi.mock("../state/server", () => ({
  environmentServerConfigsAtom: {},
  primaryServerSettingsAtom: "primary-settings",
}));
vi.mock("../threadRoutes", () => ({
  resolveThreadRouteTarget: (params: { draftId?: string }) =>
    params.draftId ? { kind: "draft", draftId: params.draftId } : null,
}));
vi.mock("../uiStateStore", () => ({
  legacyProjectCwdPreferenceKey: () => "remote-project",
  useUiStateStore: () => [],
}));
vi.mock("./useSettings", () => ({ useClientSettings: () => ({}) }));

import { useNewThreadHandler } from "./useHandleNewThread";
import { handleDesktopAppActivationRequest } from "../desktopAppActivation";

describe.each([
  ["new", null],
  [
    "reusable",
    {
      draftId: "draft-existing",
      environmentId: "environment-ssh",
      promotedTo: null,
      threadId: "thread-existing",
    },
  ],
])("useNewThreadHandler with a %s draft", (_, draft) => {
  it("acknowledges the draft opened concurrently by the landing page", async () => {
    testState.reset(draft);
    testState.targetSettings.defaultThreadEnvMode = null;
    testState.deferNavigation();
    const projectRef = {
      environmentId: "environment-ssh",
      projectId: "project-remote",
    } as ScopedProjectRef;
    const openThread = useNewThreadHandler();
    const landingOpen = openThread(projectRef, { replace: true });
    const activation = handleDesktopAppActivationRequest(
      {
        version: 1,
        requestId: "cli-first-project",
        type: "open-workspace",
        workspaceRoot: "/remote/project",
        platform: "linux",
      },
      {
        getTarget: () => ({ environmentId: projectRef.environmentId, platform: "linux" }),
        findProject: () => ({
          ...projectRef,
          id: projectRef.projectId,
          workspaceRoot: "/remote/project",
        }),
        createProject: vi.fn(async () => projectRef.projectId),
        waitForProject: vi.fn(async () => undefined),
        openThread,
      },
    );

    testState.completeProjectFileRead(null);
    await testState.navigationStarted;
    expect(testState.router.state.location.href).toMatch(/^\/draft\//);
    expect(testState.router.state.matches[0]!.params).toEqual({});
    testState.completeNavigation();
    const opened = await landingOpen;

    await expect(activation).resolves.toMatchObject({
      ok: true,
      projectId: "project-remote",
      threadId: opened!.threadId,
    });
    expect(testState.router.navigate).toHaveBeenCalledTimes(1);
    expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledTimes(1);
  });

  it.each(["approval-required", "auto-accept-edits", "auto", "full-access"] as const)(
    "uses the target environment's %s permissions for new threads",
    async (runtimeMode) => {
      testState.reset(draft);
      testState.targetSettings.defaultRuntimeMode = runtimeMode;
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as never;
      const pendingOpen = useNewThreadHandler()(projectRef);
      testState.completeProjectFileRead(null);
      const opened = await pendingOpen;

      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        projectRef,
        opened!.draftId,
        expect.objectContaining({ runtimeMode }),
      );
    },
  );

  it("abandons a delayed draft open when the user navigates elsewhere", async () => {
    testState.reset(draft);
    testState.targetSettings.defaultThreadEnvMode = null;
    const openThread = useNewThreadHandler();
    const pendingOpen = openThread(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      { replace: true },
    );

    testState.router.state.location.href = "/usage";
    testState.completeProjectFileRead(null);
    await pendingOpen;

    expect(testState.router.state.location.href).toBe("/usage");
    expect(testState.router.navigate).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
  });

  it.each(["navigate away", "remove project"])(
    "does not acknowledge a concurrent open after %s while its route loads",
    async (action) => {
      testState.reset(draft);
      testState.targetSettings.defaultThreadEnvMode = null;
      testState.deferNavigation();
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as ScopedProjectRef;
      const openThread = useNewThreadHandler();
      const landingOpen = openThread(projectRef, { replace: true });
      const concurrentOpen = openThread(projectRef);
      testState.completeProjectFileRead(null);
      await testState.navigationStarted;
      if (action === "navigate away") {
        testState.router.state.location = { href: "/usage", pathname: "/usage" };
      } else {
        testState.removeProject();
      }
      testState.completeNavigation();

      await landingOpen;
      await expect(concurrentOpen).resolves.toBeNull();
      expect(testState.router.navigate).toHaveBeenCalledTimes(1);
      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["environment-ssh", "another-project"],
    ["another-environment", "project-remote"],
  ])("does not acknowledge a draft opened in %s / %s", async (environmentId, projectId) => {
    testState.reset(draft);
    testState.targetSettings.defaultThreadEnvMode = null;
    const pendingOpen = useNewThreadHandler()({
      environmentId: "environment-ssh",
      projectId: "project-remote",
    } as never);
    testState.draftStore.setLogicalProjectDraftThreadId(
      "remote-project",
      { environmentId, projectId },
      "draft-other",
      { threadId: "thread-other" },
    );
    void testState.router.navigate({ params: { draftId: "draft-other" } });
    testState.router.navigate.mockClear();
    testState.draftStore.setLogicalProjectDraftThreadId.mockClear();
    testState.completeProjectFileRead(null);

    await expect(pendingOpen).resolves.toBeNull();
    expect(testState.router.state.location.href).toBe("/draft/draft-other");
    expect(testState.router.navigate).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
  });

  it("abandons a delayed draft open when the project is removed meanwhile", async () => {
    testState.reset(draft);
    testState.targetSettings.defaultThreadEnvMode = null;
    const pendingOpen = useNewThreadHandler()(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      { replace: true },
    );

    testState.removeProject();
    testState.completeProjectFileRead(null);

    await expect(pendingOpen).resolves.toBeNull();
    expect(testState.router.navigate).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "uses the target environment's start-from-origin default of %s",
    async (startFromOrigin) => {
      testState.reset(draft, { envMode: "worktree", startFromOrigin });
      const openThread = useNewThreadHandler();
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as never;
      const pendingOpen = openThread(projectRef);

      testState.completeProjectFileRead(null);
      const opened = await pendingOpen;

      expect(opened).toEqual({
        draftId: draft?.draftId ?? "draft-delayed",
        threadId: draft?.threadId ?? "thread-delayed",
      });
      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        projectRef,
        opened!.draftId,
        expect.objectContaining({ envMode: "worktree", startFromOrigin }),
      );
      if (draft) {
        expect(testState.draftStore.setDraftThreadContext).toHaveBeenCalledWith(
          draft.draftId,
          expect.objectContaining({ envMode: "worktree", startFromOrigin }),
        );
      }
    },
  );

  it.each([true, false])(
    "preserves an explicit start-from-origin choice of %s",
    async (startFromOrigin) => {
      testState.reset(draft, { envMode: "worktree", startFromOrigin: !startFromOrigin });
      const openThread = useNewThreadHandler();
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as never;

      const opened = await openThread(projectRef, { envMode: "worktree", startFromOrigin });

      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        projectRef,
        opened!.draftId,
        expect.objectContaining({ envMode: "worktree", startFromOrigin }),
      );
    },
  );
});

it("rejects a missing project before creating a draft or looking up execution defaults", async () => {
  testState.reset(null);
  const openThread = useNewThreadHandler();
  await expect(
    openThread({ environmentId: "environment-ssh", projectId: "project-deleted" } as never),
  ).rejects.toThrow("This project is no longer available");
  expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
});
