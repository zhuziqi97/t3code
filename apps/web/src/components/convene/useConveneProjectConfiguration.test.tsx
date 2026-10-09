import { ProjectId, EnvironmentId, type ConveneProjectConfiguration } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, expect, it, vi } from "vite-plus/test";

const model = vi.hoisted(() => ({
  query: vi.fn(),
  mutate: vi.fn(),
  online: true,
  commands: { query: {}, mutate: {} },
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => true }));
vi.mock("~/state/convene", () => ({
  conveneEnvironment: {
    queryProject: model.commands.query,
    mutateProject: { ...model.commands.mutate, permissionAtom: () => true },
  },
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) =>
    command === model.commands.query ? model.query : model.mutate,
}));
vi.mock("./ConveneConnectionPanel", () => ({
  useConveneStatus: () =>
    AsyncResult.success({
      phase: model.online ? "online" : "offline",
      baseUrl: "http://localhost",
      runnerId: "runner",
      error: null,
    }),
}));
import { useConveneProjectConfiguration } from "./useConveneProjectConfiguration";

const projectId = ProjectId.make("local-project");
const environmentId = EnvironmentId.make("local-environment");
const configuration: ConveneProjectConfiguration = {
  runner_id: "runner",
  runner_name: "Laptop",
  client_project_id: "client-project",
  project: { native_project_id: projectId, display_name: "Local" },
  targets: [],
  bindings: [],
  mcp_enabled: false,
  mcp_scope_modules: [],
  mcp_capabilities: { forge_enabled: false, code_graph_enabled: false, issue_enabled: false },
  mcp_scope_details: [],
  binding_module_details: [],
};
let state: ReturnType<typeof useConveneProjectConfiguration>;
let renderer: ReactTestRenderer;
let mounted = false;
function Harness() {
  state = useConveneProjectConfiguration(environmentId, projectId);
  return null;
}
async function mount() {
  await act(async () => {
    renderer = create(<Harness />);
  });
  mounted = true;
}
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  model.online = true;
  model.query
    .mockReset()
    .mockResolvedValue(AsyncResult.success({ configuration, fresh: true, error: null }));
  model.mutate.mockReset().mockResolvedValue(AsyncResult.success(configuration));
});
afterEach(async () => {
  if (mounted) {
    await act(async () => renderer.unmount());
    mounted = false;
  }
  vi.unstubAllGlobals();
});

it("does not submit an unchanged configuration and preserves a local MCP draft across refresh, association changes and reopening", async () => {
  await mount();
  await act(async () => {
    await state.save();
  });
  expect(model.mutate).not.toHaveBeenCalled();
  await act(async () =>
    state.edit({
      ...state.draft!,
      enabled: true,
      scope: [{ module_id: "independent-module", permission: "WRITE" }],
    }),
  );
  await act(async () => state.refresh());
  expect(state.dirty).toBe(true);
  expect(state.draft?.scope).toEqual([{ module_id: "independent-module", permission: "WRITE" }]);
  await act(async () => state.run({ operation: "bind", projectId, module_id: "execution-module" }));
  expect(state.draft?.enabled).toBe(true);
  expect(model.mutate.mock.calls[0]?.[0].input).toEqual({
    operation: "bind",
    projectId,
    module_id: "execution-module",
  });
  await act(async () => renderer.unmount());
  mounted = false;
  await mount();
  expect(state.dirty).toBe(true);
  expect(state.draft?.scope[0]?.module_id).toBe("independent-module");
});

it("keeps a failed save draft, makes no offline writes and saves the latest edit when explicitly retried", async () => {
  await mount();
  await act(async () => state.edit({ ...state.draft!, enabled: true }));
  model.mutate.mockResolvedValueOnce(
    AsyncResult.failure(Cause.fail(new Error("Platform unavailable"))),
  );
  await act(async () => state.save());
  expect(state.error).toContain("Platform unavailable");
  expect(state.lastOperation?.operation).toBe("save");
  expect(state.dirty).toBe(true);
  model.online = false;
  model.query.mockResolvedValue(
    AsyncResult.success({ configuration, fresh: false, error: "Offline" }),
  );
  await act(async () => renderer.update(<Harness />));
  await act(async () => state.run({ operation: "bind", projectId, module_id: "another-module" }));
  expect(model.mutate).toHaveBeenCalledTimes(1);
  expect(state.draft?.enabled).toBe(true);
  model.online = true;
  model.query.mockResolvedValue(AsyncResult.success({ configuration, fresh: true, error: null }));
  await act(async () => renderer.update(<Harness />));
  await act(async () =>
    state.edit({
      ...state.draft!,
      capabilities: { ...state.draft!.capabilities, issue_enabled: true },
    }),
  );
  model.mutate.mockResolvedValueOnce(
    AsyncResult.success({
      ...configuration,
      mcp_enabled: true,
      mcp_capabilities: { ...configuration.mcp_capabilities, issue_enabled: true },
    }),
  );
  await act(async () => state.save());
  expect(model.mutate.mock.calls[1]?.[0].input.mcp_capabilities.issue_enabled).toBe(true);
  expect(state.dirty).toBe(false);
  expect(state.lastOperation).toBeNull();
});
