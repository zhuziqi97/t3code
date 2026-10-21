import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../test/render";
import type { DeviceHubAccess } from "@t3tools/client-runtime/device/hub-access";

import { EnvironmentId } from "@t3tools/contracts";
import type { PreviewStreamEvents } from "@t3tools/client-runtime/preview/server-browser-stream";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  events: null as PreviewStreamEvents | null,
  create: vi.fn(),
  send: vi.fn(() => true),
  stop: vi.fn(),
  upload: vi.fn(),
  toast: vi.fn(),
  failed: false,
  refresh: vi.fn(),
  access: {
    httpBase: "http://qa.test/stream",
    wsBase: "ws://qa.test/stream",
    query: {},
    credentials: true,
  } as DeviceHubAccess | null,
}));
vi.mock("@t3tools/client-runtime/preview/server-browser-stream", async (original) => ({
  ...(await original<typeof import("@t3tools/client-runtime/preview/server-browser-stream")>()),
  createPreviewStreamClient: (...args: unknown[]) => {
    state.create(...args);
    state.events = args[1] as PreviewStreamEvents;
    return { send: state.send, stop: state.stop };
  },
  createPreviewFramePainter: () => ({ paint: vi.fn(), stop: vi.fn() }),
  uploadPreviewStreamFiles: (...args: unknown[]) => state.upload(...args),
}));
vi.mock("~/state/previewStream", async (original) => ({
  ...(await original<typeof import("~/state/previewStream")>()),
  usePreviewStreamAccess: () => ({ access: state.access, failed: state.failed }),
  refreshPreviewStreamAccess: () => state.refresh(),
}));
vi.mock("~/components/ui/toast", async (original) => ({
  ...(await original<typeof import("~/components/ui/toast")>()),
  toastManager: { add: state.toast },
}));

import { changeLanguage } from "~/i18n";
import { ServerBrowserSurface } from "./ServerBrowserSurface";

let root: Screen;
let container: HTMLDivElement;
const render = async () =>
  await act(async () =>
    root.rerender(
      <ServerBrowserSurface
        environmentId={EnvironmentId.make("qa")}
        threadId="raw-thread"
        tabId="raw-tab"
        visible
      />,
    ),
  );
const ownControl = {
  canOperate: true,
  controller: "you",
  generation: 3,
  dialog: { type: "prompt", message: "raw 页面消息 {{value}}", defaultValue: "raw 默认值" },
} as const;
const click = async (label: string) =>
  await act(async () => {
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === label);
    expect(button).toBeDefined();
    button!.click();
  });

it("retains the connection, page input and edited prompt while changing language", async () => {
  await using _lifecycle = await setupLifecycle();

  await act(async () => state.events!.onControl!(ownControl));
  const canvas = container.querySelector("canvas");
  const pageInput = container.querySelector("textarea");
  const response = container.querySelector<HTMLInputElement>(
    'input[aria-label="Dialog response"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      response,
      "原文 answer & {{x}}",
    );
    response.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => changeLanguage("zh"));
  expect(container.querySelector("canvas")).toBe(canvas);
  expect(container.querySelector("textarea")).toBe(pageInput);
  expect(container.querySelector('input[aria-label="对话框回复"]')).toBe(response);
  expect(response.value).toBe("原文 answer & {{x}}");
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
    ownControl.dialog.message,
  );
  expect(container.querySelector('[role="status"]')?.textContent).toBe("你拥有控制权");
  expect(state.create).toHaveBeenCalledTimes(1);
  expect(state.stop).not.toHaveBeenCalled();
  state.send.mockClear();
  await click("确认");
  expect(state.send).toHaveBeenCalledExactlyOnceWith({
    type: "dialog",
    accept: true,
    promptText: "原文 answer & {{x}}",
  });
  await click("释放控制权");
  expect(state.send).toHaveBeenLastCalledWith({ type: "releaseControl" });
  await act(async () =>
    state.events!.onControl!({ ...ownControl, controller: "unclaimed", dialog: null }),
  );
  await click("取得控制权");
  expect(state.send).toHaveBeenLastCalledWith({ type: "takeControl" });
  await act(async () =>
    state.events!.onControl!({ ...ownControl, controller: "another-viewer", dialog: null }),
  );
  expect(container.querySelector("button")?.disabled).toBe(true);
  await act(async () => changeLanguage("en"));
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    "Another viewer has control",
  );
  expect(state.create).toHaveBeenCalledTimes(1);
});

