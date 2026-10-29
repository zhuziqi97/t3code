import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../test/render";

import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { nextTerminalAttachSeedState } from "@t3tools/client-runtime/state/terminal";
import { AsyncResult, Atom } from "effect/reactivity";
import type { GhosttyTerminalSurfaceOptions } from "~/terminal/ghostty/surface";

const state = vi.hoisted(() => ({
  createSurface:
    vi.fn<(mount: HTMLElement, options: GhosttyTerminalSurfaceOptions) => Promise<unknown>>(),
  command: vi.fn(),
  menu: vi.fn(),
}));
vi.mock("@effect/atom-react", async (original) => ({
  ...(await original<typeof import("@effect/atom-react")>()),
  useAtomValue: () => null,
}));
vi.mock("../hooks/useSettings", async (original) => ({
  ...(await original<typeof import("../hooks/useSettings")>()),
  useClientSettings: (select: (settings: typeof DEFAULT_CLIENT_SETTINGS) => unknown) =>
    select(DEFAULT_CLIENT_SETTINGS),
}));
vi.mock("../editorPreferences", async (original) => ({
  ...(await original<typeof import("../editorPreferences")>()),
  useEditorAction: () => ({ open: state.command, unavailableReason: () => null }),
  usePreferredEditor: () => ["vscode", vi.fn()],
  readPreferredEditor: () => "vscode",
}));
vi.mock("../localApi", async (original) => ({
  ...(await original<typeof import("../localApi")>()),
  readLocalApi: () => ({ contextMenu: { show: state.menu, close: vi.fn() } }),
}));
vi.mock("../state/server", async (original) => ({
  ...(await original<typeof import("../state/server")>()),
  serverEnvironment: { configValueAtom: () => "config" },
}));
vi.mock("../state/preview", async (original) => ({
  ...(await original<typeof import("../state/preview")>()),
  previewEnvironment: { open: "open" },
}));
vi.mock("../state/terminal", async (original) => ({
  ...(await original<typeof import("../state/terminal")>()),
  terminalEnvironment: { resize: "resize", write: "write" },
}));
vi.mock("../state/use-atom-command", async (original) => ({
  ...(await original<typeof import("../state/use-atom-command")>()),
  useAtomCommand: () => state.command,
}));
vi.mock("../state/terminalSessions", async (original) => ({
  ...(await original<typeof import("../state/terminalSessions")>()),
  attachedTerminalSessionAtom: () => terminalSessionAtom,
}));
vi.mock("../state/session", async (original) => ({
  ...(await original<typeof import("../state/session")>()),
  readEnvironmentScope: () => true,
  useEnvironmentScope: () => true,
}));
vi.mock("~/terminal/ghostty/surface", async (original) => ({
  ...(await original<typeof import("~/terminal/ghostty/surface")>()),
  GhosttyTerminalSurface: { create: state.createSurface },
}));
vi.mock("~/lib/selectionActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/selectionActions")>()),
  observeSelectionActions: () => ({ cancel: vi.fn(), dispose: vi.fn(), pending: false }),
}));

import { changeLanguage } from "../i18n";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";
import { TerminalViewport } from "./ThreadTerminalDrawer";

