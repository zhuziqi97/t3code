// @vitest-environment jsdom
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  settings: null as UnifiedSettings | null,
  update: vi.fn(),
  discover: vi.fn(),
}));
vi.mock("./useScopedSettings", () => ({
  useScopedSettings: () => state.settings,
  useUpdateScopedSettings: () => state.update,
  useScopedSettingsMixed: () => false,
  useScopedSettingSource: () => "environment",
  useScopedSettingsWriteAllowed: () => true,
  useClearScopedSettings: () => vi.fn(),
  useClearProjectOverrides: () => vi.fn(),
}));
vi.mock("./SettingsScopeContext", () => ({ useOptionalSettingsScope: () => null }));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useLocation: ({ select }: { select: (location: unknown) => unknown }) =>
    select({ pathname: "/settings/appearance", hash: "", state: {}, search: {} }),
}));
vi.mock("../../hooks/useTheme", async (original) => ({
  ...(await original<typeof import("../../hooks/useTheme")>()),
  useTheme: () => ({
    appearanceMode: "system",
    resolvedTheme: "light",
    theme: "system",
    themeHalves: null,
    refreshTheme: vi.fn(),
    setAppearanceMode: vi.fn(),
    setTheme: vi.fn(),
    setThemeHalf: vi.fn(),
  }),
}));
vi.mock("../../hooks/useCustomThemes", () => ({ useCustomThemes: () => [] }));
vi.mock("./ThemeSettings", () => ({ ThemeLibrary: () => null }));
vi.mock("./SettingsFontPreviews", () => ({
  CodeFontPreview: () => null,
  PromptFontPreview: () => null,
  TerminalFontPreview: () => null,
}));
vi.mock("./FontFamilyPicker", async (original) => ({
  ...(await original<typeof import("./FontFamilyPicker")>()),
  useFontEnumeration: () => ({ status: "unavailable" }),
  discoverInstalledFonts: state.discover,
}));
vi.mock("../../appearanceFonts", async (original) => ({
  ...(await original<typeof import("../../appearanceFonts")>()),
  isFontFamilyAvailable: (family: string) => family === "Raw Font Family",
  isMonospaceFamily: () => true,
  resolveDefaultFamilyLabel: () => "Raw System Font",
}));
vi.mock("../SidebarStageBackdrop", async (original) => ({
  ...(await original<typeof import("../SidebarStageBackdrop")>()),
  useEnvironmentStageLabel: () => "Dev",
}));

import { AppearanceSettingsPanel } from "./SettingsPanels";
import { changeLanguage } from "../../i18n";
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.settings = { ...DEFAULT_UNIFIED_SETTINGS };
  state.update.mockReset();
  state.discover.mockReset();
  localStorage.clear();
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  await changeLanguage("en");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const render = async () => act(async () => root.render(<AppearanceSettingsPanel />));
const switchLanguage = async () => act(async () => changeLanguage("zh"));
async function choose(label: string, optionLabel: string) {
  await act(async () =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click(),
  );
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (node) => node.textContent?.trim() === optionLabel,
  )!;
  await act(async () => option.click());
}

it("preserves an unsettled font draft across language changes and submits the original family on Enter", async () => {
  await render();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Interface font family"]',
  )!;
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Raw Font Family",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await switchLanguage();
  const translated = container.querySelector<HTMLInputElement>('input[aria-label="界面字体家族"]')!;
  expect(translated).toBe(input);
  expect(translated.value).toBe("Raw Font Family");
  expect(state.update).not.toHaveBeenCalled();
  expect(state.discover).toHaveBeenCalledTimes(1);
  await act(async () =>
    translated.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(state.update).toHaveBeenCalledExactlyOnceWith({ fontFamilySans: "Raw Font Family" });
});

it("keeps advanced typography open and saves native pixel counts from Chinese font controls", async () => {
  await render();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Show advanced typography settings"]')!
      .click(),
  );
  expect(container.querySelector('input[aria-label="Prompt font family"]')).not.toBeNull();
  await switchLanguage();
  expect(container.querySelector('input[aria-label="提示词字体家族"]')).not.toBeNull();
  expect(container.querySelector('input[aria-label="终端字体家族"]')).not.toBeNull();
  expect(state.update).not.toHaveBeenCalled();
  await choose("提示词字号", "18 像素");
  expect(state.update).toHaveBeenCalledExactlyOnceWith({ fontSizePrompt: 18 });
});

it("saves native width and color enums from translated choices without writing on a language change", async () => {
  await render();
  await switchLanguage();
  expect(state.update).not.toHaveBeenCalled();
  await choose("聊天宽度", "全宽");
  expect(state.update).toHaveBeenCalledExactlyOnceWith({ chatWidth: "full" });
  await choose("差异颜色", "蓝橙");
  expect(state.update).toHaveBeenLastCalledWith({ diffColorScheme: "blue-orange" });
  expect(state.update).toHaveBeenCalledTimes(2);
});
