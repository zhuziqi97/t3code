// @vitest-environment jsdom
import type { DesktopUpdateState } from "@t3tools/contracts";
import { act, useSyncExternalStore, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  current: null as DesktopUpdateState | null,
  listeners: new Set<() => void>(),
  toasts: [] as { id: number; title: ReactNode; description?: ReactNode }[],
  revision: 0,
  add: vi.fn(),
  confirm: vi.fn(),
  download: vi.fn(),
  install: vi.fn(),
  check: vi.fn(),
}));
vi.mock("../../env", () => ({ isElectron: true }));
vi.mock("../../state/desktopUpdate", () => ({
  useDesktopUpdateState: () =>
    useSyncExternalStore(
      (listener) => {
        testState.listeners.add(listener);
        return () => {
          testState.listeners.delete(listener);
        };
      },
      () => testState.current,
    ),
}));
vi.mock("../../hooks/useMediaQuery", () => ({ useMediaQuery: () => true }));
vi.mock("../../localApi", () => ({
  ensureLocalApi: () => ({ dialogs: { confirm: testState.confirm } }),
}));
vi.mock("../ui/toast", () => ({
  toastManager: { add: testState.add },
  stackedThreadToast: (options: unknown) => options,
}));
import { changeLanguage } from "../../i18n";
import { SidebarUpdatePill, SidebarUpdateArchitectureWarning } from "./SidebarUpdatePill";

