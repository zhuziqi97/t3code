// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  setTheme: vi.fn(),
  setMode: vi.fn(),
  setHalf: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("../../hooks/useEnvironmentTheme", () => ({
  useEnvironmentThemeDefinitions: () => [],
}));
vi.mock("../../hooks/useTheme", () => ({ readThemeHalvesRaw: () => ({}) }));
vi.mock("./ThemeImportDialog", () => ({ ThemeImportDialog: () => null }));
vi.mock("../ui/toast", () => ({
  toastManager: { add: state.toast },
  stackedThreadToast: (options: unknown) => options,
}));

import { changeLanguage } from "../../i18n";
import {
  getCustomThemes,
  installCustomTheme,
  invalidateCustomThemes,
  parseThemeFile,
  THEME_FILE_VERSION,
} from "../../themePalette";
import { ThemeLibrary } from "./ThemeSettings";
import { useThemeEditorStore } from "./themeEditorStore";

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await changeLanguage("en");
  localStorage.clear();
  invalidateCustomThemes();
  const collection = { id: "open-vsx:raw.collection", label: "Raw Collection" };
  for (const [id, name, appearance] of [
    ["personal", "Personal Name", "dark"],
    ["collection-light", "Raw Collection Soft Light", "light"],
    ["collection-dark", "Raw Collection Deep Dark", "dark"],
    ["collection-muted", "Raw Collection Muted Dark", "dark"],
  ] as const) {
    installCustomTheme(
      parseThemeFile({
        version: THEME_FILE_VERSION,
        id,
        name,
        appearance,
        colors: { canvas: appearance === "light" ? "#ffffff" : "#111111" },
        ...(id === "personal" ? {} : { collection }),
      }),
    );
  }
  state.setTheme.mockReset().mockReturnValue(true);
  state.setMode.mockReset().mockReturnValue(true);
  state.setHalf.mockReset().mockReturnValue(true);
  state.toast.mockReset();
  useThemeEditorStore.getState().closeThemeEditor();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  invalidateCustomThemes();
  useThemeEditorStore.getState().closeThemeEditor();
  await changeLanguage("en");
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () =>
    root.render(
      <ThemeLibrary
        theme="system"
        setTheme={state.setTheme}
        appearanceMode="system"
        setAppearanceMode={state.setMode}
        customThemes={getCustomThemes()}
        initialAppearance="dark"
        refreshTheme={() => {}}
        isImportOpen={false}
        onImportOpenChange={() => {}}
        themeHalves={{ dark: "personal" }}
        setThemeHalf={state.setHalf}
      />,
    ),
  );
}
function button(label: string) {
  const target = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.getAttribute("aria-label") === label || node.textContent?.trim() === label,
  );
  expect(target, label).toBeDefined();
  return target!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function switchLanguage() {
  await act(async () => changeLanguage("zh"));
}
const installedIds = () => getCustomThemes().map((theme) => theme.id);

it("keeps the selected theme on language changes and uses native modes and IDs from Chinese actions", async () => {
  await render();
  const selected = button("Use Personal Name for Dark mode");
  expect(selected.getAttribute("aria-pressed")).toBe("true");
  await switchLanguage();
  expect(button("将 Personal Name 用于深色模式")).toBe(selected);
  expect(selected.getAttribute("aria-pressed")).toBe("true");
  expect(state.setTheme).not.toHaveBeenCalled();
  expect(state.setMode).not.toHaveBeenCalled();
  expect(state.setHalf).not.toHaveBeenCalled();
  await click("使用浅色模式");
  expect(state.setMode).toHaveBeenCalledExactlyOnceWith("light");
  await click("将 Personal Name 用于深色模式");
  expect(state.setHalf).toHaveBeenCalledExactlyOnceWith("dark", "personal");
  await click("复制 Personal Name");
  expect(useThemeEditorStore.getState().session).toMatchObject({
    editingThemeId: null,
    seedThemeId: "personal",
    seedName: "Personal Name 副本",
    initialAppearance: "dark",
  });
});

it("retains a chosen collection variant when the language changes and edits that variant by its original ID", async () => {
  await render();
  await click("Use Muted Dark for Dark mode");
  expect(state.setHalf).toHaveBeenCalledExactlyOnceWith("dark", "collection-muted");
  const edit = button("Edit Raw Collection Muted Dark");
  await switchLanguage();
  expect(button("编辑 Raw Collection Muted Dark")).toBe(edit);
  expect(state.setHalf).toHaveBeenCalledTimes(1);
  expect(state.setTheme).not.toHaveBeenCalled();
  await click("编辑 Raw Collection Muted Dark");
  expect(useThemeEditorStore.getState().session).toMatchObject({
    editingThemeId: "collection-muted",
    seedThemeId: null,
    seedName: null,
  });
});

it("preserves checked removal variants across language changes and leaves the library intact when cancelled", async () => {
  await render();
  await click("Remove themes from Raw Collection");
  const checkbox = document.querySelector<HTMLInputElement>("#remove-theme-collection-dark")!;
  await act(async () => checkbox.click());
  expect(checkbox.checked).toBe(true);
  await switchLanguage();
  expect(document.querySelector("#remove-theme-collection-dark")).toBe(checkbox);
  expect(checkbox.checked).toBe(true);
  expect(document.body.textContent).toContain("移除“Raw Collection”中的主题？");
  expect(button("移除所选主题（1）").disabled).toBe(false);
  await click("取消");
  expect(installedIds()).toEqual([
    "personal",
    "collection-light",
    "collection-dark",
    "collection-muted",
  ]);
  expect(state.setTheme).not.toHaveBeenCalled();
  expect(state.setHalf).not.toHaveBeenCalled();
});

it("removes only the chosen original variant after switching language", async () => {
  await render();
  await click("Remove themes from Raw Collection");
  await act(async () =>
    document.querySelector<HTMLInputElement>("#remove-theme-collection-dark")!.click(),
  );
  await switchLanguage();
  await click("移除所选主题（1）");
  expect(installedIds()).toEqual(["personal", "collection-light", "collection-muted"]);
  expect(state.setTheme).not.toHaveBeenCalled();
  expect(state.setHalf).not.toHaveBeenCalled();
});

it("reports theme save failures in the current language after switching without extra writes", async () => {
  await render();
  state.setMode.mockReturnValue(false);
  await switchLanguage();
  expect(state.setMode).not.toHaveBeenCalled();
  await click("使用深色模式");
  expect(state.setMode).toHaveBeenCalledExactlyOnceWith("dark");
  expect(state.toast).toHaveBeenCalledExactlyOnceWith({
    type: "error",
    title: "无法保存主题选择",
    description: "请重试。",
  });
});
