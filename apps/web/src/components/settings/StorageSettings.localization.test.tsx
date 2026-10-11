// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, type UnifiedSettings } from "@t3tools/contracts";
import { resolveWorktreeCleanup } from "@t3tools/shared/projectSettings";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

const state = vi.hoisted(() => ({
  settings: null as UnifiedSettings | null,
  project: false,
  update: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("./useScopedSettings", () => ({
  useScopedSettings: () => state.settings,
  useScopedSettingsMixed: () => false,
  useUpdateScopedSettings: () => state.update,
  useClearScopedSettings: () => state.clear,
}));
vi.mock("./SettingsScopeContext", () => ({
  useSettingsScope: () => {
    const target = {
      environmentId: EnvironmentId.make("controlled-host"),
      settings: state.settings,
      sources: { worktreeCleanup: state.project ? "project" : "environment" },
    };
    return {
      scope: { kind: state.project ? "project" : "environment" },
      target,
      targets: [target],
      connectedEnvironments: [
        {
          environmentId: target.environmentId,
          serverConfig: {
            environment: {
              capabilities: {
                worktreesDirectory: true,
                projectWorktreeCleanup: true,
                storageCleanup: true,
              },
            },
          },
        },
      ],
    };
  },
}));
vi.mock("./settingsLayout", () => ({
  SettingsRow: ({
    title,
    description,
    control,
    resetAction,
  }: {
    title: ReactNode;
    description: ReactNode;
    control: ReactNode;
    resetAction: ReactNode;
  }) => (
    <section>
      {title}
      {description}
      {control}
      {resetAction}
    </section>
  ),
  SettingsSection: ({ title, children }: { title: ReactNode; children: ReactNode }) => (
    <section>
      {title}
      {children}
    </section>
  ),
  SettingsPageContainer: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  SettingResetButton: ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button onClick={onClick}>{label}</button>
  ),
}));

import { changeLanguage } from "../../i18n";
import { StorageSettingsPanel } from "./StorageSettings";

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await changeLanguage("en");
  state.project = false;
  state.settings = {
    ...DEFAULT_UNIFIED_SETTINGS,
    worktreesDirectory: "/original/path",
    storageCleanup: { ...DEFAULT_UNIFIED_SETTINGS.storageCleanup, logsAfterDays: 14 },
  };
  state.update.mockReset();
  state.clear.mockReset();
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
const render = async () => act(async () => root.render(<StorageSettingsPanel />));
const switchLanguage = async (language: "en" | "zh") => act(async () => changeLanguage(language));
const type = async (input: HTMLInputElement, value: string) =>
  act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

it("preserves an uncommitted worktree directory while labels switch and writes the original path on blur", async () => {
  await render();
  await type(
    container.querySelector<HTMLInputElement>('input[aria-label="Worktree location"]')!,
    "/raw/path with spaces/worktrees",
  );
  await switchLanguage("zh");
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Git 工作树位置"]')!;
  expect(input.value).toBe("/raw/path with spaces/worktrees");
  expect(state.update).not.toHaveBeenCalled();
  await act(async () => input.blur());
  expect(state.update).toHaveBeenCalledExactlyOnceWith({
    worktreesDirectory: "/raw/path with spaces/worktrees",
  });
});

it("preserves a retention draft and submits days under the original cleanup key", async () => {
  await render();
  await type(
    container.querySelector<HTMLInputElement>(
      'input[aria-label="Delete old rotated logs in days"]',
    )!,
    "21",
  );
  await switchLanguage("zh");
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="清理旧轮转日志（天）"]',
  )!;
  expect(input.value).toBe("21");
  expect(state.update).not.toHaveBeenCalled();
  await act(async () => input.blur());
  expect(state.update).toHaveBeenCalledExactlyOnceWith({ storageCleanup: { logsAfterDays: 21 } });
});

it("uses translated project modes without translating their stored values or inheritance keys", async () => {
  state.project = true;
  state.settings = {
    ...state.settings!,
    worktreeCleanup: { mode: "custom", rules: resolveWorktreeCleanup(state.settings!, null) },
  };
  await render();
  await switchLanguage("zh");
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label="自动清理 Git 工作树"]',
  )!;
  await act(async () => trigger.click());
  const choice = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (node) => node.textContent?.trim() === "关闭",
  )!;
  await act(async () => choice.click());
  expect(state.update).toHaveBeenCalledExactlyOnceWith({ worktreeCleanup: { mode: "off" } });
  expect(state.clear).not.toHaveBeenCalled();
  await act(async () => trigger.click());
  const inherit = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (node) => node.textContent?.trim() === "继承",
  )!;
  await act(async () => inherit.click());
  expect(state.clear).toHaveBeenCalledExactlyOnceWith(["worktreeCleanup"]);
});
