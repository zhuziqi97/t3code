import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { AsyncResult } from "effect/reactivity";

const state = vi.hoisted(() => ({
  preference: null as string | null,
  native: vi.fn(),
  browser: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => ({
    availableEditors: ["vscode", "file-manager"],
    shellRevealInFileManager: true,
    shellRevealInFileManagerKind: "files",
    environment: { platform: { os: "linux" } },
  }),
}));
vi.mock("./state/server", () => ({ serverEnvironment: { configValueAtom: (id: unknown) => id } }));
vi.mock("./state/shell", () => ({ shellEnvironment: { openInEditor: "openInEditor" } }));
vi.mock("./state/use-atom-command", () => ({ useAtomCommand: () => state.native }));
vi.mock("./state/session", () => ({
  readEnvironmentScope: () => true,
  useEnvironmentScope: () => true,
}));
vi.mock("./browserEditorAction", () => ({
  useBrowserEditorAction: () => ({ unavailableReason: null, open: state.browser }),
}));
vi.mock("./remoteOpen", () => ({
  useRemoteOpenState: () => ({ mode: "local-exec" }),
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }),
  useRemoteCapableEditors: () => [],
}));
vi.mock("./hooks/useLocalStorage", () => ({
  getLocalStorageItem: () => state.preference,
  useLocalStorage: () => [
    state.preference,
    (editor: string) => {
      state.preference = editor;
    },
  ],
}));
vi.mock("./i18n", () => ({
  i18n: { t: (key: string) => key },
  useTranslate: () => (key: string) => key,
}));
vi.mock("./components/ui/toast", () => ({ toastManager: { add: state.toast } }));

import { resolveFileContextMenuAbsolutePath, useFileContextMenu } from "./fileContextMenu";

const BASE_TARGET = {
  environmentId: EnvironmentId.make("environment-local"),
  filePath: "src/index.ts",
  workspaceRoot: "/workspace/project",
};

describe("resolveFileContextMenuAbsolutePath", () => {
  it("strips the repository prefix when the repo root is nested in the workspace", () => {
    expect(
      resolveFileContextMenuAbsolutePath({
        ...BASE_TARGET,
        workspaceRoot: "/workspace/project/packages/app",
        repositoryRoot: "/workspace/project",
        filePath: "packages/app/src/index.ts",
      }),
    ).toBe("/workspace/project/packages/app/src/index.ts");
  });

  it("returns null for paths outside the workspace when a repository root is set", () => {
    expect(
      resolveFileContextMenuAbsolutePath({
        ...BASE_TARGET,
        workspaceRoot: "/workspace/project/packages/app",
        repositoryRoot: "/workspace/project",
        filePath: "other/src/index.ts",
      }),
    ).toBeNull();
  });

  it("rejects absolute paths without a workspace root, matching diff path resolution", () => {
    expect(
      resolveFileContextMenuAbsolutePath({
        ...BASE_TARGET,
        workspaceRoot: undefined,
        filePath: "/absolute/src/index.ts",
      }),
    ).toBeNull();
  });
});

beforeEach(() => {
  state.preference = null;
  state.native.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.browser.mockReset().mockResolvedValue(undefined);
  state.toast.mockReset();
});

it("uses browser by default, remembers explicit editors and keeps system open and reveal separate", async () => {
  const menu = useFileContextMenu(BASE_TARGET.environmentId, {
    projectId: ProjectId.make("project"),
    workspacePath: BASE_TARGET.workspaceRoot,
  });
  expect(menu.buildItems(BASE_TARGET).map((item) => item.id)).toEqual([
    "open-editor",
    "open",
    "reveal-in-folder",
    "open-with",
  ]);
  await menu.activate("open-editor", { ...BASE_TARGET, filePath: "src/index.ts:10:3" });
  expect(state.browser).toHaveBeenCalledExactlyOnceWith(
    "/workspace/project/src/index.ts:10:3",
    true,
  );
  expect(state.preference).toBeNull();

  await menu.activate("editor:vscode", BASE_TARGET);
  expect(state.preference).toBe("vscode");
  state.native.mockClear();
  await menu.activate("open-editor", BASE_TARGET);
  expect(state.native).toHaveBeenCalledExactlyOnceWith({
    environmentId: BASE_TARGET.environmentId,
    input: { cwd: "/workspace/project/src/index.ts", editor: "vscode" },
  });

  await menu.activate("open", BASE_TARGET);
  await menu.activate("reveal-in-folder", BASE_TARGET);
  expect(state.native).toHaveBeenLastCalledWith({
    environmentId: BASE_TARGET.environmentId,
    input: { cwd: "/workspace/project/src/index.ts", editor: "file-manager", reveal: true },
  });
  expect(state.preference).toBe("vscode");
});

it("does not act on another environment's target or a path outside the executing workspace", async () => {
  const menu = useFileContextMenu(BASE_TARGET.environmentId, {
    projectId: ProjectId.make("project"),
    workspacePath: BASE_TARGET.workspaceRoot,
  });
  await menu.activate("open-editor", {
    ...BASE_TARGET,
    environmentId: EnvironmentId.make("other"),
  });
  await menu.activate("open-editor", {
    ...BASE_TARGET,
    repositoryRoot: "/workspace",
    filePath: "elsewhere/index.ts",
  });
  expect(state.native).not.toHaveBeenCalled();
  expect(state.browser).not.toHaveBeenCalled();
});
