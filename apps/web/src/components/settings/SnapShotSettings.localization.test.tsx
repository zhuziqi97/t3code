// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  DEFAULT_CLIENT_SETTINGS,
  type ClientSettings,
  type ClientSettingsPatch,
  type DesktopSnapShotState,
  type DesktopCaptureConfigPreview,
} from "@t3tools/contracts";
import { parseKeybindingShortcut } from "@t3tools/shared/keybindings";

const api = vi.hoisted(() => ({
  settings: null as ClientSettings | null,
  state: null as DesktopSnapShotState | null,
  listeners: new Set<() => void>(),
  get: vi.fn(),
  events: vi.fn(),
  suppress: vi.fn(),
  check: vi.fn(),
  update: vi.fn(),
  permissions: vi.fn(),
  setup: vi.fn(),
  preview: vi.fn(),
  apply: vi.fn(),
  sound: vi.fn(),
  toast: vi.fn(),
  copy: vi.fn(),
}));
const bridge = {
  getSnapShotState: api.get,
  onSnapShotEvent: api.events,
  setSnapShotShortcutSuppressed: api.suppress,
  checkSnapShotShortcut: api.check,
  requestSnapShotPermissions: api.permissions,
  setupSnapShot: api.setup,
  previewSnapShotConfig: api.preview,
  applySnapShotConfig: api.apply,
};
vi.mock("../../lib/desktopSnapShot", () => ({ getDesktopSnapShotBridge: () => bridge }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => [] }));
vi.mock("../../state/server", () => ({ primaryServerKeybindingsAtom: {} }));
vi.mock("../../hooks/useSettings", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useClientSettings: () =>
      useSyncExternalStore(
        (listener) => {
          api.listeners.add(listener);
          return () => api.listeners.delete(listener);
        },
        () => api.settings!,
      ),
    useUpdateClientSettings: () => api.update,
  };
});
vi.mock("../../lib/snapShotSound", () => ({ playSnapShotSound: api.sound }));
vi.mock("../../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("../../hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({ copyToClipboard: api.copy, isCopied: false }),
}));
vi.mock("../ui/toast", () => ({ toastManager: { add: api.toast } }));
// Diff parsing stays real. These tests exercise config approval, not the vendor's renderer.
vi.mock("@pierre/diffs/react", () => ({ FileDiff: () => <div data-testid="config-diff" /> }));
vi.mock("./settingsLayout", () => ({
  SettingsPageContainer: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  SettingsSection: ({ title, children }: { title: ReactNode; children: ReactNode }) => (
    <section>
      {title}
      {children}
    </section>
  ),
  SettingsUnavailableGroup: ({
    children,
    message,
  }: {
    children: ReactNode;
    message: ReactNode;
  }) => (
    <section>
      {message}
      {children}
    </section>
  ),
  SettingsRow: ({
    title,
    description,
    status,
    control,
  }: {
    title: ReactNode;
    description: ReactNode;
    status: ReactNode;
    control: ReactNode;
  }) => (
    <section>
      {title}
      {description}
      <div role="status">{status}</div>
      {control}
    </section>
  ),
}));

import { changeLanguage } from "../../i18n";
import { SnapShotSettings } from "./SnapShotSettings";
import { CaptureShortcutConfig } from "./CaptureShortcutConfig";

