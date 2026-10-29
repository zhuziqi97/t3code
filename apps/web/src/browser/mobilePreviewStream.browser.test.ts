import { expect, it, vi } from "vite-plus/test";
import { fakeTimers, stubGlobal } from "../../test/render";
import { start, stop } from "../../../mobile/src/features/browser/preview-stream.browser";

function setup() {
  using stack = new DisposableStack();
  stack.use(fakeTimers());
  const messages: unknown[] = [];
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
  stack.use(stubGlobal("WebSocket", ViewerSocket));
  stack.use(
    stubGlobal("ReactNativeWebView", {
      postMessage: (value: string) => messages.push(JSON.parse(value)),
    }),
  );
  stack.use(vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null));
  stack.use(
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 390,
      height: 640,
    } as DOMRect),
  );
  stack.use(
    stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly callback: () => void) {}
        observe() {
          this.callback();
        }
        disconnect() {}
      },
    ),
  );
  const children = [...document.body.childNodes];
  const background = document.body.style.background;
  stack.defer(() => {
    document.body.replaceChildren(...children);
    document.body.style.background = background;
  });
  stack.defer(stop);
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
  vi.advanceTimersByTime(0);
  const owner = stack.move();
  return {
    messages,
    socket: ViewerSocket.current,
    [Symbol.dispose]: () => owner.dispose(),
  };
}

it("reports transport failure to native recovery without claiming unauthorized", () => {
  using fixture = setup();
  fixture.socket.dispatchEvent(Object.assign(new Event("close"), { code: 1006, reason: "" }));
  expect(fixture.messages).toContainEqual({ type: "connectionFailure" });
  expect(fixture.messages).not.toContainEqual({ type: "unauthorized" });
});

it("passes preparation and terminal component failures to native without replaying input", () => {
  using fixture = setup();
  for (const status of [{ state: "preparing" }, { state: "failed", reason: "install" }]) {
    fixture.socket.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify({ type: "status", status }) }),
    );
    expect(fixture.messages).toContainEqual({ type: "readiness", status });
  }
  fixture.socket.dispatchEvent(Object.assign(new Event("close"), { code: 1011, reason: "" }));
  expect(fixture.messages).not.toContainEqual({ type: "connectionFailure" });
});
