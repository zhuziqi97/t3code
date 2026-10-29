import {
  BUILT_IN_BROWSER_PROFILES,
  DEFAULT_BROWSER_PROFILE_ID,
  DEFAULT_PREVIEW_APPEARANCE,
  DEFAULT_PREVIEW_ZOOM_FACTOR,
  EnvironmentId,
  ProjectId,
  FILL_PREVIEW_VIEWPORT,
  ThreadId,
} from "@t3tools/contracts";
import { type ComponentProps } from "react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../../test/render";
import type { Project } from "~/types";

import type { PreviewableServer } from "./useDiscoveredLocalServers";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(async (_tabId: string, _url: string): Promise<void> => undefined),
  rememberPreviewUrl: vi.fn(),
  readPreparedConnection: vi.fn(() => ({ httpBaseUrl: "http://172.25.85.75:3773" })),
  readEnvironmentScope: vi.fn((_environmentId?: unknown, _scope?: unknown) => true),
  setAnnotationSendEnabled: vi.fn(async (_tabId: string, _enabled: boolean): Promise<void> => {}),
  cancelPickElement: vi.fn(async (_tabId: string) => undefined),
  openPictureInPicture: vi.fn(async (_tabId: string): Promise<void> => undefined),
  closePictureInPicture: vi.fn(async (_tabId: string): Promise<void> => undefined),
  pickElement: vi.fn(),
  addPreviewAnnotation: vi.fn(),
  addImage: vi.fn(),
  toast: vi.fn(),
  pictureInPicture: false,
  showEmptyState: false,
  loading: false,
  nativeServerTab: false,
  serverEpoch: null as string | null,
  servers: [] as PreviewableServer[],
  shellProjectId: null as string | null,
  projects: [] as Project[],
  recordingTabIds: new Set<string>(),
  recordingRuntimeTabId: null as string | null,
  recordVisitForThread: vi.fn(),
}));

const STUB_BROWSER_DEFAULTS = {
  viewport: FILL_PREVIEW_VIEWPORT,
  zoomFactor: DEFAULT_PREVIEW_ZOOM_FACTOR,
  appearance: DEFAULT_PREVIEW_APPEARANCE,
  autoShowFloatingPreview: true,
  profiles: BUILT_IN_BROWSER_PROFILES,
  profileId: DEFAULT_BROWSER_PROFILE_ID,
};

