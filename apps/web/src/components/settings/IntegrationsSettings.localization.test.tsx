// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

const state = vi.hoisted(() => ({
  settings: null as ClientSettings | null,
  listeners: new Set<() => void>(),
  update: vi.fn(),
  persist: vi.fn(),
  scan: vi.fn(),
  clearCookies: vi.fn(),
  clearCache: vi.fn(),
  importCookies: vi.fn(),
  clearServer: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("../../env", () => ({ isElectron: true }));
vi.mock("../../hooks/useSettings", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useClientSettings: (selector: (settings: ClientSettings) => unknown) => {
      const settings = useSyncExternalStore(
        (callback) => {
          state.listeners.add(callback);
          return () => state.listeners.delete(callback);
        },
        () => state.settings!,
      );
      return selector(settings);
    },
    getClientSettings: () => state.settings,
    useClientSettingsHydrated: () => true,
    useUpdatePrimarySettings: () => state.update,
    persistClientSettingsUpdate: state.persist,
  };
});
vi.mock("../preview/previewBridge", () => ({
  previewBridge: {
    listBrowserImportSources: state.scan,
    clearCookies: state.clearCookies,
    clearCache: state.clearCache,
    importBrowserCookies: state.importCookies,
  },
}));
const environments = [
  { environmentId: "host-a", label: "Native A", connection: { phase: "connected" } },
  { environmentId: "host-b", label: "Native B", connection: { phase: "connected" } },
];
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments, isReady: true }),
  usePrimaryEnvironment: () => environments[0],
}));
vi.mock("../../state/entities", () => ({
  useServerConfigs: () =>
    new Map(
      environments.map((env) => [
        env.environmentId,
        { environment: { capabilities: { serverBrowser: true } } },
      ]),
    ),
}));
vi.mock("../../state/preview", () => ({ previewEnvironment: { clearProfile: state.clearServer } }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
vi.mock("../../state/session", () => ({
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock("../../state/device", () => ({
  useDeviceState: () => ({
    loaded: false,
    state: { hostStatus: "disabled", hosts: [], devices: [] },
  }),
  deviceEnvironment: { configure: vi.fn(), list: vi.fn() },
}));
vi.mock("./useScopedSettings", () => ({
  useScopedSettings: () => ({ enableDeviceSupport: false, enableAgentDeviceAccess: false }),
  useUpdateScopedSettings: () => vi.fn(),
  useScopedSettingsMixed: () => false,
}));
vi.mock("./SettingsScopeContext", () => ({
  useSettingsScope: () => ({
    environment: null,
    search: {},
    scope: { kind: "all" },
    environments,
    connectedEnvironments: environments,
  }),
}));
vi.mock("./ProjectDefaultsSettings", () => ({ ProjectDefaultsSettings: () => null }));
vi.mock("./DeviceHostsSettings", () => ({ DeviceHostsSettings: () => null }));
vi.mock("./settingsLayout", () => ({
  SettingsRow: ({
    title,
    description,
    control,
    resetAction,
    children,
  }: {
    title: ReactNode;
    description: ReactNode;
    control: ReactNode;
    resetAction: ReactNode;
    children: ReactNode;
  }) => (
    <section>
      {title}
      {description}
      {resetAction}
      {control}
      {children}
    </section>
  ),
  SettingsSection: ({ title, children }: { title: ReactNode; children: ReactNode }) => (
    <section>
      {title}
      {children}
    </section>
  ),
  SettingsPageContainer: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  SettingResetButton: ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button onClick={onClick}>{label}</button>
  ),
}));
vi.mock("../ui/toast", () => ({ toastManager: { add: state.toast } }));

import { changeLanguage } from "../../i18n";
import { IntegrationsSettingsPanel } from "./IntegrationsSettings";

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  await changeLanguage("en");
  state.settings = {
    ...DEFAULT_CLIENT_SETTINGS,
    browserDefaultViewport: { _tag: "freeform", width: 1280, height: 800 },
    browserProfiles: [{ id: "profile-work", name: "Work Raw", kind: "persistent" }],
    browserDefaultProfileId: "profile-work",
  };
  state.update.mockReset().mockImplementation((patch: Partial<ClientSettings>) => {
    state.settings = { ...state.settings!, ...patch };
    state.listeners.forEach((listener) => listener());
  });
  state.persist
    .mockReset()
    .mockImplementation(async (update: (settings: ClientSettings) => ClientSettings) => {
      state.update(update(state.settings!));
      return state.settings;
    });
  state.scan.mockReset().mockResolvedValue([]);
  state.clearCookies.mockReset().mockResolvedValue(undefined);
  state.clearCache.mockReset().mockResolvedValue(undefined);
  state.importCookies.mockReset();
  state.clearServer.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.toast.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLanguage("en");
  vi.unstubAllGlobals();
});
const render = async () => act(async () => root.render(<IntegrationsSettingsPanel />));
const language = async (lang: "en" | "zh") => act(async () => changeLanguage(lang));
function button(label: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]')].find(
    (node) => node.getAttribute("aria-label") === label || node.textContent?.trim() === label,
  );
  expect(found, label).toBeDefined();
  return found!;
}
const click = async (label: string) => act(async () => button(label).click());
async function choose(label: string) {
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (node) => node.textContent?.trim() === label,
  );
  expect(option, label).toBeDefined();
  await act(async () => option!.click());
}
const type = async (input: HTMLInputElement, value: string) =>
  act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