const direct: DesktopSnapShotState = {
  mode: "direct",
  windows: true,
  shortcut: parseKeybindingShortcut("ctrl+shift+2")!,
  shortcutRegistered: true,
  shortcutMessage: null,
  message: null,
};
const niri: DesktopSnapShotState = {
  ...direct,
  mode: "portal",
  windows: undefined,
  linuxBackend: "niri",
  shortcutActionRegistered: true,
  shortcutBinding: 'Ctrl+Shift+2 { spawn "raw-command"; }',
  shortcutConfigPath: "/Raw Dir/config.kdl",
};
const preview: DesktopCaptureConfigPreview = {
  id: "native-review",
  path: "/Raw Dir/config.kdl",
  resolvedPath: "/Real Dir/config.kdl",
  before: "binds {\n}\n",
  after: 'binds {\n  Ctrl+Alt+Y { spawn "raw-command"; }\n}\n',
  shortcut: "Ctrl+Alt+Y",
  operation: "install",
};
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
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  await changeLanguage("en");
  api.settings = {
    ...DEFAULT_CLIENT_SETTINGS,
    snapShotEnabled: true,
    snapShotIncludeAccessibility: true,
  };
  api.state = direct;
  for (const fn of [
    api.get,
    api.events,
    api.suppress,
    api.check,
    api.update,
    api.permissions,
    api.setup,
    api.preview,
    api.apply,
    api.sound,
    api.toast,
    api.copy,
  ])
    fn.mockReset();
  api.get.mockImplementation(async () => api.state);
  api.events.mockReturnValue(() => {});
  api.suppress.mockResolvedValue(undefined);
  api.check.mockResolvedValue({ available: true, message: null });
  api.permissions.mockResolvedValue(undefined);
  api.setup.mockResolvedValue(undefined);
  api.update.mockImplementation(async (patch: ClientSettingsPatch) => {
    persist(patch);
  });
  api.preview.mockResolvedValue(preview);
  api.apply.mockResolvedValue({ backupPath: "/Raw Dir/config.backup", warning: null });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLanguage("en");
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
});
function persist(patch: ClientSettingsPatch) {
  api.settings = { ...api.settings!, ...patch };
  api.state = { ...api.state!, shortcut: api.settings.snapShotShortcut };
  for (const listener of api.listeners) listener();
}
const render = async (node: ReactNode) => act(async () => root.render(node));
const language = async (lang: "en" | "zh") => act(async () => changeLanguage(lang));
function button(label: string) {
  const result = [
    ...document.querySelectorAll<HTMLElement>(
      'button, [role="switch"], [role="menuitem"], [role="menuitemradio"]',
    ),
  ].find((node) => node.getAttribute("aria-label") === label || node.textContent?.trim() === label);
  expect(result, label).toBeDefined();
  return result!;
}
const click = async (label: string) => act(async () => button(label).click());
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const key = async (node: HTMLElement, init: KeyboardEventInit) =>
  act(async () => node.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init })));
function recorder() {
  const result = document.querySelector<HTMLElement>("[data-keybinding-capture]");
  expect(result).not.toBeNull();
  return result!;
}

it("retains a recording and pending availability check through language changes and saves only native keys", async () => {
  const check = deferred<{ available: boolean; message: null }>();
  api.check.mockReturnValue(check.promise);
  await render(<SnapShotSettings />);
  expect(api.get).toHaveBeenCalledOnce();
  expect(api.events).toHaveBeenCalledOnce();
  const input = recorder();
  await act(async () => input.focus());
  await click("Record snapshot shortcut, currently Ctrl+Shift+2");
  expect(api.suppress).toHaveBeenCalledExactlyOnceWith(true);
  await language("zh");
  expect(recorder()).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(input.textContent).toBe("请按下快捷键…");
  expect(api.suppress).toHaveBeenCalledOnce();
  expect(api.get).toHaveBeenCalledOnce();
  expect(api.events).toHaveBeenCalledOnce();
  await key(input, { key: "y", code: "KeyY", ctrlKey: true, altKey: true });
  const native = {
    key: "y",
    metaKey: false,
    ctrlKey: false,
    modKey: true,
    altKey: true,
    shiftKey: false,
  };
  expect(api.check).toHaveBeenCalledExactlyOnceWith(native);
  expect(api.suppress).toHaveBeenLastCalledWith(false);
  await language("en");
  expect(api.check).toHaveBeenCalledOnce();
  expect(document.body.textContent).toContain("Checking shortcut…");
  expect((button("Save") as HTMLButtonElement).disabled).toBe(true);
  await act(async () => check.resolve({ available: true, message: null }));
  const save = deferred<void>();
  api.update.mockImplementation(async (patch: ClientSettingsPatch) => {
    await save.promise;
    persist(patch);
  });
  await click("Save");
  await language("zh");
  expect((button("正在保存…") as HTMLButtonElement).disabled).toBe(true);
  expect(api.update).toHaveBeenCalledExactlyOnceWith({ snapShotShortcut: native });
  await act(async () => save.resolve());
  expect(api.update).toHaveBeenCalledOnce();
  expect(api.get).toHaveBeenCalledTimes(2);
  expect(api.events).toHaveBeenCalledOnce();
  expect(api.settings!.snapShotShortcut).toEqual(native);
});

