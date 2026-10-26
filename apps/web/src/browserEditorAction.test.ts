import {
  AuthFilesystemWriteScope,
  AuthTerminalOperateScope,
  EnvironmentId,
  ProjectId,
  ThreadId,
  type ConveneProjectConfiguration,
  type ConveneStatus,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  allowed: new Set<string>(),
  status: null as ConveneStatus | null,
  configuration: null as ConveneProjectConfiguration | null,
  fresh: true,
  mountedPath: "",
  open: vi.fn(),
  query: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => (state.status ? AsyncResult.success(state.status) : AsyncResult.initial()),
}));
vi.mock("./state/entities", () => ({ useThreadShell: () => null }));
vi.mock("./state/convene", () => ({
  conveneEnvironment: { status: (input: unknown) => input, projectView: (input: unknown) => input },
}));
vi.mock("./state/query", () => ({
  useEnvironmentQuery: (input: unknown) => {
    state.query(input);
    return { data: { fresh: state.fresh, configuration: state.configuration }, isPending: false };
  },
}));
vi.mock("./state/session", () => ({
  useEnvironmentScope: (id: string, scope: string) => state.allowed.has(`${id}:${scope}`),
  readEnvironmentScope: (id: string, scope: string) => state.allowed.has(`${id}:${scope}`),
}));
vi.mock("./i18n", () => ({ useTranslate: () => (key: string) => key }));
vi.mock("./localApi", () => ({ readLocalApi: () => ({ shell: { openExternal: state.open } }) }));
vi.mock("./webBasePath", () => ({ webBasePath: () => state.mountedPath }));

import { useBrowserEditorAction } from "./browserEditorAction";

const environmentId = EnvironmentId.make("remote");
const projectId = ProjectId.make("project");
const threadId = ThreadId.make("thread");
const workspace = { projectId, threadId, workspacePath: "/work/tree" };

beforeEach(() => {
  state.allowed.clear();
  state.allowed.add(`${environmentId}:${AuthFilesystemWriteScope}`);
  state.allowed.add(`${environmentId}:${AuthTerminalOperateScope}`);
  state.status = {
    phase: "online",
    baseUrl: "https://platform.example",
    runnerId: "runner",
    error: null,
    platformUrls: [],
  };
  state.configuration = {
    runner_id: "runner",
    runner_name: "Remote",
    client_project_id: "client-project",
    project: { native_project_id: projectId, display_name: "Project" },
    targets: [
      {
        target_id: "tree",
        native_workspace_key: "tree-key",
        path: "/work/tree",
        workspace_display_name: "Tree",
        branch: null,
        availability: "AVAILABLE",
      },
    ],
    bindings: [],
    mcp_enabled: false,
    mcp_scope_modules: [],
    mcp_scope_details: [],
    binding_module_details: [],
    mcp_capabilities: { forge_enabled: false, issue_enabled: false, code_graph_enabled: false },
  };
  state.fresh = true;
  state.mountedPath = "";
  state.open.mockReset().mockResolvedValue(undefined);
  state.query.mockReset();
  vi.stubGlobal("window", { location: { origin: "https://lan.example" } });
});
afterEach(() => vi.unstubAllGlobals());

it("opens the executing environment and worktree in a fresh outer-page URL", async () => {
  const action = useBrowserEditorAction(environmentId, workspace);
  expect(action.unavailableReason).toBeNull();
  await action.open("/work/tree/src/main.ts:17:6", true);
  expect(state.query).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { projectId, threadId, workspacePath: "/work/tree" },
  });
  const url = new URL(state.open.mock.calls[0]![0]);
  expect(url.origin).toBe("https://platform.example");
  expect(url.pathname).toBe("/clients/runner/ide");
  expect([...url.searchParams]).toEqual([
    ["projectId", projectId],
    ["workspaceKey", "tree-key"],
    ["file", "src/main.ts"],
    ["line", "17"],
    ["column", "6"],
  ]);
});

it("keeps the mounted origin instead of swapping LAN for the configured public origin", async () => {
  state.mountedPath = "/clients/runner/web";
  await useBrowserEditorAction(environmentId, workspace).open("/work/tree", false);
  expect(new URL(state.open.mock.calls[0]![0]).origin).toBe("https://lan.example");
});

it.each([AuthFilesystemWriteScope, AuthTerminalOperateScope])(
  "checks %s again on a retained action",
  async (scope) => {
    const action = useBrowserEditorAction(environmentId, workspace);
    state.allowed.delete(`${environmentId}:${scope}`);
    state.allowed.add(`another:${scope}`);
    await expect(action.open("/work/tree/main.ts", true)).rejects.toThrow("convene.ide.denied");
    expect(state.open).not.toHaveBeenCalled();
    expect(useBrowserEditorAction(environmentId, workspace).unavailableReason).toBe(
      "convene.ide.denied",
    );
  },
);

it("reports missing workspace, disconnected and stale configuration separately", () => {
  expect(useBrowserEditorAction(environmentId).unavailableReason).toBe(
    "chat.editor.workspaceRequired",
  );
  state.status = null;
  expect(useBrowserEditorAction(environmentId, workspace).unavailableReason).toBe(
    "convene.ide.disconnected",
  );
  state.status = {
    phase: "online",
    baseUrl: "https://platform.example",
    runnerId: "runner",
    error: null,
    platformUrls: [],
  };
  state.fresh = false;
  expect(useBrowserEditorAction(environmentId, workspace).unavailableReason).toBe(
    "convene.ide.unavailable",
  );
});

it("rejects workspace-external attachments and application configuration files", async () => {
  const action = useBrowserEditorAction(environmentId, workspace);
  for (const path of ["/attachments/image.png", "/home/me/.t3/keybindings.json"])
    await expect(action.open(path, true)).rejects.toThrow("chat.editor.outsideWorkspace");
  expect(state.open).not.toHaveBeenCalled();
});
