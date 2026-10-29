import "~/index.css";
import { act, render } from "../../test/render";

import { i18n } from "~/i18n";
import { RegistryContext } from "@effect/atom-react";
import {
  AuthSettingsWriteScope,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type AuthEnvironmentScope,
  type AuthSessionState,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

type SessionResult = AsyncResult.AsyncResult<AuthSessionState, Error>;
const state = vi.hoisted(() => ({
  sessions: new Map<EnvironmentId, Atom.Writable<SessionResult>>(),
  environments: [] as Array<{
    environmentId: EnvironmentId;
    label: string;
    connection: { phase: "connected" | "disconnected" };
    serverConfig: { settings: typeof DEFAULT_SERVER_SETTINGS } | null;
  }>,
  persist: vi.fn(),
  toast: vi.fn(),
}));

vi.mock(import("@t3tools/client-runtime/state/session"), async (original) => ({
  ...(await original()),
  createEnvironmentSessionAtoms: (() => ({
    sessionStateAtom: (id: EnvironmentId) => state.sessions.get(id)!,
  })) as never,
}));
vi.mock(import("~/state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({ environments: state.environments })) as never,
  usePrimaryEnvironment: (() =>
    state.environments.find((environment) => environment.environmentId === primaryId) ??
    null) as never,
}));
vi.mock(import("~/state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => state.persist) as never,
}));
vi.mock(import("~/components/ui/toast"), async (original) => {
  const actual = await original();
  return { ...actual, toastManager: { ...actual.toastManager, add: state.toast } };
});

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useUpdatePrimarySettings } from "./useSettings";

const primaryId = EnvironmentId.make("primary");
const remoteId = EnvironmentId.make("remote");
const patch = { sidebarAutoSettleOnMerge: false } satisfies ServerSettingsPatch;
const session = (scopes: ReadonlyArray<AuthEnvironmentScope>): AuthSessionState => ({
  authenticated: true,
  scopes,
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: ["one-time-token"],
    sessionMethods: ["bearer-access-token"],
    sessionCookieName: "t3_session",
  },
});
function SettingsEditor({
  handlers,
  settingPatch,
}: {
  handlers: Array<() => void>;
  settingPatch: ServerSettingsPatch;
}) {
  const updateSettings = useUpdatePrimarySettings();
  const save = () => void updateSettings(settingPatch);
  handlers.push(save);
  return <button onClick={save}>Save shared setting</button>;
}

async function mountEditor(settingPatch: ServerSettingsPatch = patch) {
  const handlers: Array<() => void> = [];
  const screen = await render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <SettingsEditor handlers={handlers} settingPatch={settingPatch} />
    </RegistryContext.Provider>,
  );
  return {
    handlers,
    saveSharedSettings: () => screen.container.querySelector("button")!.click(),
    [Symbol.asyncDispose]: () => screen[Symbol.asyncDispose](),
  };
}

function setup() {
  state.sessions.clear();
  state.sessions.set(
    primaryId,
    Atom.make<SessionResult>(AsyncResult.success(session([AuthSettingsWriteScope]))),
  );
  state.sessions.set(remoteId, Atom.make<SessionResult>(AsyncResult.initial()));
  state.environments = [primaryId, remoteId].map((environmentId) => ({
    environmentId,
    label: environmentId,
    connection: { phase: "connected" },
    serverConfig: {
      settings: DEFAULT_SERVER_SETTINGS,
    },
  }));
  state.persist.mockReset();
  state.persist.mockResolvedValue(AsyncResult.success(DEFAULT_SERVER_SETTINGS));
  state.toast.mockReset();
}