it("keeps an uncommitted viewport width through a locale switch and saves native dimensions and enum values", async () => {
  await render();
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Default viewport width"]',
  )!;
  await type(input, "1440");
  await language("zh");
  expect(container.querySelector('input[aria-label="默认视口宽度"]')).toBe(input);
  expect(input.value).toBe("1440");
  expect(state.update).not.toHaveBeenCalled();
  await act(async () => input.blur());
  expect(state.update).toHaveBeenLastCalledWith({
    browserDefaultViewport: { _tag: "freeform", width: 1440, height: 800 },
  });
  await click("默认浏览器外观");
  await choose("深色");
  expect(state.update).toHaveBeenLastCalledWith({ browserDefaultAppearance: "dark" });
  await click("浏览器录制帧率");
  await choose("60 帧/秒");
  expect(state.update).toHaveBeenLastCalledWith({ browserRecordingFrameRate: 60 });
  await click("链接打开位置");
  await choose("系统默认浏览器");
  expect(state.update).toHaveBeenLastCalledWith({ browserLinkTarget: "system" });
});

it("retains profile rename drafts and scans only when the add menu opens", async () => {
  await render();
  expect(state.scan).not.toHaveBeenCalled();
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Rename Work Raw"]')!;
  await type(input, "Raw Desk");
  await language("zh");
  expect(container.querySelector('input[aria-label="重命名 Work Raw"]')).toBe(input);
  expect(input.value).toBe("Raw Desk");
  expect(state.update).not.toHaveBeenCalled();
  await act(async () => input.blur());
  expect(state.update).toHaveBeenCalledExactlyOnceWith({
    browserProfiles: [{ id: "profile-work", name: "Raw Desk", kind: "persistent" }],
  });
  await click("添加配置");
  expect(state.scan).toHaveBeenCalledTimes(1);
  await language("en");
  expect(state.scan).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).toContain("No supported browsers found");
});

it("cancels removal without writes, then waits for native profile cleanup across environments before removing", async () => {
  let resolve!: (result: unknown) => void;
  state.clearServer.mockImplementationOnce(() => new Promise((done) => (resolve = done)));
  await render();
  await click("Work Raw options");
  await click("Remove profile and data");
  await language("zh");
  expect(document.body.textContent).toContain("移除“Work Raw”？");
  await click("取消");
  expect(state.clearCookies).not.toHaveBeenCalled();
  expect(state.clearServer).not.toHaveBeenCalled();
  await click("Work Raw 的选项");
  await click("移除配置及数据");
  await click("移除配置");
  await language("en");
  expect(button("Removing…").disabled).toBe(true);
  expect(state.update).not.toHaveBeenCalled();
  for (const environmentId of ["host-a", "host-b"]) {
    expect(state.clearCookies).toHaveBeenCalledWith(environmentId, "profile-work");
    expect(state.clearCache).toHaveBeenCalledWith(environmentId, "profile-work");
    expect(state.clearServer).toHaveBeenCalledWith({
      environmentId,
      input: { profileId: "profile-work" },
    });
  }
  expect(state.clearServer).toHaveBeenCalledTimes(2);
  await act(async () => resolve(AsyncResult.success(undefined)));
  expect(state.update).toHaveBeenCalledExactlyOnceWith({
    browserProfiles: [],
    browserDefaultProfileId: "default",
  });
});

it("keeps a failed removal open for retry and retranslates the stored error without deleting settings", async () => {
  state.clearCache.mockRejectedValueOnce(new Error("raw cleanup failure"));
  await render();
  await click("Work Raw options");
  await click("Remove profile and data");
  await click("Remove profile");
  expect(document.body.textContent).toContain("Profile data could not be deleted. Try again.");
  await language("zh");
  expect(document.body.textContent).toContain("无法删除配置数据，请重试。");
  expect(state.update).not.toHaveBeenCalled();
  expect(button("移除配置").disabled).toBe(false);
});

it("confirms clearing the built-in profile and reports completion in the current language", async () => {
  let resolve!: () => void;
  state.clearCache.mockImplementationOnce(() => new Promise<void>((done) => (resolve = done)));
  await render();
  await click("Default options");
  await click("Clear cookies and cache");
  await language("zh");
  expect(document.body.textContent).toContain("清除“默认”的 Cookie 和缓存？");
  await click("清除数据");
  expect(state.toast).not.toHaveBeenCalled();
  await act(async () => resolve());
  expect(state.toast).toHaveBeenCalledExactlyOnceWith({
    type: "success",
    title: "已清除 默认 的 Cookie 和缓存",
  });
  expect(state.update).not.toHaveBeenCalled();
});
