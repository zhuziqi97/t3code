import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
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
  const settings = { sidebarProjectGroupingMode: "separate", sidebarProjectGroupingOverrides: {} };
  const defaultRef = { environmentId: "local", projectId: "a" };
  const thread = { environmentId: "local", projectId: "a" };
  return {
    projects,
    available: projects,
    configs,
    settings,
    defaultRef,
    thread,
    legacy: false,
    create: vi.fn(async () => null),
    palette: vi.fn(),
    toast: vi.fn(),
  };
});
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => state.configs }));
vi.mock("../state/server", () => ({ environmentServerConfigsAtom: {} }));
vi.mock("../state/entities", () => ({
  useProjects: () => state.projects,
  readProjects: () => state.available,
}));
vi.mock("../state/environments", () => ({ usePrimaryEnvironmentId: () => "local" }));
vi.mock("./useHandleNewThread", () => ({
  useHandleNewThread: () => ({
    activeThread: state.thread,
    activeDraftThread: null,
    defaultProjectRef: state.defaultRef,
    handleNewThread: state.create,
  }),
}));
vi.mock("./useSettings", () => ({
  useLegacySidebarEnabled: () => state.legacy,
  useClientSettings: () => state.settings,
}));
vi.mock("../commandPaletteBus", () => ({ openCommandPalette: state.palette }));
vi.mock("../components/ui/toast", () => ({
  stackedThreadToast: (value: unknown) => value,
  toastManager: { add: state.toast },
}));
function Probe() {
  const { target, startNewThread } = useSidebarNewThread();
  return (
    <button onClick={startNewThread}>
      {target.kind === "project" ? target.label : target.kind}
    </button>
  );
}
let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.available = state.projects;
  state.legacy = false;
  useUiStateStore.setState({ sidebarProjectScopeKey: "local:/work/b" });
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
async function click() {
  await act(async () => renderer.root.findByType("button").props.onClick());
}

describe("ordinary new thread entry", () => {
  it("labels and creates in B while A remains the viewed conversation", async () => {
    await mount();
    expect(renderer.root.findByType("button").children).toEqual(["B"]);
    await click();
    expect(state.create).toHaveBeenCalledWith({ environmentId: "local", projectId: "b" });
    expect(state.palette).not.toHaveBeenCalled();
  });
  it("uses the live selection when a project row selects and creates in the same event", async () => {
    useUiStateStore.setState({ sidebarProjectScopeKey: "local:/work/a" });
    await mount();
    await act(async () => {
      const start = renderer.root.findByType("button").props.onClick;
      useUiStateStore.getState().setSidebarProjectScopeKey("local:/work/b");
      await start();
    });
    expect(state.create).toHaveBeenCalledWith({ environmentId: "local", projectId: "b" });
  });
  it("offers the project picker in All threads without inheriting A", async () => {
    useUiStateStore.setState({ sidebarProjectScopeKey: null });
    await mount();
    await click();
    expect(state.palette).toHaveBeenCalledWith({ open: "new-thread-in" });
    expect(state.create).not.toHaveBeenCalled();
  });
  it("rechecks the catalog before creation instead of writing into a removed B", async () => {
    await mount();
    state.available = state.projects.slice(0, 1);
    await click();
    expect(state.create).not.toHaveBeenCalled();
    expect(state.palette).toHaveBeenCalledWith({ open: "new-thread-in" });
  });
  it("keeps legacy new threads in the viewed project despite the hidden saved selection", async () => {
    state.legacy = true;
    await mount();
    await click();
    expect(state.create).toHaveBeenCalledWith({ environmentId: "local", projectId: "a" });
  });
  it("reports a creation failure without switching projects", async () => {
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