it("uses native sound ids for localized choices and previews and reports asynchronous failures in the current language", async () => {
  await render(<SnapShotSettings />);
  await language("zh");
  await click("快照声音：风声（默认）");
  await click("试听快门声");
  expect(api.sound).toHaveBeenCalledExactlyOnceWith("camera-shutter");
  expect(api.update).not.toHaveBeenCalled();
  await click("快门声");
  expect(api.update).toHaveBeenCalledExactlyOnceWith({
    snapShotPlaySound: true,
    snapShotSound: "camera-shutter",
  });
  const save = deferred<void>();
  api.update.mockReturnValueOnce(save.promise);
  await click("闪烁快照窗口");
  const patch = api.update.mock.calls[1]![0];
  expect(patch).toEqual({ snapShotFlash: !DEFAULT_CLIENT_SETTINGS.snapShotFlash });
  await language("en");
  await act(async () => save.reject(new Error("Raw disk failure")));
  expect(api.toast).toHaveBeenCalledExactlyOnceWith({
    type: "error",
    title: "Couldn't save capture settings",
    description: "Raw disk failure",
  });
  await language("zh");
  expect(api.toast).toHaveBeenCalledOnce();
  expect(api.update).toHaveBeenCalledTimes(2);
});

it("keeps wizard progress and restores disabled capture when setup is postponed", async () => {
  api.settings = { ...api.settings!, snapShotEnabled: false };
  api.state = { ...direct, windows: undefined, shortcutRegistered: false };
  await render(<SnapShotSettings />);
  await click("Enable snapshots");
  expect(api.update).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Allow snapshots");
  await click("Allow capture");
  expect(api.permissions).toHaveBeenCalledExactlyOnceWith(true);
  expect(api.update).toHaveBeenCalledExactlyOnceWith({ snapShotEnabled: true });
  await language("zh");
  expect(document.body.textContent).toContain("选择快捷键");
  expect(api.permissions).toHaveBeenCalledOnce();
  expect(api.update).toHaveBeenCalledOnce();
  await click("稍后完成");
  expect(api.update).toHaveBeenCalledTimes(2);
  expect(api.update.mock.calls[1]).toEqual([{ snapShotEnabled: false }]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(api.settings!.snapShotEnabled).toBe(false);
});

it("keeps config review and recorded keys through language changes and applies one approved preview", async () => {
  const read = deferred<DesktopCaptureConfigPreview>();
  api.preview.mockReturnValueOnce(read.promise);
  const complete = vi.fn().mockResolvedValue(undefined);
  await render(<CaptureShortcutConfig state={niri} onComplete={complete} />);
  const input = recorder();
  await act(async () => input.focus());
  await click("Record snapshot shortcut, currently Ctrl+Shift+2");
  await language("zh");
  expect(recorder()).toBe(input);
  expect(api.suppress).toHaveBeenCalledExactlyOnceWith(true);
  await key(input, { key: "y", code: "KeyY", ctrlKey: true, altKey: true });
  await click("查看修改");
  expect(api.preview).toHaveBeenCalledExactlyOnceWith({
    operation: "install",
    chooseFile: false,
    shortcut: "ctrl+alt+y",
  });
  await language("en");
  expect(api.preview).toHaveBeenCalledOnce();
  expect(api.apply).not.toHaveBeenCalled();
  await act(async () => read.resolve(preview));
  const diff = document.querySelector('[data-testid="config-diff"]');
  expect(diff).not.toBeNull();
  const advanced = document.querySelector<HTMLDetailsElement>("details")!;
  await act(async () => {
    advanced.open = true;
  });
  await language("zh");
  expect(diff!.isConnected).toBe(true);
  expect(advanced.open).toBe(true);
  expect(document.body.textContent).toContain("/Raw Dir/config.kdl");
  expect(document.body.textContent).toContain("/Real Dir/config.kdl");
  await click("复制快捷键");
  expect(api.copy).toHaveBeenCalledExactlyOnceWith(niri.shortcutBinding);
  expect(api.apply).not.toHaveBeenCalled();
  const applied = deferred<{ backupPath: string; warning: null }>();
  api.apply.mockReturnValueOnce(applied.promise);
  await click("保存快捷键");
  await language("en");
  expect((button("Saving…") as HTMLButtonElement).disabled).toBe(true);
  expect(api.apply).toHaveBeenCalledExactlyOnceWith(preview.id);
  await language("zh");
  await act(async () => applied.resolve({ backupPath: "/Raw Dir/backup", warning: null }));
  expect(complete).toHaveBeenCalledOnce();
  expect(api.toast).toHaveBeenCalledExactlyOnceWith({
    type: "success",
    title: "快捷键已保存",
    description: "在其他应用中按下 Ctrl+Alt+Y。",
  });
  expect(document.body.textContent).toContain("/Raw Dir/backup");
  expect(api.preview).toHaveBeenCalledOnce();
  expect(api.apply).toHaveBeenCalledOnce();
});

it("cancels a reviewed config without applying and retranslates an owned failure while keeping raw diagnostics", async () => {
  await render(<CaptureShortcutConfig state={niri} />);
  await click("Review changes");
  await language("zh");
  await click("取消");
  expect(api.apply).not.toHaveBeenCalled();
  api.preview.mockRejectedValueOnce(new Error("Raw permission diagnostic"));
  await click("查看修改");
  expect(document.body.textContent).toContain("无法准备修改，请查看“高级”中的帮助信息。");
  expect(document.body.textContent).toContain("Raw permission diagnostic");
  await language("en");
  expect(document.body.textContent).toContain(
    "Couldn't prepare the changes. Check Advanced for help.",
  );
  expect(api.preview).toHaveBeenCalledTimes(2);
  expect(api.apply).not.toHaveBeenCalled();
});

it("keeps a saved warning open and removes only the approved binding without completing setup", async () => {
  const complete = vi.fn();
  const state: DesktopSnapShotState = {
    ...niri,
    linuxBackend: "hyprland",
    hyprlandHelper: { status: "ready", message: "Ready" },
  };
  api.apply.mockResolvedValueOnce({
    backupPath: "/Raw backup",
    warning:
      "Config saved, but Hyprland couldn't reload it cleanly. Check hyprctl configerrors, then run hyprctl reload.",
  });
  await render(<CaptureShortcutConfig state={state} onComplete={complete} />);
  await click("Review changes");
  await click("Save shortcut");
  expect(complete).not.toHaveBeenCalled();
  expect(api.toast).not.toHaveBeenCalled();
  await language("zh");
  expect(document.body.textContent).toContain("配置已保存，但 Hyprland 未能正常重新加载。");
  expect(document.body.textContent).toContain("/Raw backup");
  api.preview.mockResolvedValueOnce({ ...preview, id: "native-remove", operation: "remove" });
  await click("移除快捷键…");
  expect(api.preview).toHaveBeenLastCalledWith({ chooseFile: false, operation: "remove" });
  await language("en");
  await click("Remove shortcut");
  expect(api.apply).toHaveBeenLastCalledWith("native-remove");
  expect(complete).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Shortcut removed.");
});
