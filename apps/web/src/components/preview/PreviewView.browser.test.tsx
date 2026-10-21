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
import { Profiler, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, fakeTimers, render, stubGlobal } from "../../../test/render";

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
  projectId: null as string | null,
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
}));
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

import { commitBrowserViewportChange } from "~/browser/browserViewportActions";
import { useBrowserSurfaceStore } from "~/browser/browserSurfaceStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useBrowserPointerStore } from "~/browser/browserPointerStore";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import { usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";
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

async function submitAddress(text: string) {
  const input = page.getByPlaceholder("Search or enter URL");
  await userEvent.click(input);
  await userEvent.fill(input, text);
  await userEvent.keyboard("{Enter}");
}

function hasCursor() {
  return document.querySelector("svg.lucide-mouse-pointer2") !== null;
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
  mocks.projectId = null;
  mocks.recordingTabIds = new Set();
  mocks.recordingRuntimeTabId = null;
  useComposerDraftStore.setState({
    addPreviewAnnotation: mocks.addPreviewAnnotation,
    addImage: mocks.addImage,
  });
  usePreviewMiniPlayerStore.setState({ byThreadKey: {} });
  useBrowserPointerStore.setState({ byTabId: {} });
}

describe("PreviewView", () => {
  it("shows the cursor in a replacement browser while the old instance still records", async () => {
    setup();
    mocks.recordingTabIds.add(TEST_RUNTIME_TAB_ID);
    mocks.recordingRuntimeTabId = TEST_RUNTIME_TAB_ID;
    const replacementTabId = previewRuntimeTabId(TEST_THREAD_REF, "replacement-server", "tab-1");
    useBrowserPointerStore.setState({
      byTabId: Object.fromEntries(
        [TEST_RUNTIME_TAB_ID, replacementTabId].map((tabId) => [
          tabId,
          { tabId, phase: "move", x: 10, y: 10, sequence: 1, createdAt: "2026-07-27T00:00:00Z" },
        ]),
      ),
    });
    await using screen = await render(view());
    expect(hasCursor()).toBe(false);
    mocks.serverEpoch = "replacement-server";
    await screen.rerender(view());
    expect(hasCursor()).toBe(true);
    expect(mocks.recordingTabIds.has(TEST_RUNTIME_TAB_ID)).toBe(true);
  });

  it.each([false, true])(
    "aligns the cursor and responsive viewport after host zoom changes (native server tab: %s)",
    async (nativeServerTab) => {
      setup();
      mocks.nativeServerTab = nativeServerTab;
      let windowZoom = 1;
      using _bridge = stubGlobal("desktopBridge", {
        getWindowZoomFactor: () => windowZoom,
        getLocalEnvironmentBootstraps: () => [],
      });
      const commit = vi.mocked(commitBrowserViewportChange).mockResolvedValueOnce(undefined);
      try {
        await using _screen = await render(view());
        await act(() => {
          const surfaces = useBrowserSurfaceStore.getState();
          const slot = document.querySelector<HTMLElement>("[data-browser-surface-slot]")!;
          slot.style.width = "1020px";
          slot.style.height = "798px";
          surfaces.presentContent(TEST_RUNTIME_TAB_ID, {
            x: 20,
            y: 40,
            width: 500,
            height: 375,
            scale: 0.5,
            scrollLeft: 7,
            scrollTop: 11,
          });
          useBrowserPointerStore.setState({
            byTabId: {
              [TEST_RUNTIME_TAB_ID]: {
                tabId: TEST_RUNTIME_TAB_ID,
                phase: "move",
                x: 100,
                y: 200,
                sequence: 1,
                createdAt: "2026-07-27T00:00:00Z",
              },
            },
          });
          windowZoom = 1.25;
          window.dispatchEvent(new Event("resize"));
        });
        const cursor = document.querySelector("[data-agent-browser-cursor]");
        expect(cursor).not.toBeNull();
        const position = new DOMMatrixReadOnly(getComputedStyle(cursor!).transform);
        expect(position.e).toBe(53);
        expect(position.f).toBe(109);

        await userEvent.click(page.getByRole("button", { name: "Preview menu" }));
        await userEvent.click(page.getByRole("menuitem", { name: "Show device toolbar" }));
        expect(commit).toHaveBeenCalledExactlyOnceWith(TEST_RUNTIME_TAB_ID, {
          _tag: "freeform",
          width: 1250,
          height: 938,
        });
      } finally {
        commit.mockReset();
        await act(() => useBrowserSurfaceStore.setState({ activityByTabId: {}, byTabId: {} }));
      }
    },
  );

  it("does not rerender while loading time passes", async () => {
    setup();
    using _timers = fakeTimers();
    mocks.loading = true;
    const onRender = vi.fn();
    await using _screen = await render(
      <Profiler id="preview" onRender={onRender}>
        {view()}
      </Profiler>,
    );
    const initialRenderCount = onRender.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(onRender).toHaveBeenCalledTimes(initialRenderCount);
  });

  it.each([
    [
      "https://localhost:8000/dashboard?mode=test#top",
      "https://localhost:8000/dashboard?mode=test#top",
    ],
    ["localhost:5173/app", "http://localhost:5173/app"],
  ])(
    "preserves a direct localhost URL %s in a WSL environment and records it",
    async (submitted, expected) => {
      setup();
      await using _screen = await render(view());
      await submitAddress(submitted);
      await vi.waitFor(() =>
        expect(mocks.navigate).toHaveBeenCalledWith(TEST_RUNTIME_TAB_ID, expected),
      );
      expect(mocks.rememberPreviewUrl).toHaveBeenCalledWith(TEST_THREAD_REF, expected);
      expect(mocks.recordVisitForThread).toHaveBeenCalledWith(TEST_THREAD_REF, expected);
    },
  );

  it("maps an empty-state localhost server onto the WSL host", async () => {
    setup();
    mocks.showEmptyState = true;
    mocks.servers = [
      {
        host: "localhost",
        port: 5173,
        url: "http://localhost:5173/app?mode=test#top",
        requestedUrl: "http://localhost:5173/app?mode=test#top",
        processName: "vite",
        pid: 1,
        terminal: null,
        source: "scanner",
      } as unknown as PreviewableServer,
    ];
    await using _screen = await render(view());
    await userEvent.click(page.getByRole("button", { name: /vite/ }));

    await vi.waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith(
        TEST_RUNTIME_TAB_ID,
        "http://172.25.85.75:5173/app?mode=test#top",
      ),
    );
    expect(mocks.rememberPreviewUrl).toHaveBeenCalledWith(
      TEST_THREAD_REF,
      "http://172.25.85.75:5173/app?mode=test#top",
    );
    // History keys off the requested loopback URL, which stays stable across hosts.
    await vi.waitFor(() =>
      expect(mocks.recordVisitForThread).toHaveBeenCalledWith(
        TEST_THREAD_REF,
        "http://localhost:5173/app?mode=test#top",
      ),
    );
  });

  it("opens and closes a thread-scoped floating preview for the active tab", async () => {
    setup();
    await using _screen = await render(view());
    await userEvent.click(page.getByRole("button", { name: "Float preview over chat" }));
    expect(usePreviewMiniPlayerStore.getState().byThreadKey).toMatchObject({
      "environment-1:thread-1": { source: { kind: "browser", tabId: "tab-1" } },
    });
    const closeButton = page.getByRole("button", { name: "Close floating preview" });
    await expect.element(closeButton).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(closeButton);
    expect(usePreviewMiniPlayerStore.getState().byThreadKey).toEqual({});
  });

  it("keeps the native preview window as a secondary menu action", async () => {
    setup();
    await using screen = await render(view());
    await userEvent.click(page.getByRole("button", { name: "Preview menu" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Open separate preview window" }));
    await vi.waitFor(() =>
      expect(mocks.openPictureInPicture).toHaveBeenCalledWith(TEST_RUNTIME_TAB_ID),
    );
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());

    mocks.pictureInPicture = true;
    await screen.rerender(view());
    await userEvent.click(page.getByRole("button", { name: "Preview menu" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Close separate preview window" }));
    await vi.waitFor(() =>
      expect(mocks.closePictureInPicture).toHaveBeenCalledWith(TEST_RUNTIME_TAB_ID),
    );
  });

  it("forwards Cmd/Ctrl+Enter annotations to the composer send path", async () => {
    setup();
    const picked = annotation("annotation-1");
    const onSendAnnotation = vi.fn();
    mocks.pickElement.mockResolvedValue({ annotation: picked, submission: "send" });
    await using _screen = await render(view(onSendAnnotation));
    await userEvent.click(page.getByRole("button", { name: "Annotate preview" }));

    await vi.waitFor(() => expect(onSendAnnotation).toHaveBeenCalledWith(picked, null));
    expect(mocks.addPreviewAnnotation).toHaveBeenCalledWith(TEST_THREAD_REF, picked);
  });

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

  it("does not reopen a cancelled picker after the permission update finishes", async () => {
    setup();
    let finishUpdate: (() => void) | undefined;
    mocks.setAnnotationSendEnabled.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishUpdate = resolve;
        }),
    );
    await using _screen = await render(view());
    await userEvent.click(page.getByRole("button", { name: "Annotate preview" }));
    await vi.waitFor(() => expect(finishUpdate).toBeDefined());
    expect(mocks.pickElement).not.toHaveBeenCalled();
    await userEvent.click(page.getByRole("button", { name: "Cancel annotation" }));
    expect(mocks.cancelPickElement).toHaveBeenCalledWith(TEST_RUNTIME_TAB_ID);
    await act(async () => finishUpdate!());
    expect(mocks.pickElement).not.toHaveBeenCalled();
    expect(mocks.addPreviewAnnotation).not.toHaveBeenCalled();
  });

  it("warns when main dropped the crop before handing over the pick", async () => {
    setup();
    const picked = annotation("annotation-3");
    const onSendAnnotation = vi.fn();
    mocks.pickElement.mockResolvedValue({
      annotation: picked,
      submission: "send",
      screenshotFailed: true,
    });
    await using _screen = await render(view(onSendAnnotation));
    await userEvent.click(page.getByRole("button", { name: "Annotate preview" }));

    await vi.waitFor(() => expect(onSendAnnotation).toHaveBeenCalledWith(picked, null));
    expect(mocks.toast).toHaveBeenCalledOnce();
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
});

vi.mock(import("~/state/entities"), async (original) => ({
  ...(await original()),
  useThreadShell: (() =>
    mocks.projectId ? { projectId: ProjectId.make(mocks.projectId) } : null) as never,
}));
describe("PreviewView navigation", () => {
  it("publishes pending visits after project hydration and shares history only within the same environment and project", async () => {
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
      mocks.projectId = "project-a";
      await act(() =>
        root.rerender(<PreviewView threadRef={TEST_THREAD_REF} tabId="tab-1" visible />),
      );
      expect(
        history.useBrowserHistoryStore.getState().byProjectKey["environment-1:project-a"],
      ).toEqual([{ url: "http://localhost:3000/one", lastVisitedAt: 123 }]);
      await act(() =>
        root.rerender(<PreviewView threadRef={secondThread} tabId="tab-1" visible />),
      );
      await act(() => history.recordVisitForThread(secondThread, "http://localhost:3000/two", 124));
      expect(
        history.useBrowserHistoryStore
          .getState()
          .byProjectKey["environment-1:project-a"]?.map((entry) => entry.url),
      ).toEqual(["http://localhost:3000/two", "http://localhost:3000/one"]);
      await act(() =>
        root.rerender(<PreviewView threadRef={remoteThread} tabId="tab-1" visible />),
      );
      await act(() =>
        history.recordVisitForThread(remoteThread, "http://localhost:3000/remote", 125),
      );
      expect(
        history.useBrowserHistoryStore.getState().byProjectKey["other-environment:project-a"],
      ).toEqual([{ url: "http://localhost:3000/remote", lastVisitedAt: 125 }]);
      expect(
        history.useBrowserHistoryStore.getState().byProjectKey["environment-1:project-a"],
      ).toHaveLength(2);
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
    const draftLookup = vi
      .spyOn(useComposerDraftStore.getState(), "getDraftThreadByRef")
      .mockReturnValue({ projectId: ProjectId.make("draft-project") } as never);
    await using root = await render(null, { router: false });
    try {
      await act(() =>
        root.rerender(<PreviewView threadRef={TEST_THREAD_REF} tabId="tab-1" visible />),
      );
      await act(() =>
        history.recordVisitForThread(TEST_THREAD_REF, "http://localhost:3000/draft", 126),
      );
      mocks.projectId = "draft-project";
      await act(() =>
        root.rerender(<PreviewView threadRef={TEST_THREAD_REF} tabId="tab-1" visible />),
      );
      expect(
        history.useBrowserHistoryStore.getState().byProjectKey["environment-1:draft-project"],
      ).toEqual([{ url: "http://localhost:3000/draft", lastVisitedAt: 126 }]);
    } finally {
      await act(() => root.unmount());
      history.resetBrowserHistoryForTests();
      draftLookup.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