// The desktop bridge only exists inside Electron; the view reads it once at import.
vi.mock(import("./previewBridge"), async (original) => ({
  ...(await original()),
  previewBridge: {
    navigate: mocks.navigate,
    pickElement: mocks.pickElement,
    setAnnotationSendEnabled: mocks.setAnnotationSendEnabled,
    cancelPickElement: mocks.cancelPickElement,
    refresh: vi.fn(async () => undefined),
    goBack: vi.fn(async () => undefined),
    goForward: vi.fn(async () => undefined),
    hardReload: vi.fn(async () => undefined),
    openDevTools: vi.fn(async () => undefined),
    setColorScheme: vi.fn(async () => undefined),
    zoomIn: vi.fn(async () => undefined),
    zoomOut: vi.fn(async () => undefined),
    resetZoom: vi.fn(async () => undefined),
    clearCookies: vi.fn(async () => undefined),
    clearCache: vi.fn(async () => undefined),
    pictureInPicture: {
      open: mocks.openPictureInPicture,
      close: mocks.closePictureInPicture,
    },
  } as never,
}));
vi.mock(import("~/browserHistoryStore"), async (original) => ({
  ...(await original()),
  recordVisitForThread: mocks.recordVisitForThread,
}));
vi.mock(import("~/state/session"), async (original) => ({
  ...(await original()),
  readPreparedConnection: mocks.readPreparedConnection as never,
  readEnvironmentScope: mocks.readEnvironmentScope,
  useEnvironmentScope: mocks.readEnvironmentScope,
}));
vi.mock(import("~/browser/browserDefaults"), async (original) => ({
  ...(await original()),
  useBrowserDefaults: () => STUB_BROWSER_DEFAULTS,
  getBrowserDefaults: () => STUB_BROWSER_DEFAULTS,
}));
vi.mock(import("~/previewStateStore"), async (original) => ({
  ...(await original()),
  rememberPreviewUrl: mocks.rememberPreviewUrl,
  useThreadPreviewState: (() => ({
    activeTabId: "tab-1",
    serverEpoch: mocks.serverEpoch,
    desktopByTabId: {
      "tab-1": {
        hasWebContents: true,
        canGoBack: false,
        canGoForward: false,
        loading: mocks.loading,
        zoomFactor: 1,
        pictureInPicture: mocks.pictureInPicture,
        colorScheme: "system",
        audioMuted: false,
        audible: false,
        controller: "none",
      },
    },
    recentlySeenUrls: [],
    sessions: mocks.showEmptyState
      ? {}
      : {
          "tab-1": {
            threadId: "thread-1",
            tabId: "tab-1",
            runtime: mocks.nativeServerTab ? "server" : "desktop",
            navStatus: { _tag: "Success", url: "http://example.com/", title: "Example" },
            canGoBack: false,
            canGoForward: false,
            updatedAt: "2026-07-13T00:00:00.000Z",
          },
        },
  })) as never,
}));
vi.mock(import("~/state/environments"), async (original) => ({
  ...(await original()),
  useEnvironment: (() => ({ label: "WSL" })) as never,
  useEnvironmentHttpBaseUrl: () => "http://172.25.85.75:3773",
  usePrimaryEnvironmentId: () => null,
  readPrimaryEnvironmentId: () => null,
}));
vi.mock(import("~/hooks/useSettings"), async (original) => {
  const { DEFAULT_CLIENT_SETTINGS } = await import("@t3tools/contracts/settings");
  return {
    ...(await original()),
    getClientSettings: () => DEFAULT_CLIENT_SETTINGS,
    useClientSettings: ((select?: (settings: typeof DEFAULT_CLIENT_SETTINGS) => unknown) =>
      select
        ? select(DEFAULT_CLIENT_SETTINGS)
        : DEFAULT_CLIENT_SETTINGS) as typeof import("~/hooks/useSettings").useClientSettings,
    isClientSettingsHydrated: () => true,
  };
});
vi.mock(import("~/browser/browserRecording"), async (original) => ({
  ...(await original()),
  findActiveBrowserRecordingRuntimeTabId: () => mocks.recordingRuntimeTabId,
  useActiveBrowserRecordingTabIds: () => mocks.recordingTabIds,
}));
vi.mock(import("~/components/ui/toast"), async (original) => {
  const actual = await original();
  return { ...actual, toastManager: { ...actual.toastManager, add: mocks.toast } };
});
vi.mock(import("./useDiscoveredLocalServers"), async (original) => ({
  ...(await original()),
  useDiscoveredLocalServers: () => mocks.servers,
}));
vi.mock(import("./usePreviewSession"), async (original) => ({
  ...(await original()),
  usePreviewSession: () => {},
}));

vi.mock(import("~/browser/previewRuntime"), async (original) => ({
  ...(await original()),
  useRendersServerTabNatively: () => mocks.nativeServerTab,
}));

vi.mock(import("~/browser/browserViewportActions"), { spy: true });

import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { useBrowserPointerStore } from "~/browser/browserPointerStore";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import { usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";
import { dispatchPreviewAction } from "./previewActionBus";
import { PreviewView } from "./PreviewView";

const TEST_THREAD_REF = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
} as const;
const TEST_RUNTIME_TAB_ID = previewRuntimeTabId(TEST_THREAD_REF, null, "tab-1");

function view(onSendAnnotation?: ComponentProps<typeof PreviewView>["onSendAnnotation"]) {
  return (
    <PreviewView
      threadRef={TEST_THREAD_REF}
      tabId="tab-1"
      visible
      {...(onSendAnnotation ? { onSendAnnotation } : {})}
    />
  );
}

function annotation(id: string, screenshot: unknown = null) {
  return {
    id,
    pageUrl: "https://example.com/dashboard",
    pageTitle: "Dashboard",
    comment: "Tighten this spacing",
    elements: [],
    regions: [],
    strokes: [],
    styleChanges: [],
    screenshot,
    createdAt: "2026-07-27T00:00:00.000Z",
  };
}

