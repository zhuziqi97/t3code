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
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

type SessionResult = AsyncResult.AsyncResult<AuthSessionState, Error>;
const state = vi.hoisted(() => ({
  registry: null as AtomRegistry.AtomRegistry | null,
  sessions: new Map<EnvironmentId, Atom.Writable<SessionResult>>(),
  environments: [] as Array<{
    environmentId: EnvironmentId;
    label: string;
    connection: { phase: "connected" | "disconnected" };
    serverConfig: {
      environment: { capabilities: { threadAutoSettlement: boolean } };
      settings: typeof DEFAULT_SERVER_SETTINGS;
    };
  }>,
  persist: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("~/connection/runtime", () => ({ connectionAtomRuntime: undefined }));
vi.mock("@t3tools/client-runtime/state/session", () => ({
  createEnvironmentSessionAtoms: () => ({
    sessionStateAtom: (id: EnvironmentId) => state.sessions.get(id)!,
  }),
}));
vi.mock("~/rpc/atomRegistry", () => ({
  get appAtomRegistry() {
    return state.registry;
  },
}));
vi.mock("~/state/environments", () => ({
  useEnvironments: () => ({ environments: state.environments }),
  usePrimaryEnvironment: () =>
    state.environments.find((environment) => environment.environmentId === primaryId) ?? null,
}));
vi.mock("~/state/server", () => ({
  serverEnvironment: { updateSettings: Symbol("updateSettings") },
  primaryServerSettingsAtom: undefined,
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => state.persist }));
vi.mock("~/components/ui/toast", () => ({ toastManager: { add: state.toast } }));
vi.mock("~/themePalette", () => ({}));
vi.mock("./useTheme", () => ({}));

import { useUpdatePrimarySettings } from "./useSettings";
import { i18n } from "~/i18n";

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
let renderer: ReactTestRenderer | undefined;

function SettingsEditor({ settingPatch = patch }: { settingPatch?: ServerSettingsPatch }) {
  const updateSettings = useUpdatePrimarySettings();
  return <button onClick={() => updateSettings(settingPatch)}>Save setting</button>;
}

function saveSharedSettings() {
  renderer!.root.findByType("button").props.onClick();
}

async function mountEditor(settingPatch: ServerSettingsPatch = patch) {
  await act(() => {
    renderer = create(
      <RegistryContext.Provider value={state.registry!}>
        <SettingsEditor settingPatch={settingPatch} />
      </RegistryContext.Provider>,
    );
  });
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.registry = AtomRegistry.make();
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
      environment: { capabilities: { threadAutoSettlement: true } },
      settings: DEFAULT_SERVER_SETTINGS,
    },
  }));
  state.persist.mockReset();
  state.persist.mockResolvedValue(AsyncResult.success(DEFAULT_SERVER_SETTINGS));
  state.toast.mockReset();
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  state.registry?.dispose();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

