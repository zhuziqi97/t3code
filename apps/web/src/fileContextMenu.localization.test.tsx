// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ menu: vi.fn(), command: vi.fn(), toast: vi.fn() }));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => ({
    availableEditors: ["file-manager", "vscode"],
    shellRevealInFileManager: true,
    shellRevealInFileManagerKind: "file-explorer",
    environment: { platform: { os: "linux" } },
  }),
}));
vi.mock("./state/server", () => ({ serverEnvironment: { configValueAtom: () => "config" } }));
vi.mock("./state/shell", () => ({ shellEnvironment: { openInEditor: "openInEditor" } }));
vi.mock("./state/use-atom-command", () => ({ useAtomCommand: () => state.command }));
vi.mock("./localApi", () => ({ readLocalApi: () => ({ contextMenu: { show: state.menu } }) }));
vi.mock("./components/ui/toast", () => ({ toastManager: { add: state.toast } }));

import { changeLanguage } from "./i18n";
import { useFileContextMenu } from "./fileContextMenu";

const environmentId = EnvironmentId.make("raw-environment");
const target = { environmentId, workspaceRoot: "/workspace/原始项目", filePath: "原始文件.ts" };
let root: Root;
let container: HTMLDivElement;
function Probe() {
  const menu = useFileContextMenu(environmentId);
  return <button onClick={() => void menu.show(target)}>Show</button>;
}
const click = () => act(async () => container.querySelector("button")!.click());

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.menu.mockResolvedValue(null);
  state.command.mockResolvedValue({ _tag: "Success" });
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Probe />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLanguage("en");
  vi.unstubAllGlobals();
});

it("reopens in the current language while retaining server-selected WSL wording and editor actions", async () => {
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
