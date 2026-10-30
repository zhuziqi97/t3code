import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { act, render } from "../../test/render";
import { changeLanguage } from "../i18n";
import { openCommandPalette } from "../commandPaletteBus";
import { useCommandPaletteStore } from "../commandPaletteStore";
import { CommandPalette } from "./CommandPalette";

function setup() {
  useCommandPaletteStore.setState(useCommandPaletteStore.getInitialState(), true);
}

describe("CommandPalette open intents", () => {
  it("opens New thread in... with focus in the search input, not the Back button", async () => {
    setup();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ open: "new-thread-in" });

    await expect.element(page.getByPlaceholder("Search...")).toHaveFocus();
  });

  it("opens a search intent with its query in the focused input", async () => {
    setup();
    await changeLanguage("en");
    await using language = new AsyncDisposableStack();
    language.defer(() => changeLanguage("en").then(() => {}));
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ query: "acme" });

    const input = page.getByPlaceholder("Search commands, projects, and threads...");
    await expect.element(input).toHaveFocus();
    await expect.element(input).toHaveValue("acme");
    const element = input.element();
    await act(() => changeLanguage("zh"));
    const translated = page.getByRole("combobox");
    expect(translated.element()).toBe(element);
    await expect.element(translated).toHaveFocus();
    await expect.element(translated).toHaveValue("acme");
    await expect.element(translated).toHaveAttribute("placeholder", "搜索命令、项目和会话…");
  });
});
