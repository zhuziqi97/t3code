import {
  AuthOrchestrationOperateScope,
  EnvironmentAuthorizationError,
  EnvironmentId,
  ProjectId,
  EDITORS,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { assert, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  allowed: new Set<string>(),
  run: vi.fn(),
  remoteResolved: true,
  remote: { mode: "local-exec" } as import("./remoteOpen").RemoteOpenState,
  browserReason: null as string | null,
  openBrowser: vi.fn(),
  openUrl: vi.fn(),
  getPreference: vi.fn(),
  setPreference: vi.fn(),
}));

vi.mock("./browserEditorAction", () => ({
  useBrowserEditorAction: () => ({
    unavailableReason: state.browserReason,
    open: state.openBrowser,
  }),
}));
vi.mock("./remoteOpen", () => ({
  useRemoteOpenState: () => state.remote,
  useRemoteOpenResolution: () => ({ state: state.remote, isResolved: state.remoteResolved }),
  useRemoteCapableEditors: () => ["vscode"],
  openRemoteEditorUrl: state.openUrl,
}));
vi.mock("./i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("react", () => ({ useCallback: (callback: unknown) => callback }));
vi.mock("./state/shell", () => ({ shellEnvironment: { openInEditor: "openInEditor" } }));
vi.mock("./state/use-atom-command", () => ({ useAtomCommand: () => state.run }));
vi.mock("./state/session", () => ({
  useEnvironmentScope: (environmentId: string) => state.allowed.has(environmentId),
  readEnvironmentScope: (environmentId: string, scope: string) =>
    scope === AuthOrchestrationOperateScope && state.allowed.has(environmentId),
}));
vi.mock("./hooks/useLocalStorage", () => ({
  getLocalStorageItem: state.getPreference,
  setLocalStorageItem: state.setPreference,
  useLocalStorage: () => [state.getPreference(), state.setPreference],
}));

import { useOpenInPreferredEditor, usePreferredEditor, useEditorAction } from "./editorPreferences";

const primary = EnvironmentId.make("primary");
const secondary = EnvironmentId.make("secondary");

beforeEach(() => {
  state.allowed.clear();
  state.remote = { mode: "local-exec" };
  state.remoteResolved = true;
  state.browserReason = null;
  state.openBrowser.mockReset().mockResolvedValue(undefined);
  state.openUrl.mockReset().mockResolvedValue(true);
  state.run.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.getPreference.mockReset().mockReturnValue(null);
  state.setPreference.mockReset();
});

it("does not use another environment's grant or change preferences when denied", async () => {
  state.allowed.add(primary);
  const open = useOpenInPreferredEditor(secondary, ["vscode"]);
  const result = await open("/work/readme.md");
  assert(result._tag === "Failure");
  const error = Cause.squash(result.cause);
  expect(error).toBeInstanceOf(EnvironmentAuthorizationError);
  expect(error).toMatchObject({ requiredScope: AuthOrchestrationOperateScope });
  expect(state.run).not.toHaveBeenCalled();
  expect(state.setPreference).not.toHaveBeenCalled();
});

it("checks revocation and regrant when a retained editor callback is invoked", async () => {
  state.allowed.add(secondary);
  state.getPreference.mockReturnValue("vscode");
  const open = useOpenInPreferredEditor(secondary, ["vscode"]);
  state.allowed.delete(secondary);
  expect((await open("/work/readme.md:5"))._tag).toBe("Failure");
  expect(state.run).not.toHaveBeenCalled();

  state.allowed.add(secondary);
  expect(await open("/work/readme.md:5")).toMatchObject({ _tag: "Success", value: "vscode" });
  expect(state.run).toHaveBeenCalledExactlyOnceWith({
    environmentId: secondary,
    input: { cwd: "/work/readme.md:5", editor: "vscode" },
  });
  expect(state.setPreference).not.toHaveBeenCalled();
});

it("defaults to browser without writing a preference", () => {
  expect(usePreferredEditor(["vscode"])[0]).toBe("browser");
  expect(state.setPreference).not.toHaveBeenCalled();
});

it("retains an existing editor even when this environment cannot offer it", () => {
  state.getPreference.mockReturnValue("cursor");
  expect(usePreferredEditor(["vscode"])[0]).toBe("cursor");
  expect(state.setPreference).not.toHaveBeenCalled();
});

it("does not persist the native fallback used for application configuration files", async () => {
  state.allowed.add(secondary);
  expect(
    (await useOpenInPreferredEditor(secondary, ["vscode"])("/home/me/.t3/keybindings.json"))._tag,
  ).toBe("Success");
  expect(state.setPreference).not.toHaveBeenCalled();
});

const workspace = { projectId: ProjectId.make("project"), workspacePath: "/work/tree" };

it.each(EDITORS.map((editor) => editor.id))(
  "keeps saved %s without rewriting storage",
  (editor) => {
    state.getPreference.mockReturnValue(editor);
    expect(usePreferredEditor([])[0]).toBe(editor);
    expect(state.setPreference).not.toHaveBeenCalled();
  },
);

it("opens the default browser with no local shell grant or remote SSH host", async () => {
  state.remote = { mode: "remote-unavailable" };
  const action = useEditorAction(secondary, [], workspace);
  expect(action.unavailableReason("browser")).toBeNull();
  expect(action.unavailableReason("vscode")).toBe("chat.editor.remoteUnavailable");
  expect(await action.open("/work/tree/main.ts:12:4")).toMatchObject({
    _tag: "Success",
    value: "browser",
  });
  expect(state.openBrowser).toHaveBeenCalledExactlyOnceWith("/work/tree/main.ts:12:4", true);
  expect(state.run).not.toHaveBeenCalled();
  expect(state.openUrl).not.toHaveBeenCalled();
  expect(state.setPreference).not.toHaveBeenCalled();
});

it("reads the latest explicit selection at invocation without replacing it", async () => {
  state.allowed.add(secondary);
  const open = useEditorAction(secondary, ["vscode"], workspace).open;
  state.getPreference.mockReturnValue("vscode");
  expect(await open("/work/tree/main.ts:8:2")).toMatchObject({ _tag: "Success", value: "vscode" });
  expect(state.run).toHaveBeenCalledExactlyOnceWith({
    environmentId: secondary,
    input: { cwd: "/work/tree/main.ts:8:2", editor: "vscode" },
  });
  state.getPreference.mockReturnValue("browser");
  expect(await open("/work/tree")).toMatchObject({ _tag: "Success", value: "browser" });
  expect(state.setPreference).not.toHaveBeenCalled();
});

it("retains an unavailable native selection instead of opening browser or another editor", async () => {
  state.allowed.add(secondary);
  state.getPreference.mockReturnValue("cursor");
  expect(
    (await useEditorAction(secondary, ["vscode"], workspace).open("/work/tree/main.ts"))._tag,
  ).toBe("Failure");
  expect(state.run).not.toHaveBeenCalled();
  expect(state.openBrowser).not.toHaveBeenCalled();
  expect(state.setPreference).not.toHaveBeenCalled();
});

it("uses the selected environment's SSH link and preserves position", async () => {
  state.remote = {
    mode: "remote-links",
    host: { host: "workstation", username: "dev", kind: "ssh-alias" },
  };
  state.getPreference.mockReturnValue("vscode");
  expect(
    (await useEditorAction(secondary, ["cursor"], workspace).open("/work/tree/a b.ts:9:3"))._tag,
  ).toBe("Success");
  expect(state.openUrl).toHaveBeenCalledExactlyOnceWith(
    "vscode://vscode-remote/ssh-remote+dev%40workstation/work/tree/a%20b.ts:9:3",
  );
  expect(state.run).not.toHaveBeenCalled();
  expect(state.setPreference).not.toHaveBeenCalled();
});

it("reports browser unavailability without falling back to native, while native remains usable", async () => {
  state.allowed.add(secondary);
  state.browserReason = "convene.ide.denied";
  const action = useEditorAction(secondary, ["vscode"], workspace);
  expect((await action.open("/work/tree/main.ts"))._tag).toBe("Failure");
  expect(state.run).not.toHaveBeenCalled();
  expect(state.openBrowser).not.toHaveBeenCalled();
  expect(await action.open("/work/tree/main.ts", { editor: "vscode" })).toMatchObject({
    _tag: "Success",
    value: "vscode",
  });
  expect(state.setPreference).not.toHaveBeenCalled();
});

it("accepts regranted native access on a retained action", async () => {
  state.getPreference.mockReturnValue("vscode");
  const action = useEditorAction(secondary, ["vscode"], workspace);
  expect((await action.open("/work/tree/main.ts"))._tag).toBe("Failure");
  state.allowed.add(secondary);
  expect((await action.open("/work/tree/main.ts"))._tag).toBe("Success");
});

it("reveals the actual file instead of treating its line and column as part of the filename", async () => {
  state.allowed.add(secondary);
  state.getPreference.mockReturnValue("file-manager");
  await useEditorAction(secondary, ["file-manager"], workspace).open("/work/tree/main.ts:20:4", {
    reveal: true,
  });
  expect(state.run).toHaveBeenCalledExactlyOnceWith({
    environmentId: secondary,
    input: { cwd: "/work/tree/main.ts", editor: "file-manager", reveal: true },
  });
});

it("waits for native connection details without blocking browser editing", async () => {
  state.allowed.add(secondary);
  state.remoteResolved = false;
  state.getPreference.mockReturnValue("vscode");
  const action = useEditorAction(secondary, ["vscode"], workspace);
  expect((await action.open("/work/tree/main.ts"))._tag).toBe("Failure");
  expect(state.run).not.toHaveBeenCalled();
  expect(await action.open("/work/tree/main.ts", { editor: "browser" })).toMatchObject({
    _tag: "Success",
    value: "browser",
  });
});
