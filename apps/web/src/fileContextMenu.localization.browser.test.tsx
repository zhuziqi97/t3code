import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../test/render";

import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ menu: vi.fn(), command: vi.fn(), toast: vi.fn() }));
vi.mock("@effect/atom-react", async (original) => ({
  ...(await original<typeof import("@effect/atom-react")>()),
  useAtomValue: () => ({
    availableEditors: ["file-manager", "vscode"],
    shellRevealInFileManager: true,
    shellRevealInFileManagerKind: "file-explorer",
    environment: { platform: { os: "linux" } },
  }),
}));
vi.mock("./browserEditorAction", () => ({
  useBrowserEditorAction: () => ({ unavailableReason: "workspace required", open: vi.fn() }),
}));
vi.mock("./remoteOpen", async (original) => ({
  ...(await original<typeof import("./remoteOpen")>()),
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }),
  useRemoteCapableEditors: () => [],
}));
vi.mock("./state/session", async (original) => ({
  ...(await original<typeof import("./state/session")>()),
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock("./state/server", async (original) => ({
  ...(await original<typeof import("./state/server")>()),
  serverEnvironment: { configValueAtom: () => "config" },
}));
vi.mock("./state/shell", async (original) => ({
  ...(await original<typeof import("./state/shell")>()),
  shellEnvironment: { openInEditor: "openInEditor" },
}));
vi.mock("./state/use-atom-command", async (original) => ({
  ...(await original<typeof import("./state/use-atom-command")>()),
  useAtomCommand: () => state.command,
}));
vi.mock("./localApi", async (original) => ({
  ...(await original<typeof import("./localApi")>()),
  readLocalApi: () => ({ contextMenu: { show: state.menu } }),
}));
vi.mock("./components/ui/toast", async (original) => ({
  ...(await original<typeof import("./components/ui/toast")>()),
  toastManager: { add: state.toast },
}));

import { changeLanguage } from "./i18n";
import { useFileContextMenu } from "./fileContextMenu";

const environmentId = EnvironmentId.make("raw-environment");
const target = { environmentId, workspaceRoot: "/workspace/原始项目", filePath: "原始文件.ts" };
let root: Screen;
let container: HTMLDivElement;
function Probe() {
  const menu = useFileContextMenu(environmentId);
  return <button onClick={() => void menu.show(target)}>Show</button>;
}
const click = async () => await act(async () => container.querySelector("button")!.click());

it("reopens in the current language while retaining server-selected WSL wording and editor actions", async () => {
  await using _lifecycle = await setupLifecycle();

  await click();
  expect(state.menu.mock.calls[0]![0].map((item: { label: string }) => item.label)).toEqual([
    "Open",
    "Reveal in File Explorer",
    "Open with",
  ]);
  await act(async () => changeLanguage("zh"));
  state.menu.mockResolvedValueOnce("editor:vscode");
  await click();
  const items = state.menu.mock.calls[1]![0];
  expect(items.map((item: { label: string }) => item.label)).toEqual([
    "打开",
    "在文件资源管理器中显示",
    "打开方式",
  ]);
  expect(items[2].children).toEqual([{ id: "editor:vscode", label: "VS Code" }]);
  expect(state.command).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { cwd: "/workspace/原始项目/原始文件.ts", editor: "vscode" },
  });
});

it("uses the completion language for a failed reveal without repeating the operation", async () => {
  await using _lifecycle = await setupLifecycle();

  let finish!: (result: { _tag: string }) => void;
  state.command.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  state.menu.mockResolvedValueOnce("reveal-in-folder");
  await click();
  await act(async () => changeLanguage("zh"));
  expect(state.command).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { cwd: "/workspace/原始项目/原始文件.ts", editor: "file-manager", reveal: true },
  });
  await act(async () => finish({ _tag: "Failure" }));
  expect(state.toast).toHaveBeenCalledWith({
    type: "error",
    title: "无法在文件管理器中显示文件",
    description: "/workspace/原始项目/原始文件.ts",
  });
  await act(async () => changeLanguage("en"));
  expect(state.command).toHaveBeenCalledTimes(1);
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
  });

  vi.clearAllMocks();
  state.menu.mockResolvedValue(null);
  state.command.mockResolvedValue({ _tag: "Success" });
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));
  await act(async () => root.rerender(<Probe />));

  renderStack = stack.move();
  return renderStack;
}