describe("shared settings writes", () => {
  it("waits for the remaining target before reporting a partial save", async () => {
    await using _lifecycle = await setupLifecycle();

    setup();
    let finishRemote = () => {};
    const remote = new Promise((resolve) => {
      finishRemote = () => resolve(AsyncResult.success(DEFAULT_SERVER_SETTINGS));
    });
    state.persist.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new Error("Permission denied"))),
    );
    state.persist.mockReturnValueOnce(remote);
    await using editor = await mountEditor();
    await act(async () => editor.saveSharedSettings());
    expect(state.toast).not.toHaveBeenCalled();
    await act(async () => finishRemote());
    expect(state.toast).toHaveBeenCalledExactlyOnceWith({
      type: "error",
      title: "Setting saved on some environments",
      description: "Could not save on primary: Permission denied\nSaved on remote.",
    });
  });

  it("keeps a single-target failure specific to that environment", async () => {
    await using _lifecycle = await setupLifecycle();

    setup();
    appAtomRegistry.set(state.sessions.get(remoteId)!, AsyncResult.success(session([])));
    state.persist.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new Error("Permission denied"))),
    );
    await using editor = await mountEditor();
    await act(async () => editor.saveSharedSettings());
    expect(state.toast).toHaveBeenCalledExactlyOnceWith({
      type: "error",
      title: "Setting not saved",
      description: "Could not save on primary: Permission denied",
    });
  });

  it("names the failed environment when a server rejects a save after the grant check", async () => {
    await using _lifecycle = await setupLifecycle();

    setup();
    state.persist.mockResolvedValueOnce(AsyncResult.success(DEFAULT_SERVER_SETTINGS));
    state.persist.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new Error("Permission denied"))),
    );
    await using editor = await mountEditor();
    await act(async () => editor.saveSharedSettings());
    expect(state.toast).toHaveBeenCalledExactlyOnceWith({
      type: "error",
      title: "Setting saved on some environments",
      description: "Could not save on remote: Permission denied\nSaved on primary.",
    });
  });

  it("dispatches to the primary and connected remote before the remote grant finishes loading", async () => {
    await using _lifecycle = await setupLifecycle();

    setup();
    await using editor = await mountEditor();
    editor.saveSharedSettings();

    expect(state.persist.mock.calls).toEqual([
      [{ environmentId: primaryId, input: { patch } }],
      [{ environmentId: remoteId, input: { patch } }],
    ]);
    expect(appAtomRegistry.get(state.sessions.get(remoteId)!)).toMatchObject({ _tag: "Initial" });
  });

  it.each([
    ["denied", () => AsyncResult.success(session([]))],
    ["denied while refreshing", () => AsyncResult.waiting(AsyncResult.success(session([])))],
    [
      "failed",
      () => AsyncResult.failure<AuthSessionState, Error>(Cause.fail(new Error("session rejected"))),
    ],
  ] as const)("skips a remote whose grant is %s", async (_label, result) => {
    await using _lifecycle = await setupLifecycle();

    setup();
    appAtomRegistry.set(state.sessions.get(remoteId)!, result());
    await using editor = await mountEditor();
    editor.saveSharedSettings();

    expect(state.persist).toHaveBeenCalledExactlyOnceWith({
      environmentId: primaryId,
      input: { patch },
    });
  });

  it.each(["disconnected", "config-unavailable"] as const)(
    "skips a %s remote even with a cold grant",
    async (condition) => {
      await using _lifecycle = await setupLifecycle();

      setup();
      const remote = state.environments[1]!;
      if (condition === "disconnected") remote.connection.phase = "disconnected";
      else remote.serverConfig = null;
      await using editor = await mountEditor();
      editor.saveSharedSettings();

      expect(state.persist).toHaveBeenCalledExactlyOnceWith({
        environmentId: primaryId,
        input: { patch },
      });
    },
  );

  it.each(["primary", "hosted"] as const)(
    "rechecks a cold remote grant that resolves to denied after the %s handler renders",
    async (mode) => {
      await using _lifecycle = await setupLifecycle();

      setup();
      if (mode === "hosted") {
        state.environments = state.environments.filter(
          (environment) => environment.environmentId !== primaryId,
        );
      }
      await using editor = await mountEditor();
      const previousUpdate = editor.handlers.at(-1)!;
      await act(() => {
        appAtomRegistry.set(state.sessions.get(remoteId)!, AsyncResult.success(session([])));
      });
      previousUpdate();

      if (mode === "primary") {
        expect(state.persist).toHaveBeenCalledExactlyOnceWith({
          environmentId: primaryId,
          input: { patch },
        });
        expect(state.toast).not.toHaveBeenCalled();
      } else {
        expect(state.persist).not.toHaveBeenCalled();
        expect(state.toast).toHaveBeenCalledExactlyOnceWith({
          type: "warning",
          title: "Setting not saved",
          description: "This connection lacks permission to change settings on remote.",
        });
      }
    },
  );

  it("uses the language at completion and preserves failed and saved environment names", async () => {
    await using _lifecycle = await setupLifecycle();

    setup();
    let finishPrimary = () => {};
    const pending = new Promise((resolve) => {
      finishPrimary = () =>
        resolve(
          AsyncResult.failure(
            Cause.fail(new Error("Permission denied /tmp/原文\nKeep diagnostic")),
          ),
        );
    });
    state.environments[0]!.label = "开发电脑 原文";
    state.environments[1]!.label = "QA remote 原文";
    state.persist.mockReturnValueOnce(pending);
    await using editor = await mountEditor();
    await act(async () => editor.saveSharedSettings());
    expect(state.toast).not.toHaveBeenCalled();
    await i18n.changeLanguage("zh");
    await act(async () => finishPrimary());
    expect(state.persist).toHaveBeenCalledTimes(2);
    expect(state.toast).toHaveBeenCalledExactlyOnceWith({
      type: "error",
      title: "设置仅在部分执行环境保存成功",
      description:
        "无法在 开发电脑 原文 保存：Permission denied /tmp/原文\nKeep diagnostic\n已在 QA remote 原文 保存。",
    });
  });

  it("translates a local setting failure at completion without resending the write", async () => {
    await using _lifecycle = await setupLifecycle();

    setup();
    const localPatch = { worktreesDirectory: "/tmp/qa 原文" } satisfies ServerSettingsPatch;
    let finishSave = () => {};
    state.persist.mockReturnValueOnce(
      new Promise((resolve) => {
        finishSave = () =>
          resolve(AsyncResult.failure(Cause.fail(new Error("Disk is full /tmp/qa 原文"))));
      }),
    );
    await using editor = await mountEditor(localPatch);
    await act(async () => editor.saveSharedSettings());
    await i18n.changeLanguage("zh");
    await act(async () => finishSave());
    expect(state.persist).toHaveBeenCalledExactlyOnceWith({
      environmentId: primaryId,
      input: { patch: localPatch },
    });
    expect(state.toast).toHaveBeenCalledExactlyOnceWith({
      type: "error",
      title: "设置未保存",
      description: "无法在 primary 保存：Disk is full /tmp/qa 原文",
    });
  });

  it("names a denied environment in Chinese and does not dispatch", async () => {
    await using _lifecycle = await setupLifecycle();

    setup();
    state.environments[0]!.label = "开发电脑 原文";
    appAtomRegistry.set(state.sessions.get(primaryId)!, AsyncResult.success(session([])));
    await i18n.changeLanguage("zh");
    await using editor = await mountEditor();
    await act(async () => editor.saveSharedSettings());
    expect(state.persist).not.toHaveBeenCalled();
    expect(state.toast).toHaveBeenCalledExactlyOnceWith({
      type: "warning",
      title: "设置未保存",
      description: "此连接无权更改 开发电脑 原文 上的设置。",
    });
  });

  it("explains an unanchored hosted local setting in Chinese", async () => {
    await using _lifecycle = await setupLifecycle();

    setup();
    state.environments = state.environments.filter(
      (environment) => environment.environmentId !== primaryId,
    );
    await i18n.changeLanguage("zh");
    await using editor = await mountEditor({ worktreesDirectory: "/tmp/qa 原文" });
    await act(async () => editor.saveSharedSettings());
    expect(state.persist).not.toHaveBeenCalled();
    expect(state.toast).toHaveBeenCalledExactlyOnceWith({
      type: "warning",
      title: "设置未保存",
      description:
        "此设置保存在服务端，而托管应用没有固定的主执行环境。请在桌面应用中或通过服务端自身的地址更改。",
    });
  });

  it.each([
    ["en", "Setting not saved", "Update older servers to save this setting."],
    ["zh", "设置未保存", "请更新旧版服务端后再保存此设置。"],
  ])(
    "holds a shared restart setting in %s until server configs load",
    async (language, title, description) => {
      await using _lifecycle = await setupLifecycle();

      setup();
      await i18n.changeLanguage(language);
      for (const environment of state.environments) environment.serverConfig = null;
      await using editor = await mountEditor({ continueThreadsAfterServerUpdate: true });
      await act(async () => editor.saveSharedSettings());
      expect(state.persist).not.toHaveBeenCalled();
      expect(state.toast).toHaveBeenCalledExactlyOnceWith({ type: "warning", title, description });
    },
  );

  it("translates a hosted permission rejection when a pending grant resolves before execution", async () => {
    await using _lifecycle = await setupLifecycle();

    setup();
    state.environments = state.environments.filter(
      (environment) => environment.environmentId !== primaryId,
    );
    state.environments[0]!.label = "远程电脑 / Raw laptop";
    await using editor = await mountEditor();
    const previousUpdate = editor.handlers.at(-1)!;
    await act(async () => {
      await i18n.changeLanguage("zh");
      appAtomRegistry.set(state.sessions.get(remoteId)!, AsyncResult.success(session([])));
    });
    await act(() => previousUpdate());
    expect(state.persist).not.toHaveBeenCalled();
    expect(state.toast).toHaveBeenCalledExactlyOnceWith({
      type: "warning",
      title: "设置未保存",
      description: "此连接无权更改 远程电脑 / Raw laptop 上的设置。",
    });
  });
});

async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  stack.defer(async () => {
    await i18n.changeLanguage("en");
  });

  return stack.move();
}
