import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../test/render";
import { describe, expect, it, vi } from "vite-plus/test";

import { createElement } from "react";

const settings = vi.hoisted(() => ({
  languagePreference: "system" as "system" | "en" | "zh",
  hydrated: true,
  listeners: new Set<() => void>(),
}));
vi.mock("./hooks/useSettings", async (original) => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    settings.listeners.add(listener);
    return () => {
      settings.listeners.delete(listener);
    };
  };
  return {
    ...(await original<typeof import("./hooks/useSettings")>()),
    useClientSettingsHydrated: () => useSyncExternalStore(subscribe, () => settings.hydrated),
    useClientSettings: (select: (value: typeof settings) => unknown) =>
      useSyncExternalStore(subscribe, () => select(settings)),
  };
});

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
    await using _lifecycle = await setupLifecycle();

    const { getI18n } = await import("react-i18next");
    expect(getI18n()).toBe(i18n);
  });

  it("is usable immediately, with no provider and no await", async () => {
    await using _lifecycle = await setupLifecycle();

    expect(i18n.isInitialized).toBe(true);
    expect(i18n.t("wizard.continue")).toBe("Continue");
  });

  it("renders the Chinese catalog after a language change", async () => {
    await using _lifecycle = await setupLifecycle();

    await changeLanguage("zh");
    expect(i18n.t("wizard.continue")).toBe("继续");
    await changeLanguage("en");
    expect(i18n.t("wizard.continue")).toBe("Continue");
  });

  it("keeps the initialized renderer language after another binding registers during an update", async () => {
    await using _lifecycle = await setupLifecycle();

    const { createI18n } = await import("@t3tools/client-runtime/i18n");
    const { initReactI18next, setI18n } = await import("react-i18next");

    await changeLanguage("zh");
    createI18n({ plugins: [initReactI18next] });
    const container = document.createElement("div");
    const root = renderStack.use(await renderTestUi(null, { container: container, router: false }));
    function Screen() {
      const t = useTranslate();
      return createElement("button", null, t("wizard.continue"));
    }
    try {
      await act(async () => renderSettingsScreen(root, createElement(Screen)));
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
    await using _lifecycle = await setupLifecycle();

    await changeLanguage("zh");
    document.documentElement.lang = "zh";
    settings.languagePreference = "system";
    settings.hydrated = false;
    const container = document.createElement("div");
    const root = renderStack.use(await renderTestUi(null, { container: container, router: false }));
    function Screen() {
      const t = useTranslate();
      return createElement("div", null, createElement(LanguageSync), t("wizard.continue"));
    }
    try {
      await act(async () => renderSettingsScreen(root, createElement(Screen)));
      expect(container.textContent).toBe("继续");
      expect(document.documentElement.lang).toBe("zh");
      settings.languagePreference = "en";
      settings.hydrated = true;
      await act(async () => renderSettingsScreen(root, createElement(Screen)));
      expect(container.textContent).toBe("Continue");
      expect(document.documentElement.lang).toBe("en");
    } finally {
      await act(async () => root.unmount());
      settings.hydrated = true;
      vi.unstubAllGlobals();
    }
  });
  it("resolves the system locale for onboarding, then follows explicit preferences", async () => {
    await using _lifecycle = await setupLifecycle();

    vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-CN"]);
    const container = document.createElement("div");
    const root = renderStack.use(await renderTestUi(null, { container: container, router: false }));
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
      await act(async () => renderSettingsScreen(root, createElement(Screen)));
      expect(container.textContent).toBe("继续");
      expect(document.documentElement.lang).toBe("zh");
      settings.languagePreference = "en";
      await act(async () => renderSettingsScreen(root, createElement(Screen)));
      expect(container.textContent).toBe("Continue");
      expect(document.documentElement.lang).toBe("en");
    } finally {
      await act(async () => root.unmount());
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    await changeLanguage("en");
  });

  renderStack = stack.move();
  return renderStack;
}

async function renderSettingsScreen(root: Screen, element: import("react").ReactNode) {
  await act(async () => {
    for (const listener of settings.listeners) listener();
    await root.rerender(element);
  });
}
