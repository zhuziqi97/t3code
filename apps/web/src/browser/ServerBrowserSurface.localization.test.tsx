// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EnvironmentId } from "@t3tools/contracts";
import type { PreviewStreamEvents } from "@t3tools/client-runtime/preview/server-browser-stream";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  events: null as PreviewStreamEvents | null,
  create: vi.fn(),
  send: vi.fn(() => true),
  stop: vi.fn(),
  upload: vi.fn(),
  toast: vi.fn(),
  access: {
    httpBase: "http://qa.test/stream",
    wsBase: "ws://qa.test/stream",
    query: {},
    credentials: true,
  },
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
vi.mock("~/state/previewStream", () => ({
  usePreviewStreamAccess: () => state.access,
  refreshPreviewStreamAccess: vi.fn(),
}));
vi.mock("~/components/ui/toast", () => ({ toastManager: { add: state.toast } }));

import { changeLanguage } from "~/i18n";
import { ServerBrowserSurface } from "./ServerBrowserSurface";

let root: Root;
let container: HTMLDivElement;
const render = () =>
  act(async () =>
    root.render(
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
const click = (label: string) =>
  act(async () => {
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === label);
    expect(button).toBeDefined();
    button!.click();
  });

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.clearAllMocks();
  state.events = null;
  state.upload.mockResolvedValue(undefined);
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
  root = createRoot(container);
  await render();
  await act(async () => vi.runOnlyPendingTimers());
  expect(state.create).toHaveBeenCalledTimes(1);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLanguage("en");
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("retains the connection, page input and edited prompt while changing language", async () => {
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
