import { StrictMode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { changeLanguage } from "../../i18n";
import type { OpenVsxThemeExtension } from "../../openVsxThemes";
import { ThemeImportDialog } from "./ThemeImportDialog";

const searchOpenVsxThemes = vi.hoisted(() => vi.fn());

vi.mock("../../openVsxThemes", () => ({
  searchOpenVsxThemes,
  importOpenVsxThemeExtension: vi.fn(),
}));

const extension: OpenVsxThemeExtension = {
  id: "acme.nightfall",
  collectionId: "acme.nightfall",
  name: "Nightfall",
  publisher: "acme",
  description: "A dark theme",
  downloadCount: 10,
  iconUrl: null,
  sourceUrl: null,
  manifestUrl: "https://example.test/manifest",
  sha256Url: "https://example.test/sha256",
  vsixUrl: "https://example.test/vsix",
  version: "1.0.0",
  license: "MIT",
};

describe("ThemeImportDialog", () => {
  // StrictMode replays ref attach/detach on mount, which must not end the session.
  it("searches Open VSX under StrictMode", async () => {
    searchOpenVsxThemes.mockReset();
    searchOpenVsxThemes.mockResolvedValue([extension]);
    await using _screen = await render(
      <StrictMode>
        <ThemeImportDialog
          open
          onOpenChange={() => {}}
          onImported={() => true}
          onImportedMany={() => {}}
        />
      </StrictMode>,
    );

    await userEvent.type(page.getByLabelText("Search Open VSX themes"), "night");

    await expect.element(page.getByRole("heading", { name: "Nightfall" })).toBeVisible();
    expect(searchOpenVsxThemes).toHaveBeenCalledWith(
      "night",
      expect.objectContaining({ sortBy: "downloadCount" }),
    );
  });
});

it("retranslates theme import controls while preserving the JSON draft and selection", async () => {
  searchOpenVsxThemes.mockReset();
  searchOpenVsxThemes.mockResolvedValue([]);
  await changeLanguage("en");
  await using language = new AsyncDisposableStack();
  language.defer(() => changeLanguage("en").then(() => {}));
  const imported = vi.fn(() => true);
  const importedMany = vi.fn();
  await using _screen = await render(
    <ThemeImportDialog
      open
      onOpenChange={() => {}}
      onImported={imported}
      onImportedMany={importedMany}
    />,
  );
  const draft = '{"name":"Raw 用户主题","version":1}';
  await page.getByRole("textbox", { name: "Theme JSON" }).fill(draft);
  const editor = document.querySelector<HTMLTextAreaElement>("#theme-json-editor")!;
  editor.setSelectionRange(9, 17);
  await act(() => changeLanguage("zh"));
  await expect.element(page.getByRole("heading", { name: "添加主题", exact: true })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "添加主题", exact: true })).toBeEnabled();
  await expect.element(page.getByRole("button", { name: "取消", exact: true })).toBeVisible();
  expect(document.querySelector("#theme-json-editor")).toBe(editor);
  expect(editor.value).toBe(draft);
  expect([editor.selectionStart, editor.selectionEnd]).toEqual([9, 17]);
  expect(imported).not.toHaveBeenCalled();
  expect(importedMany).not.toHaveBeenCalled();
  await act(() => changeLanguage("en"));
  await expect.element(page.getByRole("button", { name: "Add theme", exact: true })).toBeEnabled();
  expect(editor.value).toBe(draft);
  expect([editor.selectionStart, editor.selectionEnd]).toEqual([9, 17]);
});
