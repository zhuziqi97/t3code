// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { changeLanguage } from "../../i18n";
import * as palette from "../../themePalette";
import { ThemeEditorPanel } from "./ThemeEditorPanel";

let root: Root;
let container: HTMLDivElement;
const saved = vi.fn(() => true);
const close = vi.fn();
const restore = vi.fn();
function theme(id: string, label: string, appearance: "light" | "dark") {
  return palette.installCustomTheme(
    palette.parseThemeFile({
      version: palette.THEME_FILE_VERSION,
      id,
      name: label,
      appearance,
      colors: { canvas: appearance === "light" ? "#ffffff" : "#111111", accent: "#336699" },
      collection: { id: "open-vsx:raw.collection", label: "Raw Collection" },
    }),
  );
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await changeLanguage("en");
  localStorage.clear();
  palette.invalidateCustomThemes();
  saved.mockReset().mockReturnValue(true);
  close.mockClear();
  restore.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  palette.invalidateCustomThemes();
  await changeLanguage("en");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(editingTheme: palette.ThemeDefinition | null = null) {
  await act(async () =>
    root.render(
      <ThemeEditorPanel
        open
        editingTheme={editingTheme}
        initialAppearance="dark"
        onSaved={saved}
        onOpenChange={close}
        restoreTheme={restore}
      />,
    ),
  );
}
async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function nameInput() {
  return container.querySelector<HTMLInputElement>(
    'input[placeholder="Theme name"], input[placeholder="主题名称"], input[placeholder="e.g. Aurora"], input[placeholder="例如 Aurora"]',
  )!;
}
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.getAttribute("aria-label") === label || node.textContent?.trim() === label,
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
async function switchLanguage() {
  await act(async () => changeLanguage("zh"));
}

it("preserves a name and color draft without reapplying its preview on language changes, then saves native theme data", async () => {
  const editing = theme("raw-dark", "Raw Original Name", "dark");
  const preview = vi.spyOn(palette, "applyThemeColorPreview");
  await render(editing);
  await fill(nameInput(), "Raw Edited Name");
  const color = container.querySelector<HTMLInputElement>("#canvas-hex")!;
  await fill(color, "#33445580");
  const previewCount = preview.mock.calls.length;
  expect(previewCount).toBeGreaterThan(0);
  await switchLanguage();
  expect(nameInput().value).toBe("Raw Edited Name");
  expect(container.querySelector("#canvas-hex")).toBe(color);
  expect(color.value).toBe("#33445580");
  expect(preview).toHaveBeenCalledTimes(previewCount);
  expect(restore).not.toHaveBeenCalled();
  expect(saved).not.toHaveBeenCalled();
  await click("保存修改");
  const result = palette.getCustomThemes()[0]!;
  expect(result).toMatchObject({
    id: editing.id,
    label: "Raw Edited Name",
    appearance: "dark",
    collection: editing.collection,
  });
  expect(palette.themeColorToHex(result.colors.canvas)).toBe("#33445580");
  expect(saved).toHaveBeenCalledExactlyOnceWith(result, { created: false });
  expect(close).toHaveBeenCalledExactlyOnceWith(false);
});

it("merges complementary palettes by their original IDs and leaves the existing palette intact", async () => {
  const target = theme("raw-light", "Raw Paired Name", "light");
  const editing = theme("raw-dark", "Raw Dark Name", "dark");
  await render(editing);
  await fill(nameInput(), target.label);
  await switchLanguage();
  expect(palette.getCustomThemes().map((value) => value.id)).toEqual([target.id, editing.id]);
  expect(saved).not.toHaveBeenCalled();
  await click("合并到“Raw Paired Name”");
  const result = palette.getCustomThemes()[0]!;
  expect(palette.getCustomThemes()).toHaveLength(1);
  expect(result.id).toBe(target.id);
  expect(result.colors).toEqual(target.colors);
  expect(result.variants?.dark).toEqual(editing.colors);
  expect(saved).toHaveBeenCalledExactlyOnceWith(result, {
    created: false,
    mergedAppearance: "dark",
  });
});

it("retranslates a palette collision without modifying either installed theme", async () => {
  const target = theme("raw-target", "Raw Taken Name", "dark");
  const editing = theme("raw-editing", "Raw Editing Name", "dark");
  await render(editing);
  await fill(nameInput(), target.label);
  await click("Merge into “Raw Taken Name”");
  await switchLanguage();
  expect(container.textContent).toContain("“Raw Taken Name”已有深色配色。请选择其他名称。");
  expect(palette.getCustomThemes()).toEqual([target, editing]);
  expect(saved).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

it("keeps a Chinese color filter and its native role field across language changes", async () => {
  await render(theme("raw-dark", "Raw Theme", "dark"));
  await switchLanguage();
  const query = container.querySelector<HTMLInputElement>('input[aria-label="筛选颜色"]')!;
  await fill(query, "终端");
  const color = container.querySelector<HTMLInputElement>("#terminalBackground-hex")!;
  expect(color).not.toBeNull();
  expect(container.querySelector("#canvas-hex")).toBeNull();
  await act(async () => changeLanguage("en"));
  expect(container.querySelector('input[aria-label="Filter colors"]')).toBe(query);
  expect(query.value).toBe("终端");
  expect(container.querySelector("#terminalBackground-hex")).toBe(color);
  await fill(query, "toolbarForeground");
  expect(container.querySelector("#text-hex")).not.toBeNull();
  expect(saved).not.toHaveBeenCalled();
});

it("updates the inspector's visible hover label in place without resetting inspection or the preview", async () => {
  const preview = vi.spyOn(palette, "applyThemeColorPreview");
  await render();
  const sample = document.createElement("div");
  sample.className = "bg-background";
  document.body.append(sample);
  vi.spyOn(sample, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 40, 80, 30));
  try {
    await click("Inspect app colors");
    await act(async () => sample.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
    const hover = document.getElementById("theme-inspector-hover")!;
    expect(hover.textContent).toBe("Background");
    const previewCount = preview.mock.calls.length;
    expect(previewCount).toBeGreaterThan(0);
    await switchLanguage();
    expect(document.getElementById("theme-inspector-hover")).toBe(hover);
    expect(hover.textContent).toBe("背景");
    expect(
      container.querySelector('[aria-label="取消检查应用颜色"]')?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(preview).toHaveBeenCalledTimes(previewCount);
    expect(saved).not.toHaveBeenCalled();
    await click("取消检查应用颜色");
    expect(document.getElementById("theme-inspector-hover")).toBeNull();
  } finally {
    sample.remove();
  }
});

it("keeps a create draft after activation rolls back and allows a retry with the same native name", async () => {
  saved.mockReturnValue(false);
  await render();
  await fill(nameInput(), "Raw New Theme");
  await click("Create theme");
  expect(palette.getCustomThemes()).toEqual([]);
  expect(saved).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
  await switchLanguage();
  expect(container.textContent).toContain("无法启用主题。请重试。");
  expect(nameInput().value).toBe("Raw New Theme");
  expect(saved).toHaveBeenCalledTimes(1);
  saved.mockReturnValue(true);
  await click("创建主题");
  expect(palette.getCustomThemes()).toEqual([
    expect.objectContaining({ id: "raw-new-theme", label: "Raw New Theme", appearance: "dark" }),
  ]);
  expect(saved).toHaveBeenCalledTimes(2);
  expect(close).toHaveBeenCalledExactlyOnceWith(false);
});
