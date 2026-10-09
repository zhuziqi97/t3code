// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { nextTerminalAttachSeedState } from "@t3tools/client-runtime/state/terminal";
import { AsyncResult } from "effect/reactivity";
import type { GhosttyTerminalSurfaceOptions } from "~/terminal/ghostty/surface";

const state = vi.hoisted(() => ({
  createSurface:
    vi.fn<(mount: HTMLElement, options: GhosttyTerminalSurfaceOptions) => Promise<unknown>>(),
  command: vi.fn(),
  menu: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("../hooks/useSettings", () => ({
  useClientSettings: (select: (settings: typeof DEFAULT_CLIENT_SETTINGS) => unknown) =>
    select(DEFAULT_CLIENT_SETTINGS),
}));
vi.mock("../editorPreferences", () => ({ useOpenInPreferredEditor: () => state.command }));
vi.mock("../localApi", () => ({
  readLocalApi: () => ({ contextMenu: { show: state.menu, close: vi.fn() } }),
}));
vi.mock("../state/server", () => ({ serverEnvironment: { configValueAtom: () => "config" } }));
vi.mock("../state/preview", () => ({ previewEnvironment: { open: "open" } }));
vi.mock("../state/terminal", () => ({ terminalEnvironment: { resize: "resize", write: "write" } }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => state.command }));
vi.mock("../state/terminalSessions", () => ({ useAttachedTerminalSession: () => session }));
vi.mock("../state/session", () => ({
  readEnvironmentScope: () => true,
  useEnvironmentScope: () => true,
}));
vi.mock("~/terminal/ghostty/surface", () => ({
  GhosttyTerminalSurface: { create: state.createSurface },
}));
vi.mock("~/lib/selectionActions", () => ({
  observeSelectionActions: () => ({ cancel: vi.fn(), dispose: vi.fn(), pending: false }),
}));

import { changeLanguage } from "../i18n";
import { TerminalViewport } from "./ThreadTerminalDrawer";

const threadRef = {
  environmentId: EnvironmentId.make("controlled-host"),
  threadId: ThreadId.make("controlled-thread"),
};
const session = { ...nextTerminalAttachSeedState(), status: "running" as const, version: 1 };
let root: Root;
let container: HTMLDivElement;
let surface: ReturnType<typeof createSurface>;
function createSurface() {
  return {
    input: document.createElement("textarea"),
    setAccessibleLabels: vi.fn((input: string) => surface.input.setAttribute("aria-label", input)),
    setVisible: vi.fn(),
    setTheme: vi.fn(),
    setFont: vi.fn(),
    refreshLinkActivation: vi.fn(),
    resendSize: vi.fn(),
    focus: vi.fn(),
    fit: vi.fn(),
    scrollToBottom: vi.fn(),
    isAtBottom: () => true,
    hasSelection: () => false,
    dispose: vi.fn(),
    write: vi.fn(),
    resetAndWrite: vi.fn(),
    clearSelection: vi.fn(),
  };
}
const render = async () =>
  act(async () =>
    root.render(
      <TerminalViewport
        advancedTypography={false}
        threadRef={threadRef}
        threadId={threadRef.threadId}
        terminalId="raw-terminal-id"
        terminalLabel="My npm dev"
        cwd="/controlled/repo"
        onSessionExited={state.command}
        focusRequestId={0}
        autoFocus={false}
        visible={true}
        resizeEpoch={0}
        drawerHeight={200}
        keybindings={[]}
      />,
    ),
  );
const switchLanguage = async (language: "en" | "zh") => act(async () => changeLanguage(language));
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLanguage("en");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("updates retained native-menu callbacks after a language switch without recreating the terminal or its draft", async () => {
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
  state.createSurface.mockRejectedValue(new Error("raw WASM diagnostic"));
  await render();
  expect(container.textContent).toBe(
    "raw WASM diagnostic — close and reopen the terminal to retry.",
  );
  await switchLanguage("zh");
  expect(container.textContent).toBe("raw WASM diagnostic；请关闭并重新打开终端后重试。");
  expect(state.createSurface).toHaveBeenCalledOnce();
  expect(state.command).not.toHaveBeenCalled();
});