const baseState: DesktopUpdateState = {
  enabled: true,
  status: "idle",
  channel: "latest",
  currentVersion: "1.0.0",
  hostArch: "x64",
  appArch: "x64",
  runningUnderArm64Translation: false,
  availableVersion: null,
  downloadedVersion: null,
  releaseNotes: [],
  omittedReleaseCount: 0,
  downloadPercent: null,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: false,
};
let root: Root;
let container: HTMLDivElement;
function publish() {
  for (const listener of testState.listeners) listener();
}
function Harness() {
  useSyncExternalStore(
    (listener) => {
      testState.listeners.add(listener);
      return () => {
        testState.listeners.delete(listener);
      };
    },
    () => testState.revision,
  );
  return (
    <>
      <ul>
        <SidebarUpdatePill />
      </ul>
      <SidebarUpdateArchitectureWarning />
      {testState.toasts.map((toast) => (
        <section key={toast.id}>
          <h2>{toast.title}</h2>
          <div>{toast.description}</div>
        </section>
      ))}
    </>
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function update(current: DesktopUpdateState) {
  await act(async () => {
    testState.current = current;
    publish();
  });
}
function button() {
  return container.querySelector<HTMLButtonElement>("button[aria-label]")!;
}
beforeEach(async () => {
  await changeLanguage("en");
  testState.current = baseState;
  testState.toasts = [];
  testState.revision = 0;
  testState.add.mockReset().mockImplementation((toast) => {
    testState.revision++;
    testState.toasts.push({ ...toast, id: testState.revision });
    publish();
  });
  testState.confirm.mockReset().mockResolvedValue(false);
  testState.download.mockReset();
  testState.install.mockReset();
  testState.check.mockReset();
  Object.defineProperty(window, "desktopBridge", {
    configurable: true,
    value: {
      downloadUpdate: testState.download,
      installUpdate: testState.install,
      checkForUpdate: testState.check,
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  testState.listeners.clear();
  Reflect.deleteProperty(window, "desktopBridge");
  await changeLanguage("en");
});

it("keeps a pending download and native retry result through locale changes without another command", async () => {
  const pending = deferred<{ accepted: boolean; completed: boolean; state: DesktopUpdateState }>();
  testState.download.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({
    accepted: true,
    completed: true,
    state: { ...baseState, status: "downloaded", downloadedVersion: "1.1.0" },
  });
  await update({ ...baseState, status: "available", availableVersion: "1.1.0" });
  const trigger = button();
  trigger.focus();
  await act(async () => trigger.click());
  await act(async () => {
    await changeLanguage("zh");
  });
  expect(trigger.getAttribute("aria-label")).toBe("更新 1.1.0 可供下载");
  expect(trigger.getAttribute("aria-disabled")).toBe("true");
  expect(document.activeElement).toBe(trigger);
  await act(async () => trigger.click());
  expect(testState.download).toHaveBeenCalledTimes(1);
  await act(async () =>
    pending.resolve({
      accepted: true,
      completed: false,
      state: {
        ...baseState,
        status: "available",
        availableVersion: "1.1.0",
        message: "raw native error errno=ETIMEDOUT",
        errorContext: "download",
        canRetry: true,
      },
    }),
  );
  expect(container.textContent).toContain("无法下载更新");
  expect(container.textContent).toContain("raw native error errno=ETIMEDOUT");
  expect(trigger.getAttribute("aria-disabled")).toBeNull();
  await act(async () => {
    await changeLanguage("en");
  });
  expect(container.textContent).toContain("Could not download update");
  expect(testState.download).toHaveBeenCalledTimes(1);
  await act(async () => trigger.click());
  expect(testState.download).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("Update downloaded");
  expect(testState.install).not.toHaveBeenCalled();
});

it("confirms the current language and exact downloaded version, cancels safely, and installs once after approval", async () => {
  await update({
    ...baseState,
    status: "downloaded",
    availableVersion: "1.1.0",
    downloadedVersion: "1.1.1-nightly.2",
  });
  await act(async () => {
    await changeLanguage("zh");
    button().click();
  });
  expect(testState.confirm).toHaveBeenCalledExactlyOnceWith(
    "安装更新 1.1.1-nightly.2 并重启 T3 Code？\n\n正在运行的任务将被中断。请确认已准备好后再继续。",
  );
  expect(testState.install).not.toHaveBeenCalled();
  const pending = deferred<boolean>();
  testState.confirm.mockReturnValueOnce(pending.promise);
  testState.install.mockResolvedValue({
    accepted: true,
    completed: false,
    state: { ...baseState, message: "Desktop update install action failed unexpectedly." },
  });
  await act(async () => button().click());
  await act(async () => {
    await changeLanguage("en");
    button().click();
  });
  expect(testState.confirm).toHaveBeenCalledTimes(2);
  expect(testState.install).not.toHaveBeenCalled();
  await act(async () => pending.resolve(true));
  expect(testState.install).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("Could not install update");
  await act(async () => {
    await changeLanguage("zh");
  });
  expect(container.textContent).toContain("桌面更新的安装操作意外失败。");
  expect(testState.install).toHaveBeenCalledTimes(1);
});

it("retranslates checking and progress states while keeping them disabled and formats unsupported build errors", async () => {
  await update({ ...baseState, status: "checking" });
  await act(async () => {
    await changeLanguage("zh");
    button().click();
  });
  expect(button().getAttribute("aria-label")).toBe("正在检查更新…");
  expect(testState.check).not.toHaveBeenCalled();
  await update({
    ...baseState,
    status: "downloading",
    availableVersion: "1.1.0",
    downloadPercent: 42.9,
  });
  expect(button().getAttribute("aria-label")).toBe("正在下载更新 (42%)");
  await act(async () => button().click());
  expect(testState.download).not.toHaveBeenCalled();
  await update(baseState);
  testState.check.mockResolvedValue({
    checked: false,
    state: {
      ...baseState,
      enabled: false,
      status: "disabled",
      message: "Automatic updates are only available in packaged production builds.",
    },
  });
  await act(async () => button().click());
  expect(testState.check).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("仅打包后的正式构建支持自动更新。");
  await act(async () => {
    await changeLanguage("en");
  });
  expect(container.textContent).toContain(
    "Automatic updates are only available in packaged production builds.",
  );
  expect(testState.check).toHaveBeenCalledTimes(1);
});

it("retranslates the architecture warning and its action guidance without changing native state", async () => {
  const native = {
    ...baseState,
    hostArch: "arm64" as const,
    appArch: "x64" as const,
    status: "available" as const,
    availableVersion: "1.1.0",
  };
  await update(native);
  expect(container.textContent).toContain("Download the available update");
  await act(async () => {
    await changeLanguage("zh");
  });
  expect(container.textContent).toContain("Apple Silicon 设备正在使用 Intel 版本");
  expect(container.textContent).toContain("下载可用更新即可切换为原生 Apple Silicon 版本。");
  expect(testState.current).toBe(native);
  expect(testState.download).not.toHaveBeenCalled();
  await update({ ...native, status: "downloaded", downloadedVersion: "1.1.0" });
  expect(container.textContent).toContain("重启即可安装已下载的 Apple Silicon 版本。");
});
