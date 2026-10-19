// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from "vite-plus/test";
import { start, stop } from "./preview-stream.browser";

class ViewerSocket extends EventTarget {
  static OPEN = 1;
  static current: ViewerSocket;
  readyState = 1;
  binaryType = "";
  constructor(_url: string) {
    super();
    ViewerSocket.current = this;
  }
  send() {}
  close() {
    this.readyState = 3;
  }
}
const messages: unknown[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  messages.length = 0;
  vi.stubGlobal("WebSocket", ViewerSocket);
  window.ReactNativeWebView = { postMessage: (value) => messages.push(JSON.parse(value)) };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 390,
    height: 640,
  } as DOMRect);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: () => void) {}
      observe() {
        this.callback();
      }
      disconnect() {}
    },
  );
  start({
    access: {
      httpBase: "http://fixture/stream",
      wsBase: "ws://fixture/stream",
      query: {},
      credentials: true,
    },
    threadId: "thread",
    tabId: "tab",
    interactive: false,
    background: "white",
  });
  vi.runAllTimers();
});
afterEach(() => {
  stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("reports transport failure to native recovery without claiming unauthorized", () => {
  ViewerSocket.current.dispatchEvent(Object.assign(new Event("close"), { code: 1006, reason: "" }));
  expect(messages).toContainEqual({ type: "connectionFailure" });
  expect(messages).not.toContainEqual({ type: "unauthorized" });
});
it("passes preparation and terminal component failures to native without replaying input", () => {
  for (const status of [{ state: "preparing" }, { state: "failed", reason: "install" }]) {
    ViewerSocket.current.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify({ type: "status", status }) }),
    );
    expect(messages).toContainEqual({ type: "readiness", status });
  }
  ViewerSocket.current.dispatchEvent(Object.assign(new Event("close"), { code: 1011, reason: "" }));
  expect(messages).not.toContainEqual({ type: "connectionFailure" });
});