const threadRef = {
  environmentId: EnvironmentId.make("controlled-host"),
  threadId: ThreadId.make("controlled-thread"),
};
const session = { ...nextTerminalAttachSeedState(), status: "running" as const, version: 1 };
const terminalSessionAtom = Atom.make(session);
let root: Screen;
let container: HTMLDivElement;
let surface: ReturnType<typeof createSurface>;
function createSurface() {
  return {
    input: document.createElement("textarea"),
    setAccessibleLabels: vi.fn((input: string) => surface.input.setAttribute("aria-label", input)),
    setVisible: vi.fn(),
    setSharedGrid: vi.fn(),
    setTheme: vi.fn(),
    setFont: vi.fn(),
    refreshLinkActivation: vi.fn(),
    resendSize: vi.fn(),
    focus: vi.fn(),
    fit: vi.fn(),
    scrollToBottom: vi.fn(),
    isAtBottom: () => true,
    hasSelection: vi.fn(() => false),
    getSelection: () => "Raw selected output 原文",
    getSelectionPosition: () => ({ start: { x: 0, y: 0 }, end: { x: 5, y: 0 } }),
    getSelectionEndClientRect: () => null,
    pasteFromClipboard: vi.fn(async (readText: () => Promise<string>) => {
      await readText();
    }),
    dispose: vi.fn(),
    write: vi.fn(),
    resetAndWrite: vi.fn(),
    clearSelection: vi.fn(),
  };
}
const render = async () =>
  await act(async () =>
    root.rerender(
      <AppAtomRegistryProvider>
        <TerminalViewport
          advancedTypography={false}
          threadRef={threadRef}
          threadId={threadRef.threadId}
          terminalId="raw-terminal-id"
          terminalLabel="My npm dev"
          cwd="/controlled/repo"
          onSessionExited={state.command}
          autoFocus={false}
          visible={true}
          keybindings={[]}
        />
      </AppAtomRegistryProvider>,
    ),
  );
const switchLanguage = async (language: "en" | "zh") =>
  await act(async () => changeLanguage(language));

it("updates retained native-menu callbacks after a language switch without recreating the terminal or its draft", async () => {
  await using _lifecycle = await setupLifecycle();

  await render();
  surface.input.value = "npm run dev -- --host";
  const options = state.createSurface.mock.calls[0]![1];
  await switchLanguage("zh");
  expect(state.createSurface).toHaveBeenCalledOnce();
  expect(surface.dispose).not.toHaveBeenCalled();
  expect(surface.input.value).toBe("npm run dev -- --host");
  expect(surface.input.getAttribute("aria-label")).toBe("终端输入");
  await act(async () =>
    options.onContextMenu?.(new MouseEvent("contextmenu", { clientX: 10, clientY: 20 })),
  );
  expect(state.menu).toHaveBeenCalledExactlyOnceWith(
    [
      { id: "copy", label: "复制", disabled: true },
      { id: "paste", label: "粘贴" },
      { id: "select-all", label: "全选" },
      { id: "scroll-to-bottom", label: "跳到最新输出" },
    ],
    { x: 10, y: 20 },
  );
  await act(async () => options.onData?.("literal input\n"));
  expect(state.command).toHaveBeenLastCalledWith({
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId, terminalId: "raw-terminal-id", data: "literal input\n" },
  });
  await switchLanguage("en");
  expect(state.createSurface).toHaveBeenCalledOnce();
  expect(surface.input.value).toBe("npm run dev -- --host");
  expect(surface.input.getAttribute("aria-label")).toBe("Terminal input");
});

it("uses the current language when terminal loading finishes after a switch", async () => {
  await using _lifecycle = await setupLifecycle();

  let finish: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  state.createSurface.mockImplementation(async (mount) => {
    mount.append(surface.input);
    await pending;
    return surface;
  });
  await render();
  expect(state.createSurface.mock.calls[0]![1].accessibleLabels?.input).toBe("Terminal input");
  surface.input.value = "raw pending input";
  await switchLanguage("zh");
  await act(async () => {
    finish();
  });
  expect(surface.input.getAttribute("aria-label")).toBe("终端输入");
  expect(surface.input.value).toBe("raw pending input");
  expect(state.createSurface).toHaveBeenCalledOnce();
  expect(surface.dispose).not.toHaveBeenCalled();
});

