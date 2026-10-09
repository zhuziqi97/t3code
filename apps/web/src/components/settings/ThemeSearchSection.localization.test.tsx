// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ search: vi.fn(), install: vi.fn(), installed: vi.fn() }));
vi.mock("../../openVsxThemes", () => ({
  searchOpenVsxThemes: state.search,
  importOpenVsxThemeExtension: state.install,
}));

import { changeLanguage } from "../../i18n";
import type { OpenVsxThemeExtension } from "../../openVsxThemes";
import {
  getCustomThemes,
  installCustomTheme,
  invalidateCustomThemes,
  parseThemeFile,
  THEME_FILE_VERSION,
} from "../../themePalette";
import { ThemeSearchSection } from "./ThemeSearchSection";

const extension: OpenVsxThemeExtension = {
  id: "raw.theme",
  collectionId: "open-vsx:raw.theme",
  name: "Raw Theme",
  publisher: "raw",
  description: "Raw upstream description",
  downloadCount: 123456,
  iconUrl: null,
  sourceUrl: "https://github.com/raw/theme",
  manifestUrl: "https://open-vsx.org/api/raw/theme/1.0.0/file/package.json",
  sha256Url: "https://open-vsx.org/api/raw/theme/1.0.0/file/theme.sha256",
  vsixUrl: "https://open-vsx.org/api/raw/theme/1.0.0/file/theme.vsix",
  version: "1.0.0",
  license: "MIT",
};
function theme(id = "raw-palette") {
  return parseThemeFile({
    version: THEME_FILE_VERSION,
    id,
    name: id,
    appearance: "dark",
    colors: { canvas: "#111111" },
    collection: { id: extension.collectionId, label: extension.name },
  });
}
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await changeLanguage("en");
  localStorage.clear();
  invalidateCustomThemes();
  state.search.mockReset().mockResolvedValue([extension]);
  state.install.mockReset().mockResolvedValue([theme()]);
  state.installed.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  invalidateCustomThemes();
  await changeLanguage("en");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(<ThemeSearchSection open onInstalled={state.installed} />));
}
function searchInput() {
  return container.querySelector<HTMLInputElement>('input[type="search"]')!;
}
async function search() {
  await act(async () => {
    const input = searchInput();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Raw Query",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // Advance the real search debounce, not a wait for a network response.
  await act(async () => vi.advanceTimersByTime(350));
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

it("keeps the query and pending search across language changes and submits native sort values", async () => {
  let resolveSearch!: (results: OpenVsxThemeExtension[]) => void;
  state.search.mockImplementationOnce(
    () => new Promise<OpenVsxThemeExtension[]>((resolve) => (resolveSearch = resolve)),
  );
  await render();
  await search();
  const input = searchInput();
  const signal: AbortSignal = state.search.mock.calls[0]![1].signal;
  await switchLanguage();
  expect(searchInput()).toBe(input);
  expect(input.value).toBe("Raw Query");
  expect(state.search).toHaveBeenCalledTimes(1);
  expect(signal.aborted).toBe(false);
  await act(async () => resolveSearch([extension]));
  expect(container.textContent).toContain("找到 1 个受支持的主题。");
  expect(container.textContent).toContain(extension.description);
  expect(container.textContent).toContain("raw · 12.3万 次下载");
  await click("主题排序");
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (node) => node.textContent?.trim() === "评分最高",
  )!;
  await act(async () => option.click());
  expect(state.search).toHaveBeenCalledTimes(2);
  expect(state.search).toHaveBeenLastCalledWith("Raw Query", {
    signal: expect.any(AbortSignal),
    sortBy: "rating",
  });
  expect(state.install).not.toHaveBeenCalled();
});

it("keeps an install running once across language changes and saves the original collection data", async () => {
  const imported = [theme()];
  let resolveInstall!: (themes: typeof imported) => void;
  state.install.mockImplementationOnce(
    () => new Promise<typeof imported>((resolve) => (resolveInstall = resolve)),
  );
  await render();
  await search();
  await click("Install Raw Theme");
  const signal: AbortSignal = state.install.mock.calls[0]![1];
  await switchLanguage();
  expect(button("正在安装 Raw Theme").disabled).toBe(true);
  expect(state.install).toHaveBeenCalledTimes(1);
  expect(signal.aborted).toBe(false);
  expect(state.search).toHaveBeenCalledTimes(1);
  await act(async () => resolveInstall(imported));
  expect(state.installed).toHaveBeenCalledExactlyOnceWith(imported, { updated: false });
  expect(getCustomThemes()).toEqual(imported);
  expect(state.install).toHaveBeenCalledExactlyOnceWith(extension, signal);
  expect(state.search).toHaveBeenCalledTimes(1);
});

it("keeps an update confirmation across language changes, cancels without downloading, and replaces only its original collection", async () => {
  installCustomTheme(theme("raw-old"));
  installCustomTheme(theme("raw-obsolete"));
  const unrelated = parseThemeFile({
    version: THEME_FILE_VERSION,
    id: "unrelated",
    name: "Raw Personal Theme",
    appearance: "light",
    colors: { canvas: "#ffffff" },
  });
  installCustomTheme(unrelated);
  await render();
  await search();
  await click("Update Raw Theme");
  await switchLanguage();
  expect(document.body.textContent).toContain("更新“Raw Theme”？");
  expect(state.install).not.toHaveBeenCalled();
  await click("取消");
  expect(state.install).not.toHaveBeenCalled();
  expect(getCustomThemes().map((item) => item.id)).toEqual([
    "raw-old",
    "raw-obsolete",
    "unrelated",
  ]);
  await click("更新 Raw Theme");
  await click("更新主题");
  expect(state.install).toHaveBeenCalledTimes(1);
  expect(getCustomThemes().map((item) => item.id)).toEqual(["raw-palette", "unrelated"]);
  expect(getCustomThemes()[1]).toEqual(unrelated);
  expect(state.installed).toHaveBeenCalledExactlyOnceWith([theme()], { updated: true });
  expect(state.search).toHaveBeenCalledTimes(1);
});

it("updates owned search errors in place and keeps raw network diagnostics without retrying on language changes", async () => {
  state.search
    .mockRejectedValueOnce(new Error("Open VSX search is unavailable right now."))
    .mockRejectedValueOnce(new Error("Raw gateway failure: ECONNRESET"));
  await render();
  await search();
  await switchLanguage();
  expect(container.textContent).toContain("Open VSX 搜索暂时不可用。");
  expect(state.search).toHaveBeenCalledTimes(1);
  await act(async () =>
    searchInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(container.textContent).toContain("Raw gateway failure: ECONNRESET");
  await act(async () => changeLanguage("en"));
  expect(container.textContent).toContain("Raw gateway failure: ECONNRESET");
  expect(searchInput().value).toBe("Raw Query");
  expect(state.search).toHaveBeenCalledTimes(2);
});
