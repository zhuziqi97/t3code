import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";

import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useUiStateStore } from "../uiStateStore";
import { useSidebarProjectNavigation } from "./useSidebarProjectNavigation";

const state = vi.hoisted(() => ({
  project: "a" as string | null,
  route: "thread-a" as string | null,
  legacy: false,
  loaded: true,
  pathname: "/local/thread-a",
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useLocation: ({ select }: { select: (location: { pathname: string }) => string }) =>
    select({ pathname: state.pathname }),
}));
vi.mock("./useHandleNewThread", async (original) => ({
  ...(await original<typeof import("./useHandleNewThread")>()),
  useHandleNewThread: () => ({
    routeThreadRef: state.route ? { environmentId: "local", threadId: state.route } : null,
    routeDraftId: null,
    activeThread:
      state.loaded && state.route && state.project
        ? { environmentId: "local", projectId: state.project }
        : null,
    activeDraftThread: null,
  }),
}));
vi.mock("./useSettings", async (original) => ({
  ...(await original<typeof import("./useSettings")>()),
  useClientSettings: () => ({
    legacySidebarEnabled: state.legacy,
    sidebarProjectGroupingMode: "separate",
    sidebarProjectGroupingOverrides: {},
  }),
}));
vi.mock("../state/environments", async (original) => ({
  ...(await original<typeof import("../state/environments")>()),
  usePrimaryEnvironmentId: () => "local",
}));
vi.mock("../state/entities", async (original) => ({
  ...(await original<typeof import("../state/entities")>()),
  useProjects: () =>
    ["a", "b"].map((id) => ({
      id: ProjectId.make(id),
      environmentId: EnvironmentId.make("local"),
      title: id,
      workspaceRoot: `/work/${id}`,
      repositoryIdentity: null,
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-10-10",
      updatedAt: "2026-10-10",
    })),
}));

function Probe() {
  useSidebarProjectNavigation();
  return null;
}
let renderer: Screen;

async function mount() {
  await act(async () => {
    renderer = renderStack.use(
      await renderTestUi(null, { container: document.createElement("div"), router: false }),
    );
    await renderer.rerender(<Probe />);
  });
}
async function update() {
  await act(async () => renderer.rerender(<Probe />));
}

describe("project selection follows navigation, not rerenders", () => {
  it("preserves saved B while restoring and updating an A conversation", async () => {
    await using _lifecycle = await setupLifecycle();

    state.loaded = false;
    await mount();
    state.loaded = true;
    await update();
    await update();
    expect(useUiStateStore.getState().sidebarProjectScopeKey).toBe("local:/work/b");
    expect(useUiStateStore.getState().projectExpandedById["local:/work/b"]).toBe(false);
  });
  it("selects and expands the destination on a real conversation change", async () => {
    await using _lifecycle = await setupLifecycle();

    await mount();
    state.route = ThreadId.make("thread-b");
    state.project = "b";
    await update();
    expect(useUiStateStore.getState().sidebarProjectScopeKey).toBe("local:/work/b");
    expect(useUiStateStore.getState().projectExpandedById["local:/work/b"]).toBe(true);
  });
  it("does not overwrite a manual choice when returning from Settings", async () => {
    await using _lifecycle = await setupLifecycle();

    await mount();
    state.route = null;
    state.project = null;
    state.pathname = "/settings/general";
    await update();
    // The location changes before the route params finish resolving.
    state.pathname = "/local/thread-a";
    await update();
    state.route = "thread-a";
    state.project = "a";
    state.pathname = "/local/thread-a";
    await update();
    expect(useUiStateStore.getState().sidebarProjectScopeKey).toBe("local:/work/b");
  });
  it("selects the conversation project when history returns from the global home page", async () => {
    await using _lifecycle = await setupLifecycle();

    await mount();
    useUiStateStore.getState().setSidebarProjectScopeKey(null);
    state.route = null;
    state.project = null;
    state.pathname = "/";
    await update();
    state.route = "thread-a";
    state.project = "a";
    state.pathname = "/local/thread-a";
    await update();
    expect(useUiStateStore.getState().sidebarProjectScopeKey).toBe("local:/work/a");
    expect(useUiStateStore.getState().projectExpandedById["local:/work/a"]).toBe(true);
  });
  it("waits for a navigated conversation to load before selecting its project", async () => {
    await using _lifecycle = await setupLifecycle();

    await mount();
    state.route = "next-a";
    state.loaded = false;
    await update();
    expect(useUiStateStore.getState().sidebarProjectScopeKey).toBe("local:/work/b");
    state.loaded = true;
    await update();
    expect(useUiStateStore.getState().sidebarProjectScopeKey).toBe("local:/work/a");
  });
  it("reveals the routed project even when the retired sidebar preference is saved", async () => {
    await using _lifecycle = await setupLifecycle();

    state.legacy = true;
    await mount();
    state.route = "next-a";
    await update();
    expect(useUiStateStore.getState().sidebarProjectScopeKey).toBe("local:/work/a");
  });
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    if (renderer) await act(async () => renderer.unmount());
    vi.unstubAllGlobals();
  });

  state.project = "a";
  state.route = "thread-a";
  state.legacy = false;
  state.loaded = true;
  state.pathname = "/local/thread-a";
  useUiStateStore.setState({
    sidebarProjectScopeKey: "local:/work/b",
    projectExpandedById: { "local:/work/b": false },
  });

  renderStack = stack.move();
  return renderStack;
}
