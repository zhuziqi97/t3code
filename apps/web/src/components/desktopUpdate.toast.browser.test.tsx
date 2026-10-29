import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../test/render";
import { type ReactNode } from "react";

import { describe, expect, it, vi } from "vite-plus/test";
import type { DesktopUpdateState } from "@t3tools/contracts";

const RELEASES_URL = `https://github.com/${import.meta.env.T3CODE_DESKTOP_UPDATE_REPOSITORY || "pingdotgg/t3code"}/releases`;

const testState = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock("./ui/toast", async (original) => ({
  ...(await original<typeof import("./ui/toast")>()),
  toastManager: { add: testState.addToast },
  stackedThreadToast: (options: unknown) => options,
}));
import { changeLanguage } from "../i18n";
import {
  showDesktopUpdateDownloadedToast,
  showDesktopUpdateErrorToast,
} from "./desktopUpdate.toast";

let root: Screen;
let container: HTMLDivElement;
function downloadedState(overrides: Partial<DesktopUpdateState> = {}): DesktopUpdateState {
  return {
    enabled: true,
    status: "downloaded",
    channel: "latest",
    currentVersion: "0.0.29",
    hostArch: "arm64",
    appArch: "arm64",
    runningUnderArm64Translation: false,
    availableVersion: "0.0.30",
    downloadedVersion: "0.0.30",
    releaseNotes: [],
    omittedReleaseCount: 0,
    downloadPercent: 100,
    checkedAt: null,
    message: null,
    errorContext: null,
    canRetry: true,
    ...overrides,
  };
}
async function renderToast(index = 0) {
  const toast = testState.addToast.mock.calls[index]?.[0] as {
    title: ReactNode;
    description?: ReactNode;
  };
  await act(async () =>
    root.rerender(
      <>
        <h1>{toast.title}</h1>
        <div>{toast.description}</div>
      </>,
    ),
  );
}

describe("desktop update notifications", () => {
  it.each(["0.0.30", null])(
    "opens the exact downloaded release, falling back from %s",
    async (downloadedVersion) => {
      await using _lifecycle = await setupLifecycle();

      const openExternal = vi.fn().mockResolvedValue(true);
      showDesktopUpdateDownloadedToast({ openExternal }, downloadedState({ downloadedVersion }));
      await renderToast();
      await act(async () => container.querySelector("button")!.click());
      expect(openExternal).toHaveBeenCalledExactlyOnceWith(`${RELEASES_URL}/tag/v0.0.30`);
      expect(testState.addToast).toHaveBeenCalledTimes(1);
    },
  );

  it("omits the link when the updater reports no version at all", async () => {
    await using _lifecycle = await setupLifecycle();

    showDesktopUpdateDownloadedToast(
      { openExternal: vi.fn() },
      downloadedState({ availableVersion: null, downloadedVersion: null }),
    );
    await renderToast();
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toContain("Restart the app");
  });

  it.each([false, new Error("open failed")])(
    "reports failed release links without repeating the open request",
    async (result) => {
      await using _lifecycle = await setupLifecycle();

      const openExternal =
        result instanceof Error
          ? vi.fn().mockRejectedValue(result)
          : vi.fn().mockResolvedValue(result);
      showDesktopUpdateDownloadedToast({ openExternal }, downloadedState());
      await renderToast();
      await act(async () => container.querySelector("button")!.click());
      expect(openExternal).toHaveBeenCalledTimes(1);
      await renderToast(1);
      expect(container.textContent).toBe("Unable to open release notes");
      await act(async () => {
        await changeLanguage("zh");
      });
      expect(container.textContent).toBe("无法打开发布说明");
      expect(testState.addToast).toHaveBeenCalledTimes(2);
    },
  );

  it("retranslates the retained download toast and link without replacing its content or URL", async () => {
    await using _lifecycle = await setupLifecycle();

    const openExternal = vi.fn().mockResolvedValue(true);
    showDesktopUpdateDownloadedToast(
      { openExternal },
      downloadedState({ downloadedVersion: "0.0.31-nightly.2" }),
    );
    await renderToast();
    const button = container.querySelector("button")!;
    button.focus();
    await act(async () => {
      await changeLanguage("zh");
    });
    expect(container.textContent).toContain("更新已下载");
    expect(container.textContent).toContain("点击更新按钮重启应用并安装更新。");
    expect(button.textContent).toBe("查看详情");
    expect(document.activeElement).toBe(button);
    await act(async () => button.click());
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(`${RELEASES_URL}/tag/v0.0.31-nightly.2`);
    await act(async () => {
      await changeLanguage("en");
    });
    expect(button.textContent).toBe("Read more");
    expect(testState.addToast).toHaveBeenCalledTimes(1);
  });

  it("retranslates owned errors and fallbacks while keeping native diagnostics verbatim", async () => {
    await using _lifecycle = await setupLifecycle();

    showDesktopUpdateErrorToast(
      "about.updateCheck.error",
      "Automatic updates are only available in packaged production builds.",
    );
    await renderToast();
    await act(async () => {
      await changeLanguage("zh");
    });
    expect(container.textContent).toContain("仅打包后的正式构建支持自动更新。");
    showDesktopUpdateErrorToast(
      "about.updateDownload.error",
      "Native download failed: /tmp/原始路径 errno=EIO",
    );
    await renderToast(1);
    expect(container.textContent).toContain("Native download failed: /tmp/原始路径 errno=EIO");
    showDesktopUpdateErrorToast("about.updateConfirm.error", null, "about.updateConfirm.failed");
    await renderToast(2);
    expect(container.textContent).toContain("更新确认失败。");
    await act(async () => {
      await changeLanguage("en");
    });
    expect(container.textContent).toContain("Update confirmation failed.");
    expect(testState.addToast).toHaveBeenCalledTimes(3);
  });
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    await act(async () => root.unmount());
    container.remove();
    await changeLanguage("en");
  });

  testState.addToast.mockReset();
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));

  renderStack = stack.move();
  return renderStack;
}