describe("shared settings writes", () => {
  it("uses the language at completion and preserves failed and saved environment names", async () => {
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
    await mountEditor();
    await act(async () => saveSharedSettings());
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
    const localPatch = { worktreesDirectory: "/tmp/qa 原文" } satisfies ServerSettingsPatch;
    let finishSave = () => {};
    state.persist.mockReturnValueOnce(
      new Promise((resolve) => {
        finishSave = () =>
          resolve(AsyncResult.failure(Cause.fail(new Error("Disk is full /tmp/qa 原文"))));
      }),
    );
    await mountEditor(localPatch);
    await act(async () => saveSharedSettings());
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
    state.environments[0]!.label = "开发电脑 原文";
    state.registry!.set(state.sessions.get(primaryId)!, AsyncResult.success(session([])));
    await i18n.changeLanguage("zh");
    await mountEditor();
    await act(async () => saveSharedSettings());
    expect(state.persist).not.toHaveBeenCalled();
    expect(state.toast).toHaveBeenCalledExactlyOnceWith({
      type: "warning",
      title: "设置未保存",
      description: "此连接无权更改 开发电脑 原文 上的设置。",
    });
  });

  it("explains an unanchored hosted local setting in Chinese", async () => {
    state.environments = state.environments.filter(
      (environment) => environment.environmentId !== primaryId,
    );
    await i18n.changeLanguage("zh");
    await mountEditor({ worktreesDirectory: "/tmp/qa 原文" });
    await act(async () => saveSharedSettings());
    expect(state.persist).not.toHaveBeenCalled();
    expect(state.toast).toHaveBeenCalledExactlyOnceWith({
      type: "warning",
      title: "设置未保存",
      description:
        "此设置保存在服务端，而托管应用没有固定的主执行环境。请在桌面应用中或通过服务端自身的地址更改。",
    });
  });

  it("waits for the remaining target before reporting a partial save", async () => {
    let finishRemote = () => {};
    const remote = new Promise((resolve) => {
      finishRemote = () => resolve(AsyncResult.success(DEFAULT_SERVER_SETTINGS));
    });
    state.persist.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new Error("Permission denied"))),
    );
    state.persist.mockReturnValueOnce(remote);
    await mountEditor();
    await act(async () => saveSharedSettings());
    expect(state.toast).not.toHaveBeenCalled();
    await act(async () => finishRemote());
    expect(state.toast).toHaveBeenCalledExactlyOnceWith({
      type: "error",
      title: "Setting saved on some environments",
      description: "Could not save on primary: Permission denied\nSaved on remote.",
    });
  });

  it.each([
    ["en", "Setting not saved", "Update older servers to save this setting."],
    ["zh", "设置未保存", "请更新旧版服务端后再保存此设置。"],
  ])(
    "explains an unsupported shared setting in %s without writing it",
    async (language, title, description) => {
      await i18n.changeLanguage(language);
      await mountEditor({ continueThreadsAfterServerUpdate: true });
      await act(async () => saveSharedSettings());
      expect(state.persist).not.toHaveBeenCalled();
      expect(state.toast).toHaveBeenCalledExactlyOnceWith({ type: "warning", title, description });
    },
  );

  it("translates a hosted permission rejection when a pending grant resolves before execution", async () => {
    state.environments = state.environments.filter(
      (environment) => environment.environmentId !== primaryId,
    );
    state.environments[0]!.label = "远程电脑 / Raw laptop";
    await mountEditor();
    const previousUpdate = renderer!.root.findByType("button").props.onClick as () => void;
    await act(async () => {
      await i18n.changeLanguage("zh");
      state.registry!.set(state.sessions.get(remoteId)!, AsyncResult.success(session([])));
    });
    await act(() => previousUpdate());
    expect(state.persist).not.toHaveBeenCalled();
    expect(state.toast).toHaveBeenCalledExactlyOnceWith({
      type: "warning",
      title: "设置未保存",
      description: "此连接无权更改 远程电脑 / Raw laptop 上的设置。",
    });
  });

  it("keeps a single-target failure specific to that environment", async () => {
    state.registry!.set(state.sessions.get(remoteId)!, AsyncResult.success(session([])));
    state.persist.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new Error("Permission denied"))),
    );
    await mountEditor();
    await act(async () => saveSharedSettings());
    expect(state.toast).toHaveBeenCalledExactlyOnceWith({
      type: "error",
      title: "Setting not saved",
      description: "Could not save on primary: Permission denied",
    });
  });

  it("names the failed environment when a server rejects a save after the grant check", async () => {
    state.persist.mockResolvedValueOnce(AsyncResult.success(DEFAULT_SERVER_SETTINGS));
    state.persist.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new Error("Permission denied"))),
    );
    await mountEditor();
    await act(async () => saveSharedSettings());
    expect(state.toast).toHaveBeenCalledExactlyOnceWith({
      type: "error",
      title: "Setting saved on some environments",
      description: "Could not save on remote: Permission denied\nSaved on primary.",
    });
  });

  it("dispatches to the primary and connected remote before the remote grant finishes loading", async () => {
    await mountEditor();
    saveSharedSettings();

    expect(state.persist.mock.calls).toEqual([
      [{ environmentId: primaryId, input: { patch } }],
      [{ environmentId: remoteId, input: { patch } }],
    ]);
    expect(state.registry!.get(state.sessions.get(remoteId)!)).toMatchObject({ _tag: "Initial" });
  });

  it.each([
    ["denied", () => AsyncResult.success(session([]))],
    ["denied while refreshing", () => AsyncResult.waiting(AsyncResult.success(session([])))],
    [
      "failed",
      () => AsyncResult.failure<AuthSessionState, Error>(Cause.fail(new Error("session rejected"))),
    ],
  ] as const)("skips a remote whose grant is %s", async (_label, result) => {
    state.registry!.set(state.sessions.get(remoteId)!, result());
    await mountEditor();
    saveSharedSettings();

    expect(state.persist).toHaveBeenCalledExactlyOnceWith({
      environmentId: primaryId,
      input: { patch },
    });
  });

  it.each(["disconnected", "unsupported"] as const)(
    "skips a %s remote even with a cold grant",
    async (condition) => {
      const remote = state.environments[1]!;
      if (condition === "disconnected") remote.connection.phase = "disconnected";
      else remote.serverConfig.environment.capabilities.threadAutoSettlement = false;
      await mountEditor();
      saveSharedSettings();

      expect(state.persist).toHaveBeenCalledExactlyOnceWith({
        environmentId: primaryId,
        input: { patch },
      });
    },
  );

  it.each(["primary", "hosted"] as const)(
    "rechecks a cold remote grant that resolves to denied after the %s handler renders",
    async (mode) => {
      if (mode === "hosted") {
        state.environments = state.environments.filter(
          (environment) => environment.environmentId !== primaryId,
        );
      }
      await mountEditor();
      const previousUpdate = renderer!.root.findByType("button").props.onClick as () => void;
      await act(() => {
        state.registry!.set(state.sessions.get(remoteId)!, AsyncResult.success(session([])));
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
});
