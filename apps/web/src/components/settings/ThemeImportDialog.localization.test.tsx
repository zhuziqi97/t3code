// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

vi.mock("./ThemeSearchSection", () => ({ ThemeSearchSection: () => null }));

import { changeLanguage } from "../../i18n";
import {
  getCustomThemes,
  installCustomTheme,
  invalidateCustomThemes,
  parseThemeFile,
  THEME_FILE_VERSION,
  themeColorToHex,
} from "../../themePalette";
import { MAX_THEME_FILE_BYTES, ThemeImportDialog } from "./ThemeImportDialog";

let root: Root;
let container: HTMLDivElement;
const imported = vi.fn(() => true);
const importedMany = vi.fn();
const close = vi.fn();
const input = {
  version: THEME_FILE_VERSION,
  id: "raw-theme",
  name: "Raw Theme Name",
  appearance: "dark",
  colors: { canvas: "#111111" },
};
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await changeLanguage("en");
  localStorage.clear();
  invalidateCustomThemes();
  imported.mockClear();
  importedMany.mockClear();
  close.mockClear();
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
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(
      <ThemeImportDialog
        open
        onOpenChange={close}
        onImported={imported}
        onImportedMany={importedMany}
      />,
    ),
  );
}
async function switchLanguage() {
  await act(async () => changeLanguage("zh"));
}
function editor() {
  return document.querySelector<HTMLTextAreaElement>("#theme-json-editor")!;
}
async function fill(value: string) {
  await act(async () => {
    const node = editor();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === label,
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
async function chooseFile(file: File, ...others: File[]) {
  await act(async () => {
    const picker = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(picker, "files", { configurable: true, value: [file, ...others] });
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

it("preserves the JSON draft and selection across language changes and imports the native theme data", async () => {
  await render();
  const json = JSON.stringify(input, null, 2);
  await fill(json);
  const before = editor();
  before.setSelectionRange(8, 15);
  await switchLanguage();
  expect(editor()).toBe(before);
  expect(editor().value).toBe(json);
  expect(editor().selectionStart).toBe(8);
  expect(editor().selectionEnd).toBe(15);
  expect(imported).not.toHaveBeenCalled();
  expect(getCustomThemes()).toEqual([]);
  await click("添加主题");
  expect(imported).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ id: input.id, label: input.name, appearance: "dark" }),
  );
  const installed = getCustomThemes()[0]!;
  expect(themeColorToHex(installed.colors.canvas)).toBe("#111111");
  expect(close).toHaveBeenCalledExactlyOnceWith(false);
});

it("retranslates a visible parser failure without re-importing or discarding the JSON draft", async () => {
  await render();
  const json = JSON.stringify({ ...input, colors: { RawRole: "#ffffff" } });
  await fill(json);
  await click("Add theme");
  expect(document.body.textContent).toContain('"RawRole" is not a supported theme color role.');
  await switchLanguage();
  expect(document.body.textContent).toContain('"RawRole" 不是受支持的主题颜色字段。');
  expect(editor().value).toBe(json);
  expect(imported).not.toHaveBeenCalled();
  expect(getCustomThemes()).toEqual([]);
});

it("explains malformed JSON in the current language and preserves the parser diagnostic for retry", async () => {
  await render();
  const json = "{broken JSON 原文";
  let diagnostic = "";
  try {
    JSON.parse(json);
  } catch (cause) {
    expect(cause).toBeInstanceOf(SyntaxError);
    diagnostic = (cause as SyntaxError).message;
  }
  await fill(json);
  await click("Add theme");
  expect(document.body.textContent).toContain(`Theme JSON is invalid: ${diagnostic}`);
  await switchLanguage();
  expect(document.body.textContent).toContain(`主题 JSON 解析失败：${diagnostic}`);
  expect(editor().value).toBe(json);
  expect(imported).not.toHaveBeenCalled();
  expect(getCustomThemes()).toEqual([]);
  await fill(JSON.stringify(input));
  await click("添加主题");
  expect(imported).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ id: input.id, label: input.name }),
  );
  expect(close).toHaveBeenCalledExactlyOnceWith(false);
});

