import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../../test/render";
import { type ReactNode } from "react";

import {
  EnvironmentId,
  ProjectReadFileError,
  ThreadId,
  type ProjectReadFileResult,
} from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  update: vi.fn(),
  refresh: vi.fn(),
  save: vi.fn(),
  open: vi.fn(),
  file: {
    data: {
      relativePath: "原文.md",
      contents: "# Keep raw 原文",
      byteLength: 20,
      truncated: false,
    } as ProjectReadFileResult | null,
    error: null as string | null,
    readError: null as ProjectReadFileError | null,
    isNotFile: false,
    refresh: vi.fn(),
  },
}));
vi.mock("~/hooks/useSettings", async (original) => ({
  ...(await original<typeof import("~/hooks/useSettings")>()),
  useClientSettings: (select: (s: { wordWrap: boolean }) => unknown) => select({ wordWrap: true }),
  updateClientSettings: state.update,
  useUpdateClientSettings: () => state.update,
}));
vi.mock("~/hooks/useTheme", async (original) => ({
  ...(await original<typeof import("~/hooks/useTheme")>()),
  useTheme: () => ({ resolvedTheme: "light" }),
}));
vi.mock("~/hooks/useWorkspaceMutationRefresh", async (original) => ({
  ...(await original<typeof import("~/hooks/useWorkspaceMutationRefresh")>()),
  useWorkspaceMutationRefresh: () => {},
}));
vi.mock("~/state/filesystem", async (original) => ({
  ...(await original<typeof import("~/state/filesystem")>()),
  useFilesystemReadAccess: () => ({ canReadFiles: true, isPending: false, error: null }),
}));
vi.mock("~/state/session", async (original) => ({
  ...(await original<typeof import("~/state/session")>()),
  useEnvironmentScope: () => false,
}));
vi.mock("~/state/environments", async (original) => ({
  ...(await original<typeof import("~/state/environments")>()),
  usePrimaryEnvironmentId: () => EnvironmentId.make("raw-environment"),
  useEnvironmentHttpBaseUrl: () => "http://qa.test",
}));
vi.mock("~/remoteOpen", async (original) => ({
  ...(await original<typeof import("~/remoteOpen")>()),
  useRemoteOpenState: () => ({ mode: "local-exec" }),
}));
vi.mock("~/browser/previewRuntime", async (original) => ({
  ...(await original<typeof import("~/browser/previewRuntime")>()),
  usePreviewAvailable: () => true,
}));
vi.mock("~/state/use-atom-command", async (original) => ({
  ...(await original<typeof import("~/state/use-atom-command")>()),
  useAtomCommand: () => state.open,
}));
vi.mock("~/state/use-atom-query-runner", async (original) => ({
  ...(await original<typeof import("~/state/use-atom-query-runner")>()),
  useAtomQueryRunner: () => state.open,
}));
vi.mock("~/state/assets", async (original) => ({
  ...(await original<typeof import("~/state/assets")>()),
  assetEnvironment: { createUrl: "createUrl" },
}));
vi.mock("~/state/preview", async (original) => ({
  ...(await original<typeof import("~/state/preview")>()),
  previewEnvironment: { open: "open" },
}));
vi.mock("~/assets/assetUrls", async (original) => ({
  ...(await original<typeof import("~/assets/assetUrls")>()),
  useAssetUrlState: () => ({ _tag: "Initial" }),
  useAssetUrlRefresh: () => state.refresh,
}));
vi.mock("./projectFilesQueryState", async (original) => ({
  ...(await original<typeof import("./projectFilesQueryState")>()),
  useProjectFileQuery: () => state.file,
  useProjectEntriesQuery: () => ({
    data: null,
    isPending: false,
    error: null,
    refresh: state.refresh,
  }),
  getOptimisticProjectFileQueryData: () => null,
  getProjectFileContents: () => state.file.data?.contents,
  setProjectFileQueryData: vi.fn(),
}));
vi.mock(import("./fileSaveSessions"), () => ({
  useFileSaveSession: () => {},
  changeFileSaveSession: state.save,
}));
vi.mock("~/components/chat/OpenInPicker", async (original) => ({
  ...(await original<typeof import("~/components/chat/OpenInPicker")>()),
  OpenInPicker: () => null,
}));
vi.mock("~/components/media/MediaActions", async (original) => ({
  ...(await original<typeof import("~/components/media/MediaActions")>()),
  MediaActions: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("~/components/media/MediaVideoPlayer", async (original) => ({
  ...(await original<typeof import("~/components/media/MediaVideoPlayer")>()),
  MediaVideoPlayer: () => null,
}));
vi.mock("~/composerDraftStore", async (original) => ({
  ...(await original<typeof import("~/composerDraftStore")>()),
  useComposerDraftStore: () => undefined,
}));
vi.mock("~/components/DiffWorkerPoolProvider", async (original) => ({
  ...(await original<typeof import("~/components/DiffWorkerPoolProvider")>()),
  DiffWorkerPoolProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./FileBrowserPanel", async (original) => ({
  ...(await original<typeof import("./FileBrowserPanel")>()),
  default: () => <aside data-browser-fixture />,
}));
vi.mock("./AttachmentFilePreview", async (original) => ({
  ...(await original<typeof import("./AttachmentFilePreview")>()),
  AttachmentFilePreview: () => null,
}));
vi.mock("./ReadOnlySourcePreview", async (original) => ({
  ...(await original<typeof import("./ReadOnlySourcePreview")>()),
  default: ({ text }: { text: string }) => <pre>{text}</pre>,
}));
vi.mock("./FileMarkdownPreview", async (original) => ({
  ...(await original<typeof import("./FileMarkdownPreview")>()),
  FileMarkdownPreview: ({ text }: { text: string }) => <article>{text}</article>,
}));

import { changeLanguage } from "~/i18n";
import FilePreviewPanel from "./FilePreviewPanel";

let root: Screen;
let container: HTMLDivElement;
const threadRef = {
  environmentId: EnvironmentId.make("raw-environment"),
  threadId: ThreadId.make("raw-thread"),
};
const render = async () =>
  await act(async () =>
    root.rerender(
      <FilePreviewPanel
        openInShortcutEnabled={false}
        onNavigateFolder={vi.fn()}
        folderTrail=""
        environmentId={threadRef.environmentId}
        threadRef={threadRef}
        composerDraftTarget={threadRef}
        cwd="/原始项目"
        projectName="原始项目"
        relativePath="原文.md"
        keybindings={DEFAULT_RESOLVED_KEYBINDINGS}
        availableEditors={[]}
        revealLine={null}
        revealRequestId={0}
        selectedFilePending={false}
        workspaceMutationId={null}
        onOpenFile={state.open}
        onPendingChange={state.save}
      />,
    ),
  );
const click = async (label: string) =>
  await act(async () =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click(),
  );

it("keeps the selected view and explorer preference across language changes without saving the file", async () => {
  await using _lifecycle = await setupLifecycle();

  await click("Show rendered markdown");
  await click("Hide file explorer");
  const document = container.querySelector("article");
  await act(async () => changeLanguage("zh"));
  expect(container.querySelector("article")).toBe(document);
  expect(document?.textContent).toBe("# Keep raw 原文");
  expect(container.querySelector("[data-browser-fixture]")).toBeNull();
  expect(container.querySelector('button[aria-label="显示 Markdown 源码"]')).not.toBeNull();
  expect(container.querySelector('button[aria-label="显示文件浏览器"]')).not.toBeNull();
  expect(state.save).not.toHaveBeenCalled();
  expect(state.refresh).not.toHaveBeenCalled();
  await click("显示 Markdown 源码");
  await click("显示文件浏览器");
  expect(container.querySelector("pre")?.textContent).toBe("# Keep raw 原文");
  await click("关闭自动换行");
  expect(container.querySelector('button[aria-label="启用自动换行"]')).not.toBeNull();
  expect(state.update).not.toHaveBeenCalled();
  await act(async () => changeLanguage("en"));
  expect(container.querySelector('button[aria-label="Enable word wrap"]')).not.toBeNull();
  expect(state.update).not.toHaveBeenCalled();
  expect(container.querySelector("[data-browser-fixture]")).not.toBeNull();
  expect(state.save).not.toHaveBeenCalled();
});

it("retranslates the file failure and preserves the attempted and workspace paths", async () => {
  await using _lifecycle = await setupLifecycle();

  state.file.error = "Original platform error";
  state.file.readError = new ProjectReadFileError({
    cwd: "/原始项目",
    relativePath: "原文.md",
    resolvedPath: "/原始项目/原文.md",
    failure: "operation_failed",
    operation: "realpath-target",
  });
  // An unavailable file has no preview bytes.
  const originalData = state.file.data;
  state.file.data = null;
  await render();
  await act(async () => changeLanguage("zh"));
  const alert = container.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("无法访问或读取此文件，文件可能不存在或无法访问。");
  expect(alert.textContent).toContain("/原始项目/原文.md");
  expect(alert.textContent).toContain("工作区文件夹： /原始项目");
  expect(state.refresh).not.toHaveBeenCalled();
  expect(state.save).not.toHaveBeenCalled();
  state.file.data = originalData;
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
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  localStorage.clear();
  state.file.error = null;
  state.file.readError = null;
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));
  await render();

  renderStack = stack.move();
  return renderStack;
}