it("retains a file request and reports an upload failure in the completion language", async () => {
  await using _lifecycle = await setupLifecycle();

  await act(async () => state.events!.onControl!({ ...ownControl, dialog: null }));
  const chooser = {
    multiple: true,
    accept: ".txt",
    uploadUrl: "http://qa.test/upload?raw=1",
    credentials: true,
  };
  await act(async () => state.events!.onFileChooser!(chooser));
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  await act(async () => changeLanguage("zh"));
  expect(container.querySelector('input[type="file"]')).toBe(input);
  expect(input.multiple).toBe(true);
  expect(input.accept).toBe(".txt");
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
    "网页请求选择多个文件。",
  );
  await click("取消");
  expect(state.upload).toHaveBeenCalledExactlyOnceWith(chooser, []);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => state.events!.onFileChooser!(chooser));
  let rejectUpload!: (error: Error) => void;
  state.upload.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectUpload = reject;
      }),
  );
  const file = new File(["原始字节"], "raw 文件.txt", { type: "text/plain" });
  await act(async () => {
    const nextInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(nextInput, "files", { value: [file] });
    nextInput.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => changeLanguage("en"));
  await act(async () => rejectUpload(new Error("EACCES /raw/文件.txt")));
  expect(state.upload).toHaveBeenLastCalledWith(chooser, [file]);
  expect(state.toast).toHaveBeenCalledExactlyOnceWith({
    type: "error",
    title: "Could not send the files to the page",
    description: "EACCES /raw/文件.txt",
  });
  expect(state.create).toHaveBeenCalledTimes(1);
  expect(state.stop).not.toHaveBeenCalled();
});

it("keeps the stream during preparation and exposes a translated launch failure with retry", async () => {
  await using _lifecycle = await setupLifecycle();

  await act(async () => state.events!.onStatus!({ state: "preparing" }));
  expect(container.textContent).toContain("Preparing browser");
  expect(state.create).toHaveBeenCalledTimes(1);
  await act(async () => changeLanguage("zh"));
  expect(container.textContent).toContain("正在准备浏览器");
  await act(async () => state.events!.onStatus!({ state: "failed", reason: "launch" }));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("浏览器无法启动。");
  await click("重新连接");
  expect(state.create).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it.each(["connection", "unauthorized"] as const)(
  "bounds %s failures and clears the counter on explicit reconnect",
  async (reason) => {
    await using _lifecycle = await setupLifecycle();

    for (let attempt = 0; attempt < 3; attempt++) {
      await act(async () =>
        reason === "connection"
          ? state.events!.onConnectionFailure!()
          : state.events!.onUnauthorized(),
      );
      if (attempt < 2) {
        await act(async () => vi.runOnlyPendingTimers());
        state.access = { ...state.access! };
        await render();
      }
    }
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      reason === "connection"
        ? "Could not connect to the browser."
        : "Browser connection was refused.",
    );
    const before = state.create.mock.calls.length;
    await click("Reconnect");
    expect(state.create).toHaveBeenCalledTimes(before + 1);
    await act(async () => state.events!.onConnectionFailure!());
    expect(container.querySelector('[role="alert"]')).toBeNull();
  },
);

it("bounds failed access acquisition and recovers when fresh access becomes available", async () => {
  await using _lifecycle = await setupLifecycle();

  state.access = null;
  for (let failure = 0; failure < 3; failure++) {
    state.failed = true;
    await render();
    await act(async () => vi.runOnlyPendingTimers());
    if (failure < 2) {
      state.failed = false;
      await render();
    }
  }
  expect(state.refresh).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Could not connect to the browser.",
  );
  await act(async () => vi.runAllTimers());
  expect(state.refresh).toHaveBeenCalledTimes(2);
  await click("Reconnect");
  state.access = {
    httpBase: "http://qa.test/stream",
    wsBase: "ws://qa.test/stream",
    query: {},
    credentials: true,
  };
  state.failed = false;
  await render();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(state.create).toHaveBeenCalledTimes(2);
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    await act(async () => root.unmount());
    container.remove();
    await changeLanguage("en");
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  vi.useFakeTimers();
  vi.clearAllMocks();
  state.events = null;
  state.failed = false;
  state.access = {
    httpBase: "http://qa.test/stream",
    wsBase: "ws://qa.test/stream",
    query: {},
    credentials: true,
  };
  state.upload.mockResolvedValue(undefined);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        queueMicrotask(() =>
          this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver),
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  });
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));
  await render();
  await act(async () => vi.runAllTimers());
  expect(state.create).toHaveBeenCalledTimes(1);

  renderStack = stack.move();
  return renderStack;
}
