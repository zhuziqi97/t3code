import "~/index.css";
import { act, fakeTimers, render as renderTestUi, type Screen } from "../../../test/render";

import { expect, it, vi } from "vite-plus/test";
import { DEFAULT_CLIENT_SETTINGS, type DesktopSnapShotState } from "@t3tools/contracts";
import { changeLanguage } from "../../i18n";
import { SnapShotSetupDialog } from "./SnapShotSetupDialog";
import type { ComponentProps } from "react";

let root: Screen;
let container: HTMLDivElement;

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
  await act(async () => root.rerender(<SnapShotSetupDialog {...props} />));
const language = async (lang: "en" | "zh") => await act(async () => changeLanguage(lang));
function button(label: string) {
  const result = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.getAttribute("aria-label") === label || node.textContent?.trim() === label,
  );
  expect(result, label).toBeDefined();
  return result!;
}
const click = async (label: string) => await act(async () => button(label).click());

it("keeps one permission check active across language changes and continues only after authorization", async () => {
  await using _lifecycle = await setupLifecycle();

  const props = defaults();
  let rejectCheck!: (error: Error) => void;
  vi.mocked(props.onRefresh).mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectCheck = reject;
      }),
  );
  await render(props);
  expect(props.onRefresh).toHaveBeenCalledOnce();
  expect(button("Test capture and continue").disabled).toBe(true);
  await language("zh");
  expect(props.onRefresh).toHaveBeenCalledOnce();
  await act(async () => rejectCheck(new Error("Raw check error")));
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
  await using _lifecycle = await setupLifecycle();

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

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    await act(async () => root.unmount());
    container.remove();
    await changeLanguage("en");
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
  });

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
  container = document.createElement("div");
  document.body.append(container);
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));
  renderStack.use(fakeTimers());

  renderStack = stack.move();
  return renderStack;
}
