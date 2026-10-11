// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const settings = vi.hoisted(() => ({
  languagePreference: "system" as "system" | "en" | "zh",
  hydrated: true,
}));
vi.mock("./hooks/useSettings", () => ({
  useClientSettingsHydrated: () => settings.hydrated,
  useClientSettings: (select: (value: typeof settings) => unknown) => select(settings),
}));

import { useTranslate, changeLanguage, i18n } from "./i18n";
import { LanguageSync } from "./LanguageSync";

/**
 * The web binding initializes i18next at module load, then registers the React
 * plugin. These tests pin the ordering, because the plugin's `init` hook only
 * runs while the instance is initializing: registering it afterwards would
 * silently leave `useTranslation` on its fallback path.
 */
describe("web i18n binding", () => {
  it("registers with react-i18next", async () => {
    const { getI18n } = await import("react-i18next");
    expect(getI18n()).toBe(i18n);
  });

  it("is usable immediately, with no provider and no await", () => {
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.t("wizard.continue")).toBe("Continue");
  });

  it("renders the Chinese catalog after a language change", async () => {
    await changeLanguage("zh");
    expect(i18n.t("wizard.continue")).toBe("继续");
    await changeLanguage("en");
    expect(i18n.t("wizard.continue")).toBe("Continue");
  });

  it("keeps the initialized renderer language after another binding registers during an update", async () => {
    const { createI18n } = await import("@t3tools/client-runtime/i18n");
    const { initReactI18next, setI18n } = await import("react-i18next");
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    await changeLanguage("zh");
    createI18n({ plugins: [initReactI18next] });
    const container = document.createElement("div");
    const root = createRoot(container);
    function Screen() {
      const t = useTranslate();
      return createElement("button", null, t("wizard.continue"));
    }
    try {
      await act(async () => root.render(createElement(Screen)));
      expect(container.textContent).toBe("继续");
      await act(async () => changeLanguage("en"));
      expect(container.textContent).toBe("Continue");
    } finally {
      await act(async () => root.unmount());
      setI18n(i18n);
      vi.unstubAllGlobals();
    }
  });
});

describe("LanguageSync", () => {
  it("preserves the current language while native settings are being hydrated", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    await changeLanguage("zh");
    document.documentElement.lang = "zh";
    settings.languagePreference = "system";
    settings.hydrated = false;
    const container = document.createElement("div");
    const root = createRoot(container);
    function Screen() {
      const t = useTranslate();
      return createElement("div", null, createElement(LanguageSync), t("wizard.continue"));
    }
    try {
      await act(async () => root.render(createElement(Screen)));
      expect(container.textContent).toBe("继续");
      expect(document.documentElement.lang).toBe("zh");
      settings.languagePreference = "en";
      settings.hydrated = true;
      await act(async () => root.render(createElement(Screen)));
      expect(container.textContent).toBe("Continue");
      expect(document.documentElement.lang).toBe("en");
    } finally {
      await act(async () => root.unmount());
      settings.hydrated = true;
      vi.unstubAllGlobals();
    }
  });
  it("resolves the system locale for onboarding, then follows explicit preferences", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-CN"]);
    const container = document.createElement("div");
    const root = createRoot(container);
    function Screen() {
      const t = useTranslate();
      return createElement(
        "div",
        null,
        createElement(LanguageSync),
        createElement("button", null, t("wizard.continue")),
      );
    }
    try {
      settings.languagePreference = "system";
      await act(async () => root.render(createElement(Screen)));
      expect(container.textContent).toBe("继续");
      expect(document.documentElement.lang).toBe("zh");
      settings.languagePreference = "en";
      await act(async () => root.render(createElement(Screen)));
      expect(container.textContent).toBe("Continue");
      expect(document.documentElement.lang).toBe("en");
    } finally {
      await act(async () => root.unmount());
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
});

afterEach(async () => {
  await changeLanguage("en");
});
