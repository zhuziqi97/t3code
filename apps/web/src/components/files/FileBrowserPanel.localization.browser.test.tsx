import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../../test/render";

import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  refresh: vi.fn(),
  load: vi.fn(),
  open: vi.fn(),
  menu: vi.fn(),
  query: "",
  error: null as string | null,
  entries: [
    { path: "中文文件.ts", kind: "file" },
    { path: "raw-file.ts", kind: "file" },
    { path: "src", kind: "directory" },
    { path: "src/raw-file.ts", kind: "file" },
  ],
  directories: new Set<string>(),
}));
vi.mock("./useDirectoryEntries", async (original) => ({
  ...(await original<typeof import("./useDirectoryEntries")>()),
  useDirectoryEntries: () => ({
    entries: state.entries,
    load: state.load,
    refresh: state.refresh,
    ready: true,
    error: state.error,
    isPending: false,
    loadingDirectories: state.directories,
  }),
}));
vi.mock("~/state/queries", async (original) => ({
  ...(await original<typeof import("~/state/queries")>()),
  useProjectPathSearch: ({ query }: { query: string }) => {
    state.query = query;
    return { entries: [], isPending: false, error: null, truncated: false, refresh: state.refresh };
  },
}));
vi.mock("~/hooks/useTheme", async (original) => ({
  ...(await original<typeof import("~/hooks/useTheme")>()),
  useTheme: () => ({ resolvedTheme: "light" }),
}));
vi.mock("~/composerHandleContext", async (original) => ({
  ...(await original<typeof import("~/composerHandleContext")>()),
  useComposerHandleContext: () => null,
}));
vi.mock("~/hooks/useWorkspaceMutationRefresh", async (original) => ({
  ...(await original<typeof import("~/hooks/useWorkspaceMutationRefresh")>()),
  useWorkspaceMutationRefresh: () => {},
}));
vi.mock("~/fileContextMenu", async (original) => ({
  ...(await original<typeof import("~/fileContextMenu")>()),
  useFileContextMenu: () => ({ buildItems: () => [], activate: vi.fn() }),
}));
vi.mock("~/localApi", async (original) => ({
  ...(await original<typeof import("~/localApi")>()),
  readLocalApi: () => ({ contextMenu: { show: state.menu } }),
}));

import { changeLanguage } from "~/i18n";
import FileBrowserPanel from "./FileBrowserPanel";

let root: Screen;
let container: HTMLDivElement;
const render = async () =>
  await act(async () =>
    root.rerender(
      <FileBrowserPanel
        environmentId={EnvironmentId.make("raw-environment")}
        cwd="/workspace/原始路径"
        projectName="原始项目"
        selectedPath={null}
        selectedPathRevealId={0}
        onOpenFile={state.open}
        workspaceMutationId={null}
      />,
    ),
  );

it("keeps the live file tree and Chinese search when the interface language changes", async () => {
  await using _lifecycle = await setupLifecycle();

  const tree = container.querySelector("file-tree-container")!;
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "中文");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(state.query).toBe("中文");
  await act(async () => changeLanguage("zh"));
  expect(container.querySelector("file-tree-container")).toBe(tree);
  expect(container.querySelector("input")).toBe(input);
  expect(input.value).toBe("中文");
  expect(input.placeholder).toBe("搜索文件");
  expect(input.getAttribute("aria-label")).toBe("搜索 原始项目 的文件");
  expect(tree.getAttribute("aria-label")).toBe("原始项目 的文件");
  expect(state.query).toBe("中文");
  expect(state.refresh).not.toHaveBeenCalled();
  expect(state.open).not.toHaveBeenCalled();
  await act(async () => changeLanguage("en"));
  expect(input.value).toBe("中文");
  expect(input.placeholder).toBe("Search files");
  expect(tree.getAttribute("aria-label")).toBe("原始项目 files");
});

it("retranslates the retry frame while preserving diagnostics and explicit refresh behavior", async () => {
  await using _lifecycle = await setupLifecycle();

  state.error = "Permission denied: /workspace/原始路径";
  await render();
  await act(async () => changeLanguage("zh"));
  const retry = Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Permission denied:"),
  )!;
  expect(retry.textContent).toContain("Permission denied: /workspace/原始路径 点击重试。");
  expect(state.refresh).not.toHaveBeenCalled();
  await act(async () => retry.click());
  expect(state.refresh).toHaveBeenCalledTimes(1);
  state.error = "Unable to load folder.";
  await render();
  expect(container.textContent).toContain("无法加载文件夹。 点击重试。");
  await act(async () => changeLanguage("en"));
  expect(container.textContent).toContain("Unable to load folder. Click to retry.");
});

it("retains expanded folders and updates a pending folder's loading label without reloading it", async () => {
  await using _lifecycle = await setupLifecycle();

  state.directories.add("src");
  await render();
  const expand = container.querySelector('button[aria-label="Expand all folders"]')!;
  await act(async () => (expand as HTMLButtonElement).click());
  const tree = container.querySelector("file-tree-container")!;
  expect(tree.shadowRoot?.querySelector('[title="Loading…"]')).not.toBeNull();
  expect(state.load).toHaveBeenCalledExactlyOnceWith("src");
  await act(async () => changeLanguage("zh"));
  expect(container.querySelector('button[aria-label="收起所有文件夹"]')).toBe(expand);
  expect(tree.shadowRoot?.querySelector('[title="正在加载…"]')).not.toBeNull();
  expect(state.load).toHaveBeenCalledTimes(1);
  await act(async () => (expand as HTMLButtonElement).click());
  expect(container.querySelector('button[aria-label="展开所有文件夹"]')).toBe(expand);
});

it("shows no matches instead of every cached file and restores the same tree when search is cleared", async () => {
  await using _lifecycle = await setupLifecycle();

  const tree = container.querySelector("file-tree-container")!;
  const input = container.querySelector("input")!;
  const type = async (value: string) =>
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await type("no-such-file");
  expect(container.textContent).toContain("No matching files or folders.");
  expect((tree as HTMLElement).style.display).toBe("none");
  await act(async () => changeLanguage("zh"));
  expect(container.textContent).toContain("没有匹配的文件或文件夹。");
  expect(input.value).toBe("no-such-file");
  await type("");
  expect(container.querySelector("file-tree-container")).toBe(tree);
  expect((tree as HTMLElement).style.display).toBe("flex");
  expect(state.open).not.toHaveBeenCalled();
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
  state.error = null;
  state.directories.clear();
  state.query = "";
  state.menu.mockResolvedValue(null);
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));
  await render();

  renderStack = stack.move();
  return renderStack;
}