it("does not restart a pending file read and shows its failure in the current language", async () => {
  await render();
  let rejectRead!: (cause: unknown) => void;
  const text = vi.fn(() => new Promise<string>((_resolve, reject) => (rejectRead = reject)));
  const file = new File(["{}"], "Raw File.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: text });
  await chooseFile(file);
  await switchLanguage();
  expect(text).toHaveBeenCalledTimes(1);
  await act(async () => rejectRead(new Error("Raw disk diagnostic")));
  expect(document.body.textContent).toContain("无法读取该文件。请在下方粘贴 JSON。");
  expect(text).toHaveBeenCalledTimes(1);
  expect(imported).not.toHaveBeenCalled();
  await act(async () => changeLanguage("en"));
  expect(document.body.textContent).toContain(
    "Could not read that file. Paste the JSON below instead.",
  );
});

it("keeps the size guard before file reading and updates its already-visible explanation", async () => {
  await render();
  const text = vi.fn();
  const file = new File([new Uint8Array(MAX_THEME_FILE_BYTES + 1)], "Large Raw File.json");
  Object.defineProperty(file, "text", { value: text });
  await chooseFile(file);
  await switchLanguage();
  expect(document.body.textContent).toContain("未读取此文件（上限为 256 KB）");
  expect(text).not.toHaveBeenCalled();
  expect(imported).not.toHaveBeenCalled();
  expect(getCustomThemes()).toEqual([]);
});

it("keeps successful batch imports and retranslates individual failures while retaining raw file names", async () => {
  await render();
  const valid = new File([JSON.stringify(input)], "Raw Valid.json");
  const invalidJson = JSON.stringify({ ...input, colors: { RawRole: "#ffffff" } });
  const invalid = new File([invalidJson], "Raw Invalid.json");
  const large = new File([new Uint8Array(MAX_THEME_FILE_BYTES + 1)], "Raw Large.json");
  const readValid = vi.fn(async () => JSON.stringify(input));
  const readInvalid = vi.fn(async () => invalidJson);
  const readLarge = vi.fn();
  Object.defineProperty(valid, "text", { value: readValid });
  Object.defineProperty(invalid, "text", { value: readInvalid });
  Object.defineProperty(large, "text", { value: readLarge });
  await chooseFile(valid, invalid, large);
  expect(importedMany).toHaveBeenCalledExactlyOnceWith(
    [expect.objectContaining({ id: input.id, label: input.name })],
    { updated: false },
  );
  await switchLanguage();
  expect(document.body.textContent).toContain(
    'Raw Invalid.json："RawRole" 不是受支持的主题颜色字段。 — Raw Large.json：文件过大',
  );
  expect(getCustomThemes().map((theme) => theme.id)).toEqual([input.id]);
  expect(readValid).toHaveBeenCalledTimes(1);
  expect(readInvalid).toHaveBeenCalledTimes(1);
  expect(readLarge).not.toHaveBeenCalled();
  expect(importedMany).toHaveBeenCalledTimes(1);
  expect(imported).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

it("localizes a batch syntax failure without repeating reads or reinstalling its successful file", async () => {
  await render();
  const valid = new File([""], "Raw Valid.json");
  const readValid = vi.fn(async () => JSON.stringify(input));
  Object.defineProperty(valid, "text", { value: readValid });
  const broken = new File([""], "Raw Broken.json");
  const readBroken = vi.fn(async () => "{broken JSON 原文");
  Object.defineProperty(broken, "text", { value: readBroken });
  await chooseFile(valid, broken);
  expect(document.body.textContent).toContain("Raw Broken.json: Theme JSON is invalid: ");
  await switchLanguage();
  expect(document.body.textContent).toContain("Raw Broken.json：主题 JSON 解析失败：");
  expect(getCustomThemes().map((theme) => theme.id)).toEqual([input.id]);
  expect(importedMany).toHaveBeenCalledExactlyOnceWith(
    [expect.objectContaining({ id: input.id, label: input.name })],
    { updated: false },
  );
  expect(readValid).toHaveBeenCalledTimes(1);
  expect(readBroken).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
});

it.each([
  ["更新现有主题", true],
  ["保留两者", false],
] as const)(
  "keeps conflict data across a language change and applies %s only on request",
  async (label, updated) => {
    const collection = { id: "open-vsx:raw.collection", label: "Raw Collection" };
    installCustomTheme(parseThemeFile({ ...input, colors: { canvas: "#222222" }, collection }));
    await render();
    const json = JSON.stringify(input);
    await fill(json);
    await click("Add theme");
    await switchLanguage();
    expect(document.body.textContent).toContain("已安装");
    expect(document.body.textContent).toContain(input.name);
    expect(themeColorToHex(getCustomThemes()[0]!.colors.canvas)).toBe("#222222");
    expect(importedMany).not.toHaveBeenCalled();
    await click("返回");
    expect(editor().value).toBe(json);
    expect(importedMany).not.toHaveBeenCalled();
    await click("添加主题");
    await click(label);
    expect(importedMany).toHaveBeenCalledExactlyOnceWith(
      [expect.objectContaining({ label: updated ? input.name : `${input.name} (1)` })],
      { updated },
    );
    const installed = getCustomThemes();
    expect(installed).toHaveLength(updated ? 1 : 2);
    expect(installed[0]!.id).toBe(input.id);
    expect(installed[0]!.collection).toEqual(collection);
    expect(themeColorToHex(installed[0]!.colors.canvas)).toBe(updated ? "#111111" : "#222222");
  },
);
