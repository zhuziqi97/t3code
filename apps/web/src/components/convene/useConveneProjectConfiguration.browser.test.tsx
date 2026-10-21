import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../../test/render";
import { ProjectId, EnvironmentId, type ConveneProjectConfiguration } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";

import { useLayoutEffect } from "react";
import { expect, it, vi } from "vite-plus/test";

const model = vi.hoisted(() => ({
  toast: vi.fn(),
  query: vi.fn(),
  mutate: vi.fn(),
  online: true,
  commands: { query: {}, mutate: {} },
}));
vi.mock("../ui/toast", async (original) => ({
  ...(await original<typeof import("../ui/toast")>()),
  toastManager: { add: model.toast },
}));
vi.mock("@effect/atom-react", async (original) => ({
  ...(await original<typeof import("@effect/atom-react")>()),
  useAtomValue: () => true,
}));
vi.mock("~/state/convene", async (original) => ({
  ...(await original<typeof import("~/state/convene")>()),
  conveneEnvironment: {
    queryProject: model.commands.query,
    mutateProject: { ...model.commands.mutate, permissionAtom: () => true },
  },
}));
vi.mock("~/state/use-atom-command", async (original) => ({
  ...(await original<typeof import("~/state/use-atom-command")>()),
  useAtomCommand: (command: unknown) =>
    command === model.commands.query ? model.query : model.mutate,
}));
vi.mock("./ConveneConnectionPanel", async (original) => ({
  ...(await original<typeof import("./ConveneConnectionPanel")>()),
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
let renderer: Screen;
let mounted = false;
function Harness() {
  const value = useConveneProjectConfiguration(environmentId, projectId);
  useLayoutEffect(() => {
    state = value;
  });
  return null;
}
async function mount() {
  await act(async () => {
    renderer = renderStack.use(
      await renderTestUi(null, { container: document.createElement("div"), router: false }),
    );
    await renderer.rerender(<Harness />);
  });
  mounted = true;
}

it("does not submit an unchanged configuration and preserves a local MCP draft across refresh, association changes and reopening", async () => {
  await using _lifecycle = await setupLifecycle();

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
  await act(async () => {
    await state.run({ operation: "bind", projectId, module_id: "execution-module" });
  });
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
  await using _lifecycle = await setupLifecycle();

  await mount();
  await act(async () => state.edit({ ...state.draft!, enabled: true }));
  model.mutate.mockResolvedValueOnce(
    AsyncResult.failure(Cause.fail(new Error("Platform unavailable"))),
  );
  await act(async () => {
    await state.save();
  });
  expect(state.error).toContain("Platform unavailable");
  expect(state.lastOperation?.operation).toBe("save");
  expect(state.dirty).toBe(true);
  model.online = false;
  model.query.mockResolvedValue(
    AsyncResult.success({ configuration, fresh: false, error: "Offline" }),
  );
  await act(async () => renderer.rerender(<Harness />));
  await act(async () => {
    await state.run({ operation: "bind", projectId, module_id: "another-module" });
  });
  expect(model.mutate).toHaveBeenCalledTimes(1);
  expect(state.draft?.enabled).toBe(true);
  model.online = true;
  model.query.mockResolvedValue(AsyncResult.success({ configuration, fresh: true, error: null }));
  await act(async () => renderer.rerender(<Harness />));
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
  await act(async () => {
    await state.save();
  });
  expect(model.mutate.mock.calls[1]?.[0].input.mcp_capabilities.issue_enabled).toBe(true);
  expect(state.dirty).toBe(false);
  expect(state.lastOperation).toBeNull();
});

it("announces new-session activation only after enabling MCP succeeds", async () => {
  await using _lifecycle = await setupLifecycle();

  await mount();
  await act(async () => state.edit({ ...state.draft!, enabled: true }));
  model.mutate.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("offline"))));
  await act(async () => {
    await state.save();
  });
  expect(model.toast).not.toHaveBeenCalled();
  model.mutate.mockResolvedValueOnce(AsyncResult.success({ ...configuration, mcp_enabled: true }));
  await act(async () => {
    await state.save();
  });
  expect(model.toast).toHaveBeenCalledTimes(1);
  expect(model.toast.mock.calls[0]?.[0].title).toContain("new chat");
  await act(async () => {
    await state.save();
  });
  expect(model.toast).toHaveBeenCalledTimes(1);
});

it("keeps the activation notice when a configuration refresh arrives before the save reply", async () => {
  await using _lifecycle = await setupLifecycle();

  await mount();
  await act(async () => state.edit({ ...state.draft!, enabled: true }));
  const enabled = { ...configuration, mcp_enabled: true };
  let finish!: (value: ReturnType<typeof AsyncResult.success<typeof enabled>>) => void;
  model.mutate.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let saving!: ReturnType<typeof state.save>;
  await act(async () => {
    saving = state.save();
  });
  model.query.mockResolvedValueOnce(
    AsyncResult.success({ configuration: enabled, fresh: true, error: null }),
  );
  await act(async () => {
    await state.refresh();
  });
  expect(state.configuration?.mcp_enabled).toBe(true);
  await act(async () => {
    finish(AsyncResult.success(enabled));
    await saving;
  });
  expect(model.toast).toHaveBeenCalledTimes(1);
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    if (mounted) {
      await act(async () => renderer.unmount());
      mounted = false;
    }
    vi.unstubAllGlobals();
  });

  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });

  model.toast.mockReset();
  model.online = true;
  model.query
    .mockReset()
    .mockResolvedValue(AsyncResult.success({ configuration, fresh: true, error: null }));
  model.mutate.mockReset().mockResolvedValue(AsyncResult.success(configuration));

  renderStack = stack.move();
  return renderStack;
}
