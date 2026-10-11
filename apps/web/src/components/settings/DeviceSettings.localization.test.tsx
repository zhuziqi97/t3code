// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_UNIFIED_SETTINGS,
  EnvironmentId,
  type DeviceServiceState,
  type UnifiedSettings,
} from "@t3tools/contracts";

const api = vi.hoisted(() => ({
  configure: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  test: vi.fn(),
  toast: vi.fn(),
  allowed: true,
  device: null as DeviceServiceState | null,
  settings: null as UnifiedSettings | null,
}));
vi.mock("../../env", () => ({ isElectron: false }));
vi.mock("../../hooks/useSettings", () => ({
  useClientSettings: (selector: (settings: typeof DEFAULT_CLIENT_SETTINGS) => unknown) =>
    selector(DEFAULT_CLIENT_SETTINGS),
  useClientSettingsHydrated: () => true,
  useUpdatePrimarySettings: () => vi.fn(),
  getClientSettings: () => DEFAULT_CLIENT_SETTINGS,
  persistClientSettingsUpdate: vi.fn(),
}));
vi.mock("../../state/device", () => ({
  deviceEnvironment: { configure: api.configure, list: api.list, testHost: api.test },
  useDeviceState: () => ({ loaded: true, state: api.device }),
}));
vi.mock("../../state/server", () => ({ serverEnvironment: { updateSettings: api.update } }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
vi.mock("../../state/session", () => ({
  useEnvironmentScope: () => api.allowed,
  readEnvironmentScope: () => api.allowed,
}));
vi.mock("../../state/preview", () => ({ previewEnvironment: { clearProfile: vi.fn() } }));
vi.mock("../../state/entities", () => ({ useServerConfigs: () => new Map() }));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments: [], isReady: true }),
  usePrimaryEnvironment: () => null,
}));
vi.mock("../preview/previewBridge", () => ({
  previewBridge: { listBrowserImportSources: vi.fn() },
}));
vi.mock("../ui/toast", () => ({ toastManager: { add: api.toast } }));
vi.mock("./ProjectDefaultsSettings", () => ({ ProjectDefaultsSettings: () => null }));
vi.mock("./SettingsScopeContext", () => ({
  useSettingsScope: () => ({
    scope: { kind: "all" },
    search: {},
    environment: environments[0],
    environments,
    connectedEnvironments: environments,
  }),
}));
vi.mock("./useScopedSettings", () => ({
  useScopedSettings: () => api.settings,
  useUpdateScopedSettings: () => vi.fn(),
  useScopedSettingsMixed: () => false,
}));
vi.mock("./settingsLayout", () => ({
  SettingsRow: ({
    title,
    description,
    control,
    resetAction,
    children,
    status,
  }: {
    title: ReactNode;
    description: ReactNode;
    control: ReactNode;
    resetAction: ReactNode;
    children: ReactNode;
    status: ReactNode;
  }) => (
    <section>
      {title}
      {description}
      {resetAction}
      {control}
      {status}
      {children}
    </section>
  ),
  SettingsSection: ({ title, children }: { title: ReactNode; children: ReactNode }) => (
    <section>
      {title}
      {children}
    </section>
  ),
  SettingsUnavailableGroup: ({
    message,
    children,
  }: {
    message: ReactNode;
    children: ReactNode;
  }) => (
    <section>
      {message}
      {children}
    </section>
  ),
  SettingResetButton: () => null,
  SettingsPageContainer: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

import { changeLanguage } from "../../i18n";
import { IntegrationsSettingsPanel } from "./IntegrationsSettings";
import { DeviceHostsSettings } from "./DeviceHostsSettings";

const ids = [EnvironmentId.make("native-a"), EnvironmentId.make("native-b")];
const environments = ids.map((environmentId, index) => ({
  environmentId,
  label: index === 0 ? "Native A" : "Native B",
  connection: { phase: "connected" },
  get serverConfig() {
    return { settings: api.settings };
  },
}));
const host = { id: "raw-host", label: "Raw host", target: "user@raw-host" };
const readyState: DeviceServiceState = {
  hosts: [
    {
      id: "local",
      kind: "local",
      label: "Raw local",
      hubInstalled: true,
      agentDeviceInstalled: true,
      platforms: [{ platform: "ios", available: true }],
      tools: {
        hub: { requiredVersion: "2.0.0", runningVersion: null, installedVersions: ["1.0.0"] },
        agent: { requiredVersion: "9.0.0", runningVersion: null, installedVersions: [] },
      },
    },
  ],
  hostStatus: "ready",
  hostStatuses: {},
  devices: [],
  sessions: [],
  onboardingCompleted: true,
  agentAccessEnabled: false,
  hubBasePath: "/api/device-hub",
  revision: 0,
  supportsToolUpdate: true,
  supportsToolInspection: true,
};
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  await changeLanguage("en");
  api.allowed = true;
  api.device = readyState;
  api.settings = { ...DEFAULT_UNIFIED_SETTINGS, enableDeviceSupport: true, deviceHosts: [] };
  for (const fn of [api.configure, api.list, api.update, api.test])
    fn.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  api.toast.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLanguage("en");
  Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
  vi.unstubAllGlobals();
});
const render = async (node: ReactNode) => act(async () => root.render(node));
const language = async (lang: "en" | "zh") => act(async () => changeLanguage(lang));
function button(label: string) {
  const result = [
    ...document.querySelectorAll<HTMLElement>('button, [role="switch"], [role="menuitem"]'),
  ].find((node) => node.getAttribute("aria-label") === label || node.textContent?.trim() === label);
  expect(result, label).toBeDefined();
  return result! as HTMLButtonElement;
}
const click = async (label: string) => act(async () => button(label).click());
const field = (label: string) => {
  const result = [...document.querySelectorAll("label")]
    .find((node) => node.querySelector("span")?.textContent === label)
    ?.querySelector("input");
  expect(result, label).toBeDefined();
  return result!;
};
const type = async (input: HTMLInputElement, value: string) =>
  act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

it("updates all selected environments once and reports a pending partial failure in the current language", async () => {
  api.settings = { ...api.settings!, enableDeviceSupport: false };
  api.device = { ...readyState, hostStatus: "disabled" };
  const a = deferred<AsyncResult.AsyncResult<undefined, string>>();
  const b = deferred<AsyncResult.AsyncResult<undefined, string>>();
  api.configure.mockImplementation(({ environmentId }: { environmentId: EnvironmentId }) =>
    environmentId === ids[0] ? a.promise : b.promise,
  );
  await render(<IntegrationsSettingsPanel />);
  await click("Device hub");
  expect(api.configure).toHaveBeenCalledTimes(2);
  await language("zh");
  expect(button("设备中心").getAttribute("aria-disabled")).toBe("true");
  expect(api.configure).toHaveBeenCalledTimes(2);
  await act(async () => {
    a.resolve(AsyncResult.success(undefined));
    b.resolve(AsyncResult.failure(Cause.fail("Raw failure")));
  });
  expect(api.configure.mock.calls).toEqual(
    ids.map((environmentId) => [
      { environmentId, input: { enabled: true, onboardingCompleted: true } },
    ]),
  );
  expect(api.toast).toHaveBeenCalledExactlyOnceWith({
    type: "error",
    title: "设备设置未能保存到所有执行环境",
    description: "无法更新 Native B。",
  });
});

it("retranslates a retained update failure without repeating its native tool update", async () => {
  api.list.mockResolvedValue(AsyncResult.failure(Cause.fail("Raw failure")));
  await render(<IntegrationsSettingsPanel />);
  await click("Device hub: version 1.0.0. Show details");
  await click("Update to v2.0.0");
  expect(api.list).toHaveBeenCalledExactlyOnceWith({
    environmentId: ids[0],
    input: { updateTool: "hub" },
  });
  expect(document.body.textContent).toContain(
    "Update failed. Check this host's network connection and try again.",
  );
  await language("zh");
  expect(document.body.textContent).toContain("更新失败，请检查此主机的网络连接后重试。");
  expect(api.list).toHaveBeenCalledOnce();
  await click("更新至 v2.0.0");
  expect(api.list).toHaveBeenCalledTimes(2);
  expect(api.list.mock.calls[1]).toEqual([{ environmentId: ids[0], input: { updateTool: "hub" } }]);
});

it("preserves a pending host draft after partial save failure and closes only after a successful retry", async () => {
  const pending = deferred<AsyncResult.AsyncResult<undefined, string>>();
  api.update.mockReturnValue(pending.promise);
  await render(<DeviceHostsSettings environmentId={ids[0]!} />);
  await click("Add host");
  const name = field("Name");
  await type(name, "Raw new host");
  await type(field("SSH target"), "dev@new-host");
  await click("Save host");
  expect(api.update).toHaveBeenCalledTimes(2);
  await language("zh");
  expect(field("名称")).toBe(name);
  expect(name.value).toBe("Raw new host");
  expect(button("保存主机").disabled).toBe(true);
  expect(api.update).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve(AsyncResult.failure(Cause.fail("Raw failure"))));
  expect(name.isConnected).toBe(true);
  expect(button("保存主机").disabled).toBe(false);
  expect(api.toast).toHaveBeenCalledExactlyOnceWith({
    type: "error",
    title: "设备主机未能保存到所有执行环境",
    description: "无法更新 Native A, Native B。",
  });
  const native = api.update.mock.calls[0]![0].input.patch.deviceHosts[0];
  expect(native).toMatchObject({ label: "Raw new host", target: "dev@new-host" });
  api.update.mockResolvedValue(AsyncResult.success(undefined));
  await click("保存主机");
  expect(api.update).toHaveBeenCalledTimes(4);
  expect(api.update.mock.calls[2]).toEqual(api.update.mock.calls[0]);
  expect(api.update.mock.calls[3]).toEqual(api.update.mock.calls[1]);
  expect(name.isConnected).toBe(false);
});

it("reports host connection results in the current language without repeating probes", async () => {
  api.settings = { ...api.settings!, deviceHosts: [host] };
  const pending = deferred<
    AsyncResult.AsyncResult<
      {
        id: string;
        label: string;
        kind: "local";
        platforms: [];
        hubInstalled: boolean;
        agentDeviceInstalled: boolean;
      },
      string
    >
  >();
  api.test.mockReturnValue(pending.promise);
  await render(<DeviceHostsSettings environmentId={ids[0]!} />);
  await click("Test connection");
  expect(api.test).toHaveBeenCalledTimes(2);
  await language("zh");
  expect(api.test).toHaveBeenCalledTimes(2);
  await act(async () =>
    pending.resolve(
      AsyncResult.success({
        ...host,
        kind: "local",
        platforms: [],
        hubInstalled: true,
        agentDeviceInstalled: false,
      }),
    ),
  );
  expect(api.toast).toHaveBeenCalledExactlyOnceWith({
    type: "success",
    title: "Raw host：连接检查通过",
    description: "所有所选执行环境均已连接，或可直接在本机使用。",
  });
  expect(api.test.mock.calls).toEqual(ids.map((environmentId) => [{ environmentId, input: host }]));
});
