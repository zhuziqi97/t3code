import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { CLIENT_SETTINGS_STORAGE_KEY } from "./clientSettingsStorageKey";
import { showBootError } from "./lib/bootError";

class BootElement extends EventTarget {
  children: BootElement[] = [];
  textContent = "";

  constructor(readonly tagName: string) {
    super();
  }

  setAttribute() {}

  append(child: BootElement) {
    this.children.push(child);
  }

  replaceChildren(...children: BootElement[]) {
    this.children = children;
  }

  get text(): string {
    return this.textContent + this.children.map((child) => child.text).join(" ");
  }
}

describe("app startup failures", () => {
  let bootShell: BootElement | null;

  beforeEach(() => {
    vi.resetModules();
    bootShell = new BootElement("div");
    vi.stubGlobal("document", {
      getElementById: () => bootShell,
      createElement: (tagName: string) => new BootElement(tagName),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("shows failures from asynchronous app startup", async () => {
    vi.doMock("./main", () => ({ startup: Promise.reject(new Error("Startup chunks failed")) }));

    await import("./bootstrap");
    await vi.dynamicImportSettled();

    expect(bootShell?.text).toContain("Startup chunks failed");
  });

  afterEach(() => {
    vi.doUnmock("./main");
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("replaces the splash when an app import throws before main can run", async () => {
    vi.doMock("./main", () => {
      throw new Error("@vitejs/plugin-react can't detect preamble. Something is wrong.");
    });
    const reload = vi.fn();
    vi.stubGlobal("window", { location: { reload } });

    await import("./bootstrap");
    await vi.dynamicImportSettled();

    expect(bootShell?.text).toContain("T3 Code could not load.");
    const reloadButton = bootShell?.children[0]?.children.find(
      (element) => element.tagName === "button",
    );
    expect(reloadButton?.text).toBe("Reload");
    reloadButton?.dispatchEvent(new Event("click"));
    expect(reload).toHaveBeenCalledOnce();
  });

  it.each([true, false])("shows startup error details only in dev mode, DEV=%s", (dev) => {
    vi.stubEnv("DEV", dev);

    showBootError(new Error("internal module path"));

    expect(bootShell?.text).toContain("T3 Code could not load.");
    expect(bootShell?.text.includes("internal module path")).toBe(dev);
  });

  it.each([
    ["zh", ["en-US"], "T3 Code 无法加载。", "重新加载"],
    ["en", ["zh-CN"], "T3 Code could not load.", "Reload"],
    ["system", ["zh-CN"], "T3 Code 无法加载。", "重新加载"],
  ] as const)("honors %s before the main chunk can load", (preference, locales, title, button) => {
    const reload = vi.fn();
    const getItem = vi.fn((key: string) =>
      key === CLIENT_SETTINGS_STORAGE_KEY
        ? JSON.stringify({ languagePreference: preference })
        : null,
    );
    vi.stubGlobal("window", { localStorage: { getItem }, location: { reload } });
    vi.stubGlobal("navigator", { languages: locales });
    showBootError(new Error("Module chunk failed: /src/main.tsx"));
    expect(bootShell?.text).toContain(title);
    expect(bootShell?.text).toContain("Module chunk failed: /src/main.tsx");
    const reloadButton = bootShell?.children[0]?.children.find(
      (element) => element.tagName === "button",
    );
    expect(reloadButton?.text).toBe(button);
    reloadButton?.dispatchEvent(new Event("click"));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("still offers a working reload when reading language preferences fails", () => {
    const reload = vi.fn();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("Storage unavailable");
        },
      },
      location: { reload },
    });
    vi.stubGlobal("navigator", { languages: ["zh-CN"] });
    showBootError(new Error("Storage unavailable"));
    expect(bootShell?.text).toContain("T3 Code 无法加载。");
    const reloadButton = bootShell?.children[0]?.children.find(
      (element) => element.tagName === "button",
    );
    reloadButton?.dispatchEvent(new Event("click"));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("updates the existing reload control when desktop language settings arrive", async () => {
    const reload = vi.fn();
    let resolveSettings!: (settings: { languagePreference: "zh" }) => void;
    const settings = new Promise<{ languagePreference: "zh" }>((resolve) => {
      resolveSettings = resolve;
    });
    vi.stubGlobal("window", {
      desktopBridge: { getClientSettings: () => settings },
      location: { reload },
    });
    vi.stubGlobal("navigator", { languages: ["en-US"] });

    const rendered = showBootError(new Error("Module chunk failed: /src/main.tsx"));
    const content = bootShell?.children[0];
    const reloadButton = content?.children.find((element) => element.tagName === "button");
    expect(reloadButton?.text).toBe("Reload");
    reloadButton?.dispatchEvent(new Event("click"));
    expect(reload).toHaveBeenCalledOnce();

    resolveSettings({ languagePreference: "zh" });
    await rendered;

    expect(bootShell?.children[0]).toBe(content);
    expect(content?.text).toContain("T3 Code 无法加载。");
    expect(content?.text).toContain("Module chunk failed: /src/main.tsx");
    expect(reloadButton?.text).toBe("重新加载");
    reload.mockClear();
    reloadButton?.dispatchEvent(new Event("click"));
    expect(reload).toHaveBeenCalledOnce();
  });

  it.each([
    ["en", "zh", "T3 Code could not load.", "Reload"],
    ["system", "en", "T3 Code 无法加载。", "重新加载"],
  ] as const)(
    "uses desktop %s settings instead of legacy browser settings",
    async (preference, legacy, title, button) => {
      vi.stubGlobal("window", {
        localStorage: { getItem: () => JSON.stringify({ languagePreference: legacy }) },
        desktopBridge: {
          getClientSettings: () => Promise.resolve({ languagePreference: preference }),
        },
        location: { reload: vi.fn() },
      });
      vi.stubGlobal("navigator", { languages: ["zh-CN"] });

      await showBootError(new Error("Module chunk failed"));

      expect(bootShell?.text).toContain(title);
      expect(
        bootShell?.children[0]?.children.find((element) => element.tagName === "button")?.text,
      ).toBe(button);
    },
  );

  it("keeps a working reload if desktop language settings fail", async () => {
    const reload = vi.fn();
    vi.stubGlobal("window", {
      desktopBridge: {
        getClientSettings: () => Promise.reject(new Error("Desktop settings unavailable")),
      },
      location: { reload },
    });
    vi.stubGlobal("navigator", { languages: ["zh-CN"] });

    await showBootError(new Error("Module chunk failed"));

    expect(bootShell?.text).toContain("T3 Code 无法加载。");
    expect(bootShell?.text).toContain("Module chunk failed");
    const reloadButton = bootShell?.children[0]?.children.find(
      (element) => element.tagName === "button",
    );
    reloadButton?.dispatchEvent(new Event("click"));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not replace the app after React removes the splash", () => {
    bootShell = null;
    const createElement = vi.spyOn(document, "createElement");

    showBootError(new Error("late failure"));

    expect(createElement).not.toHaveBeenCalled();
  });
});
