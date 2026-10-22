import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../test/render";

import { useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { useUiStateStore } from "../uiStateStore";
import { useSidebarNewThread } from "./useSidebarNewThread";

const state = vi.hoisted(() => {
  const projects = ["a", "b"].map((id) => ({
    id,
    environmentId: "local",
    title: id.toUpperCase(),
    workspaceRoot: `/work/${id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-10-10",
    updatedAt: "2026-10-10",
  }));
  const configs = new Map();
  const settings = {
    sidebarProjectGroupingMode: "separate",
    sidebarProjectGroupingOverrides: {},
    legacySidebarEnabled: false,
  };
  const defaultRef = { environmentId: "local", projectId: "a" };
  const thread = { environmentId: "local", projectId: "a" };
  return {
    projects,
    available: projects,
    configs,
    settings,
    defaultRef,
    thread,
    create: vi.fn(async () => null),
    palette: vi.fn(),
    toast: vi.fn(),
  };
});
vi.mock("@effect/atom-react", async (original) => ({
  ...(await original<typeof import("@effect/atom-react")>()),
  useAtomValue: () => state.configs,
}));
vi.mock("../state/server", async (original) => ({
  ...(await original<typeof import("../state/server")>()),
  environmentServerConfigsAtom: {},
}));
vi.mock("../state/entities", async (original) => ({
  ...(await original<typeof import("../state/entities")>()),
  useProjects: () => state.projects,
  readProjects: () => state.available,
}));
vi.mock("../state/environments", async (original) => ({
  ...(await original<typeof import("../state/environments")>()),
  usePrimaryEnvironmentId: () => "local",
}));
vi.mock("./useHandleNewThread", async (original) => ({
  ...(await original<typeof import("./useHandleNewThread")>()),
  useHandleNewThread: () => ({
    activeThread: state.thread,
    activeDraftThread: null,
    defaultProjectRef: state.defaultRef,
    handleNewThread: state.create,
  }),
}));
vi.mock("./useSettings", async (original) => ({
  ...(await original<typeof import("./useSettings")>()),
  useClientSettings: () => state.settings,
}));
vi.mock("../commandPaletteBus", async (original) => ({
  ...(await original<typeof import("../commandPaletteBus")>()),
  openCommandPalette: state.palette,
}));
vi.mock("../components/ui/toast", async (original) => ({
  ...(await original<typeof import("../components/ui/toast")>()),
  stackedThreadToast: (value: unknown) => value,
  toastManager: { add: state.toast },
}));
let currentStart!: () => Promise<void>;
let container: HTMLDivElement;
function Probe() {
  const { target, startNewThread } = useSidebarNewThread();
  useLayoutEffect(() => {
    currentStart = startNewThread;
  });
  return (
    <button onClick={startNewThread}>
      {target.kind === "project" ? target.label : target.kind}
    </button>
  );
}
let renderer: Screen;

async function mount() {
  await act(async () => {
    container = document.createElement("div");
    renderer = renderStack.use(await renderTestUi(null, { container: container }));
    await renderer.rerender(<Probe />);
  });
}
async function click() {
  await act(async () => container.querySelector("button")!.click());
}

describe("ordinary new thread entry", () => {
  it("labels and creates in B while A remains the viewed conversation", async () => {
    await using _lifecycle = await setupLifecycle();

    await mount();
    expect([container.querySelector("button")!.textContent]).toEqual(["B"]);
    await click();
    expect(state.create).toHaveBeenCalledWith({ environmentId: "local", projectId: "b" });
    expect(state.palette).not.toHaveBeenCalled();
  });
  it("uses the live selection when a project row selects and creates in the same event", async () => {
    await using _lifecycle = await setupLifecycle();

    useUiStateStore.setState({ sidebarProjectScopeKey: "local:/work/a" });
    await mount();
    await act(async () => {
      const start = currentStart;
      useUiStateStore.getState().setSidebarProjectScopeKey("local:/work/b");
      await start();
    });
    expect(state.create).toHaveBeenCalledWith({ environmentId: "local", projectId: "b" });
  });
  it("offers the project picker in All threads without inheriting A", async () => {
    await using _lifecycle = await setupLifecycle();

    useUiStateStore.setState({ sidebarProjectScopeKey: null });
    await mount();
    await click();
    expect(state.palette).toHaveBeenCalledWith({ open: "new-thread-in" });
    expect(state.create).not.toHaveBeenCalled();
  });
  it("rechecks the catalog before creation instead of writing into a removed B", async () => {
    await using _lifecycle = await setupLifecycle();

    await mount();
    state.available = state.projects.slice(0, 1);
    await click();
    expect(state.create).not.toHaveBeenCalled();
    expect(state.palette).toHaveBeenCalledWith({ open: "new-thread-in" });
  });
  it("uses the selected project even when the retired sidebar preference is saved", async () => {
    await using _lifecycle = await setupLifecycle();

    state.settings.legacySidebarEnabled = true;
    await mount();
    await click();
    expect(state.create).toHaveBeenCalledWith({ environmentId: "local", projectId: "b" });
  });
  it("reports a creation failure without switching projects", async () => {
    await using _lifecycle = await setupLifecycle();

    state.create.mockRejectedValueOnce(new Error("target unavailable"));
    await mount();
    await click();
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", description: "target unavailable" }),
    );
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.palette).not.toHaveBeenCalled();
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

  vi.clearAllMocks();
  state.available = state.projects;
  state.settings.legacySidebarEnabled = false;
  useUiStateStore.setState({ sidebarProjectScopeKey: "local:/work/b" });

  renderStack = stack.move();
  return renderStack;
}
