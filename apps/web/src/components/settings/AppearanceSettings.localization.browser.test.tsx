import { fakeTimers } from "../../../test/render";
import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../../test/render";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts";

import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  settings: null as UnifiedSettings | null,
  update: vi.fn(),
  discover: vi.fn(),
}));
vi.mock("./useScopedSettings", async (original) => ({
  ...(await original<typeof import("./useScopedSettings")>()),
  useScopedSettings: () => state.settings,
  useUpdateScopedSettings: () => state.update,
  useScopedSettingsMixed: () => false,
  useScopedSettingSource: () => "environment",
  useScopedSettingsWriteAllowed: () => true,
  useClearScopedSettings: () => vi.fn(),
  useClearProjectOverrides: () => vi.fn(),
}));
vi.mock("./SettingsScopeContext", async (original) => ({
  ...(await original<typeof import("./SettingsScopeContext")>()),
  useOptionalSettingsScope: () => null,
}));
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
vi.mock("../../hooks/useCustomThemes", async (original) => ({
  ...(await original<typeof import("../../hooks/useCustomThemes")>()),
  useCustomThemes: () => [],
}));
vi.mock("./ThemeSettings", async (original) => ({
  ...(await original<typeof import("./ThemeSettings")>()),
  ThemeLibrary: () => null,
}));
vi.mock("./SettingsFontPreviews", async (original) => ({
  ...(await original<typeof import("./SettingsFontPreviews")>()),
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

import { AppearanceSettingsPanel } from "./AppearanceSettingsPanel";
import { changeLanguage } from "../../i18n";
let root: Screen;
let container: HTMLDivElement;

const render = async () => await act(async () => root.rerender(<AppearanceSettingsPanel />));
const switchLanguage = async () => await act(async () => changeLanguage("zh"));
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
  await using _lifecycle = await setupLifecycle();

  await render();
  using _timers = fakeTimers();
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
  await using _lifecycle = await setupLifecycle();

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
  await using _lifecycle = await setupLifecycle();

  await render();
  await switchLanguage();
  expect(state.update).not.toHaveBeenCalled();
  await choose("聊天宽度", "全宽");
  expect(state.update).toHaveBeenCalledExactlyOnceWith({ chatWidth: "full" });
  await choose("差异颜色", "蓝橙");
  expect(state.update).toHaveBeenLastCalledWith({ diffColorScheme: "blue-orange" });
  expect(state.update).toHaveBeenCalledTimes(2);
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
    await changeLanguage("en");
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  state.settings = { ...DEFAULT_UNIFIED_SETTINGS };
  state.update.mockReset();
  state.discover.mockReset();
  localStorage.clear();
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));

  renderStack = stack.move();
  return renderStack;
}
