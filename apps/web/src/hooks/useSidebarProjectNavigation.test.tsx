import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
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
vi.mock("@tanstack/react-router", () => ({
  useLocation: ({ select }: { select: (location: { pathname: string }) => string }) =>
    select({ pathname: state.pathname }),
}));
vi.mock("./useHandleNewThread", () => ({
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
vi.mock("./useSettings", () => ({
  useLegacySidebarEnabled: () => state.legacy,
  useClientSettings: () => ({
    sidebarProjectGroupingMode: "separate",
    sidebarProjectGroupingOverrides: {},
  }),
}));
vi.mock("../state/environments", () => ({ usePrimaryEnvironmentId: () => "local" }));
vi.mock("../state/entities", () => ({
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
let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.project = "a";
  state.route = "thread-a";
  state.legacy = false;
  state.loaded = true;
  state.pathname = "/local/thread-a";
  useUiStateStore.setState({
    sidebarProjectScopeKey: "local:/work/b",
    projectExpandedById: { "local:/work/b": false },
  });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => {
    renderer = create(<Probe />);
  });
}
async function update() {
  await act(async () => renderer.update(<Probe />));
}

describe("project selection follows navigation, not rerenders", () => {
  it("preserves saved B while restoring and updating an A conversation", async () => {
    state.loaded = false;
    await mount();
    state.loaded = true;
    await update();
    await update();
    expect(useUiStateStore.getState().sidebarProjectScopeKey).toBe("local:/work/b");
    expect(useUiStateStore.getState().projectExpandedById["local:/work/b"]).toBe(false);
  });
  it("selects and expands the destination on a real conversation change", async () => {
    await mount();
    state.route = ThreadId.make("thread-b");
    state.project = "b";
    await update();
    expect(useUiStateStore.getState().sidebarProjectScopeKey).toBe("local:/work/b");
    expect(useUiStateStore.getState().projectExpandedById["local:/work/b"]).toBe(true);
  });
  it("does not overwrite a manual choice when returning from Settings", async () => {
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
    await mount();
    state.route = "next-a";
    state.loaded = false;
    await update();
    expect(useUiStateStore.getState().sidebarProjectScopeKey).toBe("local:/work/b");
    state.loaded = true;
    await update();
    expect(useUiStateStore.getState().sidebarProjectScopeKey).toBe("local:/work/a");
  });
  it("leaves the legacy sidebar independent of the hidden project selection", async () => {
    state.legacy = true;
    await mount();
    state.route = "next-a";
    await update();
    expect(useUiStateStore.getState().sidebarProjectScopeKey).toBe("local:/work/b");
  });
});
