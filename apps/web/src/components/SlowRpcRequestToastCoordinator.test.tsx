// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useParams: () => ({}),
}));

import { i18n } from "../i18n";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";
import {
  acknowledgeRpcRequest,
  resetRequestLatencyStateForTests,
  SLOW_RPC_ACK_THRESHOLD_MS,
  trackRpcRequestSent,
} from "../rpc/requestLatencyState";
import { SlowRpcRequestToastCoordinator } from "./SlowRpcRequestToastCoordinator";
import { ToastProvider, toastManager } from "./ui/toast";

describe("slow-request notifications", () => {
  it("retranslates one expanded notification, keeps raw request labels and closes after acknowledgement", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetRequestLatencyStateForTests();
    const add = vi.spyOn(toastManager, "add");
    const close = vi.spyOn(toastManager, "close");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        await i18n.changeLanguage("en");
        root.render(
          <AppAtomRegistryProvider>
            <ToastProvider>
              <SlowRpcRequestToastCoordinator />
            </ToastProvider>
          </AppAtomRegistryProvider>,
        );
      });
      await act(async () => {
        trackRpcRequestSent("first", "git.status", "git.status · 原始环境");
        trackRpcRequestSent("second", "server.getConfig", "server.getConfig · Raw host 原文");
        await vi.advanceTimersByTimeAsync(SLOW_RPC_ACK_THRESHOLD_MS);
      });
      expect(document.body.textContent).toContain("2 requests waiting longer than 15s.");
      const disclosure = document.querySelector<HTMLElement>(
        '[role="button"][aria-expanded="false"]',
      )!;
      expect(disclosure).not.toBeNull();
      await act(() => disclosure.click());
      expect(disclosure.getAttribute("aria-expanded")).toBe("true");
      expect(document.body.textContent).toContain("git.status · 原始环境");
      expect(document.body.textContent).toContain("Started ");
      await act(async () => {
        await i18n.changeLanguage("zh");
      });
      expect(document.body.textContent).toContain("部分请求响应较慢");
      expect(document.body.textContent).toContain("2 个请求已等待超过 15 秒。");
      expect(document.body.textContent).toContain("开始时间：");
      expect(disclosure.getAttribute("aria-label")).toBe("收起请求");
      expect(disclosure.getAttribute("aria-expanded")).toBe("true");
      expect(document.querySelector('[role="button"][aria-expanded="true"]')).toBe(disclosure);
      expect(document.body.textContent).toContain("server.getConfig · Raw host 原文");
      await act(() => acknowledgeRpcRequest("first"));
      expect(document.body.textContent).toContain("1 个请求已等待超过 15 秒。");
      expect(document.body.textContent).not.toContain("git.status · 原始环境");
      await act(async () => {
        await i18n.changeLanguage("en");
      });
      expect(document.body.textContent).toContain("1 request waiting longer than 15s.");
      expect(disclosure.getAttribute("aria-label")).toBe("Hide requests");
      expect(add).toHaveBeenCalledTimes(1);
      await act(() => acknowledgeRpcRequest("second"));
      expect(close).toHaveBeenCalledExactlyOnceWith(add.mock.results[0]!.value);
    } finally {
      await act(async () => {
        root.unmount();
        resetRequestLatencyStateForTests();
        await i18n.changeLanguage("en");
      });
      container.remove();
      vi.restoreAllMocks();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