function project(environmentId: string, projectId: string): Project {
  return {
    environmentId: EnvironmentId.make(environmentId),
    id: ProjectId.make(projectId),
    title: projectId,
    workspaceRoot: `/workspace/${projectId}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
  };
}

// The mocked modules and stores are shared by the whole file, so every test starts by
// resetting them.
function setup() {
  vi.clearAllMocks();
  mocks.readEnvironmentScope.mockReset().mockReturnValue(true);
  mocks.setAnnotationSendEnabled.mockReset().mockResolvedValue(undefined);
  mocks.pickElement.mockReset();
  mocks.pictureInPicture = false;
  mocks.showEmptyState = false;
  mocks.loading = false;
  mocks.nativeServerTab = false;
  mocks.serverEpoch = null;
  mocks.servers = [];
  mocks.shellProjectId = null;
  mocks.projects = [];
  mocks.recordingTabIds = new Set();
  mocks.recordingRuntimeTabId = null;
  useComposerDraftStore.setState({
    addPreviewAnnotation: mocks.addPreviewAnnotation,
    addImage: mocks.addImage,
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    draftsByThreadKey: {},
  });
  usePreviewMiniPlayerStore.setState({ byThreadKey: {} });
  useBrowserPointerStore.setState({ byTabId: {} });
}

describe("PreviewView", () => {
  it("retains the annotation locally when its own environment loses access during capture", async () => {
    setup();
    const picked = annotation("annotation-revoked");
    const onSendAnnotation = vi.fn();
    let submitPick: (() => void) | undefined;
    mocks.pickElement.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          submitPick = () => resolve({ annotation: picked, submission: "send" });
        }),
    );
    await using screen = await render(view(onSendAnnotation));
    await userEvent.click(page.getByRole("button", { name: "Annotate preview" }));
    await vi.waitFor(() => expect(submitPick).toBeDefined());
    expect(mocks.setAnnotationSendEnabled).toHaveBeenLastCalledWith(TEST_RUNTIME_TAB_ID, true);

    mocks.readEnvironmentScope.mockImplementation(
      (environmentId?: unknown) => environmentId !== TEST_THREAD_REF.environmentId,
    );
    await screen.rerender(view(onSendAnnotation));
    expect(mocks.setAnnotationSendEnabled).toHaveBeenLastCalledWith(TEST_RUNTIME_TAB_ID, false);
    await act(async () => submitPick!());
    await vi.waitFor(() =>
      expect(mocks.addPreviewAnnotation).toHaveBeenCalledWith(TEST_THREAD_REF, picked),
    );
    expect(onSendAnnotation).not.toHaveBeenCalled();

    mocks.readEnvironmentScope.mockReturnValue(true);
    mocks.pickElement.mockResolvedValue({ annotation: picked, submission: "send" });
    await screen.rerender(view(onSendAnnotation));
    await userEvent.click(page.getByRole("button", { name: "Annotate preview" }));
    await vi.waitFor(() => expect(onSendAnnotation).toHaveBeenCalledWith(picked, null));
    expect(mocks.setAnnotationSendEnabled).toHaveBeenLastCalledWith(TEST_RUNTIME_TAB_ID, true);
  });

  it("still sends annotation text when the picked element's crop is malformed", async () => {
    setup();
    const picked = annotation("annotation-2", {
      dataUrl: "data:image/png;base64,%%%",
      width: 10,
      height: 10,
      cropRect: { x: 0, y: 0, width: 10, height: 10 },
    });
    const onSendAnnotation = vi.fn();
    mocks.pickElement.mockResolvedValue({ annotation: picked, submission: "send" });
    await using _screen = await render(view(onSendAnnotation));
    await userEvent.click(page.getByRole("button", { name: "Annotate preview" }));

    const sent = { ...picked, screenshot: null };
    await vi.waitFor(() => expect(onSendAnnotation).toHaveBeenCalledWith(sent, null));
    expect(mocks.addPreviewAnnotation).toHaveBeenCalledWith(TEST_THREAD_REF, sent);
    expect(mocks.addImage).not.toHaveBeenCalled();
  });

  it("focuses the address bar each time the focus-url shortcut fires", async () => {
    setup();
    await using _screen = await render(view());
    const address = page.getByRole("textbox");

    act(() => dispatchPreviewAction("focus-url"));
    await expect.element(address).toHaveFocus();

    (address.element() as HTMLInputElement).blur();
    await expect.element(address).not.toHaveFocus();
    act(() => dispatchPreviewAction("focus-url"));
    await expect.element(address).toHaveFocus();
  });
});

vi.mock(import("~/state/entities"), async (original) => ({
  ...(await original()),
  readThreadShell: (() =>
    mocks.shellProjectId ? { projectId: ProjectId.make(mocks.shellProjectId) } : null) as never,
  useQuietThreadShell: (() =>
    mocks.shellProjectId ? { projectId: ProjectId.make(mocks.shellProjectId) } : null) as never,
  readProject: (ref) =>
    mocks.projects.find(
      (candidate) =>
        candidate.environmentId === ref.environmentId && candidate.id === ref.projectId,
    ) ?? null,
  readProjects: () => mocks.projects,
  useProjects: () => mocks.projects,
}));
describe("PreviewView navigation", () => {
  it("publishes pending visits on the next navigation after project hydration and keeps separate environment histories", async () => {
    setup();

    const history =
      await vi.importActual<typeof import("~/browserHistoryStore")>("~/browserHistoryStore");
    history.resetBrowserHistoryForTests();
    await using root = await render(null, { router: false });
    const secondThread = { ...TEST_THREAD_REF, threadId: ThreadId.make("second-thread") };
    const remoteThread = {
      ...secondThread,
      environmentId: EnvironmentId.make("other-environment"),
    };
    try {
      history.recordVisitForThread(TEST_THREAD_REF, "http://localhost:3000/one", 123);
      await act(() =>
        root.rerender(<PreviewView threadRef={TEST_THREAD_REF} tabId="tab-1" visible />),
      );
      expect(history.useBrowserHistoryStore.getState().byProjectKey).toEqual({});
      mocks.shellProjectId = "project-a";
      mocks.projects = [
        project("environment-1", "project-a"),
        project("other-environment", "project-a"),
      ];
      await act(() =>
        root.rerender(<PreviewView threadRef={TEST_THREAD_REF} tabId="tab-1" visible />),
      );
      await act(() =>
        history.recordVisitForThread(TEST_THREAD_REF, "http://localhost:3000/hydrated", 124),
      );
      expect(
        history.useBrowserHistoryStore.getState().byProjectKey[
          "environment-1:/workspace/project-a"
        ],
      ).toEqual([
        { url: "http://localhost:3000/hydrated", lastVisitedAt: 124 },
        { url: "http://localhost:3000/one", lastVisitedAt: 123 },
      ]);
      await act(() =>
        root.rerender(<PreviewView threadRef={secondThread} tabId="tab-1" visible />),
      );
      await act(() => history.recordVisitForThread(secondThread, "http://localhost:3000/two", 125));
      expect(
        history.useBrowserHistoryStore
          .getState()
          .byProjectKey["environment-1:/workspace/project-a"]?.map((entry) => entry.url),
      ).toEqual([
        "http://localhost:3000/two",
        "http://localhost:3000/hydrated",
        "http://localhost:3000/one",
      ]);
      await act(() =>
        root.rerender(<PreviewView threadRef={remoteThread} tabId="tab-1" visible />),
      );
      await act(() =>
        history.recordVisitForThread(remoteThread, "http://localhost:3000/remote", 126),
      );
      expect(
        history.useBrowserHistoryStore.getState().byProjectKey[
          "other-environment:/workspace/project-a"
        ],
      ).toEqual([{ url: "http://localhost:3000/remote", lastVisitedAt: 126 }]);
      expect(
        history.useBrowserHistoryStore.getState().byProjectKey[
          "environment-1:/workspace/project-a"
        ],
      ).toHaveLength(3);
      expect(history.useBrowserHistoryStore.getState().pendingVisitsByThreadKey).toEqual({});
    } finally {
      await act(() => root.unmount());
      history.resetBrowserHistoryForTests();
      vi.unstubAllGlobals();
    }
  });

  it("records history for a draft thread before its server shell exists", async () => {
    setup();

    const history =
      await vi.importActual<typeof import("~/browserHistoryStore")>("~/browserHistoryStore");
    history.resetBrowserHistoryForTests();
    mocks.projects = [project("environment-1", "draft-project")];
    useComposerDraftStore
      .getState()
      .setLogicalProjectDraftThreadId(
        "environment-1:/workspace/draft-project",
        scopeProjectRef(TEST_THREAD_REF.environmentId, ProjectId.make("draft-project")),
        DraftId.make("draft-1"),
        { threadId: TEST_THREAD_REF.threadId },
      );
    await using root = await render(null, { router: false });
    try {
      await act(() =>
        root.rerender(<PreviewView threadRef={TEST_THREAD_REF} tabId="tab-1" visible />),
      );
      await act(() =>
        history.recordVisitForThread(TEST_THREAD_REF, "http://localhost:3000/draft", 126),
      );
      expect(
        history.useBrowserHistoryStore.getState().byProjectKey[
          "environment-1:/workspace/draft-project"
        ],
      ).toEqual([{ url: "http://localhost:3000/draft", lastVisitedAt: 126 }]);
    } finally {
      await act(() => root.unmount());
      history.resetBrowserHistoryForTests();
      vi.unstubAllGlobals();
    }
  });
});
