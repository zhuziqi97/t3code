import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { reactHookHarness as hooks } from "../../test/reactHookHarness";
import {
  getThemeDefinition,
  installCustomTheme,
  invalidateCustomThemes,
  parseThemeFile,
  removeCustomTheme,
  THEME_FILE_VERSION,
  themeColorToHex,
  updateCustomTheme,
  type ThemeDefinition,
  type ThemeHalves,
} from "../../themePalette";
import type { ThemeEditorSession } from "./themeEditorStore";

const state = vi.hoisted(() => ({
  session: null as ThemeEditorSession | null,
  closeThemeEditor: vi.fn(),
  onStoreChange: vi.fn(),
  subscriptions: new Set<() => void>(),
  theme: {
    theme: "system",
    themeHalves: null as ThemeHalves | null,
    setTheme: vi.fn(),
    refreshTheme: vi.fn(),
  },
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useCallback: reactHookHarness.useCallback,
    useSyncExternalStore: (
      subscribe: (listener: () => void) => () => void,
      getSnapshot: () => unknown,
    ) => {
      const subscription = reactHookHarness.useRef<(() => void) | null>(null);
      if (!subscription.current) {
        subscription.current = subscribe(() => state.onStoreChange());
        state.subscriptions.add(subscription.current);
      }
      return getSnapshot();
    },
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

vi.mock("../../hooks/useTheme", () => ({ useTheme: () => state.theme }));
vi.mock("./themeEditorStore", () => ({
  useThemeEditorStore: (select: (store: typeof state) => unknown) => select(state),
}));
vi.mock("../ui/toast", () => ({
  toastManager: { add: vi.fn() },
  stackedThreadToast: (value: unknown) => value,
}));

import { ThemeEditorHost } from "./ThemeEditorHost";
import { changeLanguage } from "../../i18n";
import { toastManager } from "../ui/toast";

function renderEditor() {
  hooks.beginRender();
  const host = ThemeEditorHost() as ReactElement<{
    children: ReactElement<{
      editingTheme: ThemeDefinition | null;
      seedTheme: ThemeDefinition | null;
      onSaved: (
        theme: ThemeDefinition,
        context: { created: boolean; mergedAppearance?: "light" | "dark" },
      ) => boolean;
    }>;
  }> | null;
  return host?.props.children.props ?? null;
}

describe("ThemeEditorHost", () => {
  beforeEach(async () => {
    await changeLanguage("en");
    hooks.reset();
    state.session = null;
    state.onStoreChange.mockReset();
    state.theme.theme = "system";
    state.theme.themeHalves = null;
    state.theme.setTheme.mockReset().mockReturnValue(true);
    state.theme.refreshTheme.mockReset();
    vi.mocked(toastManager.add).mockClear();
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    invalidateCustomThemes();
  });

  afterEach(async () => {
    for (const unsubscribe of state.subscriptions) unsubscribe();
    state.subscriptions.clear();
    vi.unstubAllGlobals();
    invalidateCustomThemes();
    await changeLanguage("en");
  });

  it.each(["editingTheme", "seedTheme"] as const)(
    "reopens the same %s with its saved colors",
    (field) => {
      const theme = installCustomTheme(
        parseThemeFile({
          version: THEME_FILE_VERSION,
          id: "saved-colors",
          name: "Saved colors",
          appearance: "dark",
          colors: { accent: "#1f6e4a" },
        }),
      );
      const session = {
        id: 1,
        editingThemeId: field === "editingTheme" ? theme.id : null,
        seedThemeId: field === "seedTheme" ? theme.id : null,
        seedName: null,
        initialAppearance: "dark" as const,
      };
      state.session = session;
      expect(themeColorToHex(renderEditor()?.[field]?.colors.accent ?? "")).toBe("#1f6e4a");

      updateCustomTheme({ ...theme, colors: { ...theme.colors, accent: "#7241b8" } });
      expect(themeColorToHex(getThemeDefinition(theme.id)?.colors.accent ?? "")).toBe("#7241b8");
      state.session = null;
      expect(renderEditor()).toBeNull();
      state.session = { ...session, id: 2 };

      expect(themeColorToHex(renderEditor()?.[field]?.colors.accent ?? "")).toBe("#7241b8");
    },
  );

  it.each(["editingTheme", "seedTheme"] as const)(
    "refreshes an open %s when the library changes",
    (field) => {
      const theme = installCustomTheme(
        parseThemeFile({
          version: THEME_FILE_VERSION,
          id: "updated-theme",
          name: "Updated theme",
          appearance: "dark",
          colors: { accent: "#1f6e4a" },
        }),
      );
      state.session = {
        id: 1,
        editingThemeId: field === "editingTheme" ? theme.id : null,
        seedThemeId: field === "seedTheme" ? theme.id : null,
        seedName: null,
        initialAppearance: "dark",
      };
      let editor = renderEditor();
      state.onStoreChange.mockImplementation(() => {
        editor = renderEditor();
      });

      updateCustomTheme({ ...theme, colors: { ...theme.colors, accent: "#7241b8" } });

      expect(themeColorToHex(editor?.[field]?.colors.accent ?? "")).toBe("#7241b8");
    },
  );

  it("does not keep editing a theme removed from the library", () => {
    const theme = installCustomTheme(
      parseThemeFile({
        version: THEME_FILE_VERSION,
        id: "removed-theme",
        name: "Removed theme",
        appearance: "dark",
        colors: { accent: "#1f6e4a" },
      }),
    );
    state.session = {
      id: 1,
      editingThemeId: theme.id,
      seedThemeId: null,
      seedName: null,
      initialAppearance: "dark",
    };
    let editor = renderEditor();
    expect(editor?.editingTheme?.id).toBe(theme.id);
    state.onStoreChange.mockImplementation(() => {
      editor = renderEditor();
    });

    removeCustomTheme(theme.id);

    expect(editor?.editingTheme).toBeNull();
  });

  it.each([{ created: true }, { created: false, mergedAppearance: "dark" as const }])(
    "uses the current language when activating a saved palette fails (%j)",
    async (context) => {
      const saved = parseThemeFile({
        version: THEME_FILE_VERSION,
        id: "raw-theme",
        name: "Raw Name",
        appearance: "dark",
        colors: { canvas: "#111111" },
      });
      state.session = {
        id: 1,
        editingThemeId: null,
        seedThemeId: null,
        seedName: null,
        initialAppearance: "dark",
      };
      const onSaved = renderEditor()!.onSaved;
      state.theme.setTheme.mockReturnValue(false);
      await changeLanguage("zh");
      expect(state.theme.setTheme).not.toHaveBeenCalled();
      expect(onSaved(saved, context)).toBe(false);
      expect(state.theme.setTheme).toHaveBeenCalledExactlyOnceWith(saved.id);
      expect(toastManager.add).toHaveBeenCalledExactlyOnceWith({
        type: "error",
        title: "无法保存主题",
        description: "浏览器存储不可用，修改未能保留。",
      });
    },
  );

  it("refreshes an edited active half without changing the mix and reports the save in the current language", async () => {
    const saved = installCustomTheme(
      parseThemeFile({
        version: THEME_FILE_VERSION,
        id: "raw-active",
        name: "Raw Active Name",
        appearance: "dark",
        colors: { canvas: "#111111" },
      }),
    );
    state.session = {
      id: 1,
      editingThemeId: saved.id,
      seedThemeId: null,
      seedName: null,
      initialAppearance: "dark",
    };
    state.theme.themeHalves = { dark: saved.id };
    const onSaved = renderEditor()!.onSaved;
    await changeLanguage("zh");
    expect(onSaved(saved, { created: false })).toBe(true);
    expect(state.theme.refreshTheme).toHaveBeenCalledTimes(1);
    expect(state.theme.setTheme).not.toHaveBeenCalled();
    expect(state.theme.themeHalves).toEqual({ dark: saved.id });
    expect(toastManager.add).toHaveBeenCalledExactlyOnceWith({
      type: "success",
      title: "已保存 Raw Active Name",
      description: "修改已生效。",
    });
  });
});
