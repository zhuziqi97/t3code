// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { DEFAULT_SERVER_SETTINGS, EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";

const state = vi.hoisted(() => ({
  allowed: true,
  offline: false,
  named: false,
  persist: vi.fn(),
  client: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.persist }));
vi.mock("../../state/server", () => ({ serverEnvironment: { updateSettings: "update" } }));
vi.mock("../../state/session", () => ({ readEnvironmentScope: () => state.allowed }));
vi.mock("../../hooks/useSettings", () => ({ persistClientSettingsPatch: state.client }));
vi.mock("../ui/toast", () => ({ toastManager: { add: state.toast } }));
vi.mock("./SettingsScopeContext", () => ({
  useSettingsScope: () => {
    const environments = [
      {
        environmentId: EnvironmentId.make("raw-laptop"),
        label: "My raw laptop",
        connection: { phase: state.offline ? "offline" : "connected" },
        serverConfig: { settings: DEFAULT_SERVER_SETTINGS },
      },
      {
        environmentId: EnvironmentId.make("raw-server"),
        label: "My raw server",
        connection: { phase: "connected" },
        serverConfig: { settings: DEFAULT_SERVER_SETTINGS },
      },
    ];
    return {
      environments,
      scope: resolveSettingsScope(
        state.named ? { machine: environments[0]!.environmentId } : {},
        [],
        environments,
      ),
    };
  },
}));

import { changeLanguage, useTranslate } from "../../i18n";
import { resolveSettingsScope } from "./settingsScope";
import { useUpdateScopedSettings } from "./useScopedSettings";

function SettingsSave() {
  const t = useTranslate();
  const update = useUpdateScopedSettings();
  return (
    <button onClick={() => update({ enableAgentBrowserAccess: false })}>{t("common.save")}</button>
  );
}
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await changeLanguage("en");
  state.allowed = true;
  state.offline = false;
  state.named = false;
  state.persist.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.client.mockReset();
  state.toast.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLanguage("en");
  vi.unstubAllGlobals();
});
const render = async () => act(async () => root.render(<SettingsSave />));
const save = async () =>
  act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
const switchLanguage = async (language: "en" | "zh") => act(async () => changeLanguage(language));

it("reports a partial save in the current language while keeping raw errors and avoiding repeat writes", async () => {
  let finish: (result: ReturnType<typeof AsyncResult.failure>) => void = () => undefined;
  state.persist.mockResolvedValueOnce(AsyncResult.success(undefined)).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await save();
  expect(state.persist).toHaveBeenCalledTimes(2);
  expect(state.toast).not.toHaveBeenCalled();
  await switchLanguage("zh");
  expect(state.persist).toHaveBeenCalledTimes(2);
  await act(async () =>
    finish(AsyncResult.failure(Cause.fail(new Error("raw network diagnostic")))),
  );
  expect(state.toast).toHaveBeenCalledExactlyOnceWith({
    type: "error",
    title: "设置仅在部分执行环境保存成功",
    description: "无法在 My raw server 保存：raw network diagnostic\n已在 My raw laptop 保存。",
  });
  expect(state.persist.mock.calls.map(([request]) => request)).toEqual([
    { environmentId: "raw-laptop", input: { patch: { enableAgentBrowserAccess: false } } },
    { environmentId: "raw-server", input: { patch: { enableAgentBrowserAccess: false } } },
  ]);
});

it("blocks unauthorized writes and reports the translated permission failure", async () => {
  state.allowed = false;
  await render();
  await switchLanguage("zh");
  await save();
  expect(state.persist).not.toHaveBeenCalled();
  expect(state.toast).toHaveBeenCalledExactlyOnceWith({
    type: "error",
    title: "设置未保存",
    description:
      "无法在 My raw laptop 保存：此连接没有修改这些设置的权限。\n无法在 My raw server 保存：此连接没有修改这些设置的权限。",
  });
});

it("keeps an offline named scope from broadening its write and names it in the warning", async () => {
  state.offline = true;
  state.named = true;
  await render();
  await switchLanguage("zh");
  await save();
  expect(state.persist).not.toHaveBeenCalled();
  expect(state.client).not.toHaveBeenCalled();
  expect(state.toast).toHaveBeenCalledExactlyOnceWith({
    type: "warning",
    title: "设置未保存",
    description: "请连接 My raw laptop 以保存此设置。",
  });
});
