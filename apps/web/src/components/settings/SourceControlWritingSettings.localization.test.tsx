// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, type UnifiedSettings } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

const state = vi.hoisted(() => ({
  settings: [] as UnifiedSettings[],
  update: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("./useScopedSettings", () => ({
  useScopedSettings: () => state.settings[0],
  useScopedSettingsMixed: (keys: (keyof UnifiedSettings)[]) =>
    keys.some((key) =>
      state.settings.some((settings) => settings[key] !== state.settings[0]![key]),
    ),
  useUpdateScopedSettings: () => state.update,
}));
vi.mock("./SettingsScopeContext", () => ({
  useSettingsScope: () => ({
    environment: null,
    connectedEnvironments: [],
    targets: state.settings.map((settings, index) => ({
      environmentId: EnvironmentId.make(`controlled-host-${index}`),
      projectId: null,
      settings,
    })),
  }),
}));
vi.mock("./useScopedModelAvailability", () => ({
  useScopedModelDisabledReason: () => () => null,
}));
vi.mock("../../state/server", () => ({ EMPTY_SERVER_PROVIDERS: [] }));
vi.mock("../chat/ProviderModelPicker", () => ({ ProviderModelPicker: () => null }));
vi.mock("./settingsLayout", () => ({
  SETTINGS_PICKER_TRIGGER_CLASSNAME: "",
  SettingsRow: ({
    title,
    description,
    control,
    resetAction,
    children,
  }: {
    title: ReactNode;
    description: ReactNode;
    control: ReactNode;
    resetAction: ReactNode;
    children: ReactNode;
  }) => (
    <section>
      {title}
      {description}
      {control}
      {resetAction}
      {children}
    </section>
  ),
  SettingsSection: ({ title, children }: { title: ReactNode; children: ReactNode }) => (
    <section>
      {title}
      {children}
    </section>
  ),
  SettingResetButton: ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button onClick={onClick}>{label}</button>
  ),
}));

import { changeLanguage } from "../../i18n";
import { SourceControlWritingSettingsSection } from "./SourceControlWritingSettings";

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await changeLanguage("en");
  state.settings = [
    {
      ...DEFAULT_UNIFIED_SETTINGS,
      branchNamingMode: "static",
      branchNamePrefix: "my/",
      sourceControlWritingStyle: {
        ...DEFAULT_UNIFIED_SETTINGS.sourceControlWritingStyle,
        mode: "custom",
        customInstructions: "Original instructions",
      },
    },
  ];
  state.update.mockReset();
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

const render = async () => act(async () => root.render(<SourceControlWritingSettingsSection />));
const switchLanguage = async () => act(async () => changeLanguage("zh"));
const type = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) =>
  act(async () => {
    input.focus();
    const prototype =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === label,
  )!;
async function choose(label: string, optionLabel: string) {
  await act(async () =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click(),
  );
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (node) => node.textContent?.trim() === optionLabel,
  )!;
  await act(async () => option.click());
}

it("keeps custom writing drafts through a language switch and saves native writing modes", async () => {
  await render();
  await type(
    container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Custom source control writing instructions"]',
    )!,
    "  Preserve MY-PROJECT and issue #42.  ",
  );
  await switchLanguage();
  const input = container.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="版本控制写作自定义指令"]',
  )!;
  expect(input.value).toBe("  Preserve MY-PROJECT and issue #42.  ");
  expect(state.update).not.toHaveBeenCalled();
  await act(async () => input.blur());
  expect(state.update).toHaveBeenCalledExactlyOnceWith({
    sourceControlWritingStyle: { customInstructions: "Preserve MY-PROJECT and issue #42." },
  });
  await choose("版本控制写作风格", "约定式提交");
  expect(state.update).toHaveBeenLastCalledWith({
    sourceControlWritingStyle: {
      mode: "conventional_commits",
      customInstructions: "Preserve MY-PROJECT and issue #42.",
    },
  });
  expect(state.update).toHaveBeenCalledTimes(2);
});

it("preserves a branch prefix draft and writes the original prefix on blur", async () => {
  await render();
  await type(
    container.querySelector<HTMLInputElement>('input[aria-label="Branch prefix"]')!,
    "alice/",
  );
  await switchLanguage();
  const input = container.querySelector<HTMLInputElement>('input[aria-label="分支前缀"]')!;
  expect(input.value).toBe("alice/");
  expect(state.update).not.toHaveBeenCalled();
  await act(async () => input.blur());
  expect(state.update).toHaveBeenCalledExactlyOnceWith({ branchNamePrefix: "alice/" });
});

it("preserves custom branch instructions and uses the native semantic mode from a Chinese choice", async () => {
  state.settings[0] = { ...state.settings[0]!, branchNamingMode: "custom" };
  await render();
  await type(
    container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Branch naming instructions"]',
    )!,
    "Keep TEAM-42 in the branch name.",
  );
  await switchLanguage();
  const input = container.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="分支命名指令"]',
  )!;
  expect(input.value).toBe("Keep TEAM-42 in the branch name.");
  expect(state.update).not.toHaveBeenCalled();
  await act(async () => input.blur());
  expect(state.update).toHaveBeenCalledExactlyOnceWith({
    branchNameInstructions: "Keep TEAM-42 in the branch name.",
  });
  await choose("Git 工作树分支命名", "语义前缀");
  expect(state.update).toHaveBeenLastCalledWith({ branchNamingMode: "semantic" });
  expect(state.update).toHaveBeenCalledTimes(2);
});

it("keeps an edited bulk draft without applying it until the translated action is chosen", async () => {
  state.settings.push({
    ...state.settings[0]!,
    sourceControlWritingStyle: {
      ...state.settings[0]!.sourceControlWritingStyle,
      customInstructions: "Other environment instructions",
    },
  });
  await render();
  await act(async () => button("Write custom instructions for all").click());
  expect(button("Apply instructions to all").disabled).toBe(true);
  await type(
    container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Custom source control instructions for all selected environments"]',
    )!,
    "  Keep the raw Project-X naming.  ",
  );
  await switchLanguage();
  expect(
    container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="所选执行环境的版本控制自定义指令"]',
    )!.value,
  ).toBe("  Keep the raw Project-X naming.  ");
  expect(state.update).not.toHaveBeenCalled();
  await act(async () => button("向所有所选环境应用指令").click());
  expect(state.update).toHaveBeenCalledExactlyOnceWith({
    sourceControlWritingStyle: {
      mode: "custom",
      customInstructions: "Keep the raw Project-X naming.",
    },
  });
});
