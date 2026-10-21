import "~/index.css";
import { act, render } from "../../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";

import { changeLanguage } from "../../i18n";
import {
  installCustomTheme,
  invalidateCustomThemes,
  parseThemeFile,
  THEME_FILE_VERSION,
  type ThemeDefinition,
  type ThemeHalves,
} from "../../themePalette";
import type { ThemeEditorSession } from "./themeEditorStore";

const state = vi.hoisted(() => ({
  session: null as ThemeEditorSession | null,
  saved: null as ThemeDefinition | null,
  context: {} as { created: boolean; mergedAppearance?: "light" | "dark" },
  closeThemeEditor: vi.fn(),
  theme: {
    theme: "system",
    themeHalves: null as ThemeHalves | null,
    setTheme: vi.fn(),
    refreshTheme: vi.fn(),
  },
}));
vi.mock("../../hooks/useTheme", async (original) => ({
  ...(await original<typeof import("../../hooks/useTheme")>()),
  useTheme: () => state.theme,
}));
vi.mock("./themeEditorStore", async (original) => ({
  ...(await original<typeof import("./themeEditorStore")>()),
  useThemeEditorStore: (select: (store: typeof state) => unknown) => select(state),
}));
vi.mock("./ThemeEditorPanel", async (original) => ({
  ...(await original<typeof import("./ThemeEditorPanel")>()),
  ThemeEditorPanel: ({
    onSaved,
  }: {
    onSaved: (saved: ThemeDefinition, context: typeof state.context) => boolean;
  }) => (
    <button
      onClick={(event) => {
        event.currentTarget.dataset.saved = String(onSaved(state.saved!, state.context));
      }}
    >
      Save palette
    </button>
  ),
}));
vi.mock("../ui/toast", async (original) => ({
  ...(await original<typeof import("../ui/toast")>()),
  toastManager: { add: vi.fn() },
  stackedThreadToast: (value: unknown) => value,
}));
import { ThemeEditorHost } from "./ThemeEditorHost";
import { toastManager } from "../ui/toast";

describe("theme saves after changing language", () => {
  it.each([{ created: true }, { created: false, mergedAppearance: "dark" as const }])(
    "reports activation failure in the completion language (%j)",
    async (context) => {
      await using lifecycle = await setupLifecycle();

      state.saved = parseThemeFile({
        version: THEME_FILE_VERSION,
        id: "raw-theme",
        name: "Raw Name",
        appearance: "dark",
        colors: { canvas: "#111111" },
      });
      state.context = context;
      await using screen = await render(<ThemeEditorHost />);
      state.theme.setTheme.mockReturnValue(false);
      await act(async () => changeLanguage("zh"));
      expect(state.theme.setTheme).not.toHaveBeenCalled();
      await screen.getByRole("button", { name: "Save palette" }).click();
      const button = screen.container.querySelector("button")!;
      expect(button.dataset.saved).toBe("false");
      expect(state.theme.setTheme).toHaveBeenCalledExactlyOnceWith(state.saved.id);
      expect(toastManager.add).toHaveBeenCalledExactlyOnceWith({
        type: "error",
        title: "无法保存主题",
        description: "浏览器存储不可用，修改未能保留。",
      });
    },
  );
  it("refreshes an edited active half without changing the mix and reports the save in the current language", async () => {
    await using lifecycle = await setupLifecycle();

    state.saved = installCustomTheme(
      parseThemeFile({
        version: THEME_FILE_VERSION,
        id: "raw-active",
        name: "Raw Active Name",
        appearance: "dark",
        colors: { canvas: "#111111" },
      }),
    );
    state.session!.editingThemeId = state.saved.id;
    state.theme.themeHalves = { dark: state.saved.id };
    state.context = { created: false };
    await using screen = await render(<ThemeEditorHost />);
    await act(async () => changeLanguage("zh"));
    await act(async () => screen.container.querySelector("button")!.click());
    expect(state.theme.refreshTheme).toHaveBeenCalledOnce();
    expect(state.theme.setTheme).not.toHaveBeenCalled();
    expect(state.theme.themeHalves).toEqual({ dark: state.saved.id });
    expect(toastManager.add).toHaveBeenCalledExactlyOnceWith({
      type: "success",
      title: "已保存 Raw Active Name",
      description: "修改已生效。",
    });
  });
});

async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  stack.defer(async () => {
    localStorage.clear();
    invalidateCustomThemes();
    await changeLanguage("en");
  });

  await changeLanguage("en");
  localStorage.clear();
  invalidateCustomThemes();
  state.session = {
    id: 1,
    editingThemeId: null,
    seedThemeId: null,
    seedName: null,
    initialAppearance: "dark",
  };
  state.theme.theme = "system";
  state.theme.themeHalves = null;
  state.theme.setTheme.mockReset().mockReturnValue(true);
  state.theme.refreshTheme.mockReset();
  vi.mocked(toastManager.add).mockClear();

  return stack.move();
}