it("retranslates initialization errors while retaining raw diagnostics and avoiding a retry", async () => {
  await using _lifecycle = await setupLifecycle();

  state.createSurface.mockRejectedValue(new Error("raw WASM diagnostic"));
  await render();
  expect(container.textContent).toBe(
    "raw WASM diagnostic: close and reopen the terminal to retry.",
  );
  await switchLanguage("zh");
  expect(container.textContent).toBe("raw WASM diagnostic；请关闭并重新打开终端后重试。");
  expect(state.createSurface).toHaveBeenCalledOnce();
  expect(state.command).not.toHaveBeenCalled();
});

it.each([
  ["copy", false, "剪贴板不可用，无法复制终端选中的内容。"],
  ["copy", true, "无法将终端选中的内容复制到剪贴板。"],
  ["paste", false, "剪贴板不可用，无法粘贴到终端。"],
  ["paste", true, "无法读取剪贴板内容。"],
] as const)(
  "shows a Chinese %s clipboard failure with API availability %s",
  async (action, available, expected) => {
    await using _lifecycle = await setupLifecycle();

    using _copyFallback = vi.spyOn(document, "execCommand").mockReturnValue(false);
    vi.stubGlobal(
      "navigator",
      available
        ? {
            clipboard: {
              writeText: vi.fn().mockRejectedValue(new Error("raw clipboard failure")),
              readText: vi.fn().mockRejectedValue(new Error("raw clipboard failure")),
            },
          }
        : {},
    );
    surface.hasSelection.mockReturnValue(action === "copy");
    state.menu.mockResolvedValue(action);
    await switchLanguage("zh");
    await render();
    const options = state.createSurface.mock.calls[0]![1];
    await act(async () => options.onContextMenu?.(new MouseEvent("contextmenu")));
    expect(surface.write.mock.calls.flat().join("")).toContain(expected);
    expect(state.command).not.toHaveBeenCalled();
    expect(state.createSurface).toHaveBeenCalledOnce();
  },
);

it("uses the completion language when a clipboard read fails after switching", async () => {
  await using _lifecycle = await setupLifecycle();

  let rejectRead: (cause: Error) => void = () => undefined;
  const pending = new Promise<string>((_, reject) => {
    rejectRead = reject;
  });
  let markReadStarted!: () => void;
  const readStarted = new Promise<void>((resolve) => {
    markReadStarted = resolve;
  });
  const readText = vi.fn(() => {
    markReadStarted();
    return pending;
  });
  vi.stubGlobal("navigator", { clipboard: { readText } });
  state.menu.mockResolvedValue("paste");
  await render();
  const options = state.createSurface.mock.calls[0]![1];
  await act(async () => {
    options.onContextMenu?.(new MouseEvent("contextmenu"));
    await readStarted;
  });
  expect(readText).toHaveBeenCalledOnce();
  expect(surface.write).not.toHaveBeenCalled();
  await switchLanguage("zh");
  await act(async () => rejectRead(new Error("raw delayed clipboard denial")));
  expect(surface.write.mock.calls.flat().join("")).toContain("无法读取剪贴板内容。");
  expect(state.command).not.toHaveBeenCalled();
  expect(surface.dispose).not.toHaveBeenCalled();
});

it("preserves unknown terminal menu diagnostics", async () => {
  await using _lifecycle = await setupLifecycle();

  state.menu.mockRejectedValue(new Error("Unknown menu diagnostic 原文"));
  await switchLanguage("zh");
  await render();
  const options = state.createSurface.mock.calls[0]![1];
  await act(async () => options.onContextMenu?.(new MouseEvent("contextmenu")));
  expect(surface.write.mock.calls.flat().join("")).toContain("Unknown menu diagnostic 原文");
  expect(state.command).not.toHaveBeenCalled();
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
    vi.unstubAllGlobals();
  });

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  await changeLanguage("en");
  state.command.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.menu.mockReset().mockResolvedValue(null);
  surface = createSurface();
  state.createSurface.mockReset().mockImplementation(async (mount) => {
    mount.append(surface.input);
    return surface;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));

  renderStack = stack.move();
  return renderStack;
}
