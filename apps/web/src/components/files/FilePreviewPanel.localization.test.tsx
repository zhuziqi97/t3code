// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  EnvironmentId,
  ProjectReadFileError,
  ThreadId,
  type ProjectReadFileResult,
} from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

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
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: (select: (s: { wordWrap: boolean }) => unknown) => select({ wordWrap: true }),
  useUpdateClientSettings: () => state.update,
}));
vi.mock("~/hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("~/hooks/useWorkspaceMutationRefresh", () => ({ useWorkspaceMutationRefresh: () => {} }));
vi.mock("~/state/filesystem", () => ({
  useFilesystemReadAccess: () => ({ canReadFiles: true, isPending: false, error: null }),
}));
vi.mock("~/state/session", () => ({ useEnvironmentScope: () => false }));
vi.mock("~/state/environments", () => ({
  usePrimaryEnvironmentId: () => EnvironmentId.make("raw-environment"),
  useEnvironmentHttpBaseUrl: () => "http://qa.test",
}));
vi.mock("~/remoteOpen", () => ({ useRemoteOpenState: () => ({ mode: "local-exec" }) }));
vi.mock("~/browser/previewRuntime", () => ({ usePreviewAvailable: () => true }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => state.open }));
vi.mock("~/state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => state.open }));
vi.mock("~/state/assets", () => ({ assetEnvironment: { createUrl: "createUrl" } }));
vi.mock("~/state/preview", () => ({ previewEnvironment: { open: "open" } }));
vi.mock("~/assets/assetUrls", () => ({
  useAssetUrlState: () => ({ _tag: "Initial" }),
  useAssetUrlRefresh: () => state.refresh,
}));
vi.mock("./projectFilesQueryState", () => ({
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
vi.mock("./useFileSaveCoordinator", () => ({
  useFileSaveCoordinator: () => ({ change: state.save }),
}));
vi.mock("~/components/chat/OpenInPicker", () => ({ OpenInPicker: () => null }));
vi.mock("~/components/media/MediaActions", () => ({
  MediaActions: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("~/components/media/MediaVideoPlayer", () => ({ MediaVideoPlayer: () => null }));
vi.mock("~/composerDraftStore", () => ({ useComposerDraftStore: () => undefined }));
vi.mock("~/components/DiffWorkerPoolProvider", () => ({
  DiffWorkerPoolProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./FileBrowserPanel", () => ({ default: () => <aside data-browser-fixture /> }));
vi.mock("./AttachmentFilePreview", () => ({ AttachmentFilePreview: () => null }));
vi.mock("./ReadOnlySourcePreview", () => ({
  default: ({ text }: { text: string }) => <pre>{text}</pre>,
}));
vi.mock("./FileMarkdownPreview", () => ({
  FileMarkdownPreview: ({ text }: { text: string }) => <article>{text}</article>,
}));

import { changeLanguage } from "~/i18n";
import FilePreviewPanel from "./FilePreviewPanel";

let root: Root;
let container: HTMLDivElement;
const threadRef = {
  environmentId: EnvironmentId.make("raw-environment"),
  threadId: ThreadId.make("raw-thread"),
};
const render = () =>
  act(async () =>
    root.render(
      <FilePreviewPanel
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
const click = (label: string) =>
  act(async () =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click(),
  );
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
  root = createRoot(container);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLanguage("en");
  vi.unstubAllGlobals();
});

it("keeps the selected view and explorer preference across language changes without saving the file", async () => {
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
  expect(state.update).toHaveBeenCalledExactlyOnceWith({ wordWrap: false });
  await act(async () => changeLanguage("en"));
  expect(container.querySelector("[data-browser-fixture]")).not.toBeNull();
  expect(state.save).not.toHaveBeenCalled();
});

it("retranslates the file failure and preserves the attempted and workspace paths", async () => {
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
