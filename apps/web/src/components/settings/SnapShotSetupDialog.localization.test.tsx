// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { DEFAULT_CLIENT_SETTINGS, type DesktopSnapShotState } from "@t3tools/contracts";
import { changeLanguage } from "../../i18n";
import { SnapShotSetupDialog } from "./SnapShotSetupDialog";
import type { ComponentProps } from "react";

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
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLanguage("en");
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
});
const state: DesktopSnapShotState = {
  mode: "direct",
  shortcut: DEFAULT_CLIENT_SETTINGS.snapShotShortcut,
  shortcutRegistered: true,
  shortcutMessage: null,
  message: null,
  macPermissions: { screenRecording: false, accessibility: true },
};
const defaults = (): ComponentProps<typeof SnapShotSetupDialog> => ({
  state,
  initialStep: "access",
  wasEnabled: false,
  includeAccessibility: true,
  busy: false,
  error: null,
  shortcutInput: <span>Raw shortcut</span>,
  shortcutStatus: null,
  shortcutChanged: false,
  canSaveShortcut: false,
  onSaveShortcut: vi.fn().mockResolvedValue(false),
  onEnable: vi.fn().mockResolvedValue(true),
  onAction: vi.fn().mockResolvedValue(undefined),
  onRefresh: vi.fn().mockResolvedValue(state),
  onClose: vi.fn().mockResolvedValue(undefined),
  onLeaveStep: vi.fn(),
});
const render = async (props: ComponentProps<typeof SnapShotSetupDialog>) =>
  act(async () => root.render(<SnapShotSetupDialog {...props} />));
const language = async (lang: "en" | "zh") => act(async () => changeLanguage(lang));
function button(label: string) {
  const result = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.getAttribute("aria-label") === label || node.textContent?.trim() === label,
  );
  expect(result, label).toBeDefined();
  return result!;
}
const click = async (label: string) => act(async () => button(label).click());

it("keeps one permission check active across language changes and continues only after authorization", async () => {
  const props = defaults();
  vi.mocked(props.onRefresh).mockRejectedValueOnce(new Error("Raw check error"));
  await render(props);
  expect(props.onRefresh).toHaveBeenCalledOnce();
  expect(button("Test capture and continue").disabled).toBe(true);
  await language("zh");
  expect(props.onRefresh).toHaveBeenCalledOnce();
  expect(document.body.textContent).toContain("无法检查权限，将自动重试。");
  await click("允许");
  expect(props.onAction).toHaveBeenCalledExactlyOnceWith("allow-screen-recording");
  expect(props.onEnable).not.toHaveBeenCalled();
  vi.mocked(props.onRefresh).mockResolvedValue({
    ...state,
    macPermissions: { screenRecording: true, accessibility: true },
  });
  await act(async () => vi.advanceTimersByTime(1500));
  expect(button("测试快照并继续").disabled).toBe(false);
  await click("测试快照并继续");
  expect(props.onEnable).toHaveBeenCalledOnce();
  expect(props.onLeaveStep).toHaveBeenCalledOnce();
  await language("en");
  expect(document.body.textContent).toContain("Choose your shortcut");
  await click("Done");
  expect(props.onClose).toHaveBeenCalledExactlyOnceWith(true);
});

it("retains the GNOME access step and uses native install actions across locale changes", async () => {
  let props = {
    ...defaults(),
    state: {
      ...state,
      mode: "portal" as const,
      linuxBackend: "gnome-extension" as const,
      macPermissions: undefined,
      gnomeExtension: { status: "not-installed" as const, message: "Raw extension state" },
    },
  };
  await render(props);
  expect(props.onRefresh).not.toHaveBeenCalled();
  await language("zh");
  expect(document.body.textContent).toContain("安装扩展");
  await click("安装扩展");
  expect(props.onAction).toHaveBeenCalledExactlyOnceWith("install-extension");
  await render({ ...props, busy: true });
  await language("en");
  expect(button("Installing…").disabled).toBe(true);
  expect(props.onAction).toHaveBeenCalledOnce();
  await render({
    ...props,
    state: {
      ...props.state,
      gnomeExtension: { status: "restart-required", message: "Raw restart state" },
    },
  });
  expect(document.body.textContent).toContain("Extension installed");
  await language("zh");
  expect(document.body.textContent).toContain("请保存工作，注销后重新登录，再返回此处继续设置。");
  expect(props.onRefresh).not.toHaveBeenCalled();
});
