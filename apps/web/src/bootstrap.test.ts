import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { DesktopUpdateState } from "@t3tools/contracts";
import { CLIENT_SETTINGS_STORAGE_KEY } from "./clientSettingsStorageKey";
import { showBootError } from "./lib/bootError";

class BootElement extends EventTarget {
  children: Array<BootElement | string> = [];
  private content = "";
  id = "";
  href = "";
  hidden = false;
  constructor(readonly tagName: string) {
    super();
  }
  setAttribute() {}
  get textContent(): string {
    return (
      this.content +
      this.children.map((child) => (typeof child === "string" ? child : child.textContent)).join("")
    );
  }
  set textContent(value: string) {
    this.content = value;
    this.children = [];
  }
  append(...children: Array<BootElement | string>) {
    this.children.push(...children);
  }
  replaceChildren(...children: Array<BootElement | string>) {
    this.content = "";
    this.children = children;
  }
  get text(): string {
    return this.textContent;
  }
}
function findElement(
  root: BootElement | null | undefined,
  match: (node: BootElement) => boolean,
): BootElement | undefined {
  if (!root) return undefined;
  if (match(root)) return root;
  for (const child of root.children) {
    if (typeof child === "string") continue;
    const found = findElement(child, match);
    if (found) return found;
  }
  return undefined;
}

describe("app startup failures", () => {
  let bootShell: BootElement | null;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("APP_VERSION", "0.1.3-2");
    vi.stubGlobal("navigator", {
      languages: ["en-US"],
      platform: "Linux",
      userAgent: "Test",
      onLine: true,
    });
    bootShell = new BootElement("div");
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", {
      getElementById: () => bootShell,
      createElement: (tagName: string) => new BootElement(tagName),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
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
    vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { reload } }));

    await import("./bootstrap");
    await vi.dynamicImportSettled();

    expect(bootShell?.text).toContain("T3 Code for Convene could not load.");
    const reloadButton = findElement(bootShell, (node) => node.id === "boot-error-reload");
    expect(reloadButton?.text).toBe("Reload");
    reloadButton?.dispatchEvent(new Event("click"));
    expect(reload).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    "recovers a failed main preload once before main runs, reloaded=%s",
    async (reloaded) => {
      const storage = new Map<string, string>();
      if (reloaded) storage.set("t3code:chunk-load-reloaded", "1");
      const reload = vi.fn();
      vi.stubGlobal(
        "window",
        Object.assign(new EventTarget(), {
          location: { reload },
          sessionStorage: {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
          },
        }),
      );
      vi.doMock("./main", () => {
        const event = new Event("vite:preloadError", { cancelable: true });
        window.dispatchEvent(event);
        if (!event.defaultPrevented) throw new Error("Failed to fetch main chunk");
        return { startup: Promise.resolve() };
      });

      await import("./bootstrap");
      await vi.dynamicImportSettled();

      expect(reload).toHaveBeenCalledTimes(reloaded ? 0 : 1);
      expect(bootShell?.text.includes("T3 Code for Convene could not load.")).toBe(reloaded);
    },
  );

  it.each([true, false])("keeps copyable error details in both build modes, DEV=%s", (dev) => {
    vi.stubEnv("DEV", dev);

    showBootError(new Error("internal module path"));

    expect(bootShell?.text).toContain("T3 Code for Convene could not load.");
    expect(bootShell?.text).toContain("internal module path");
  });

  it.each([
    ["zh", ["en-US"], "T3 Code for Convene 无法加载。", "重新加载"],
    ["en", ["zh-CN"], "T3 Code for Convene could not load.", "Reload"],
    ["system", ["zh-CN"], "T3 Code for Convene 无法加载。", "重新加载"],
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
    const reloadButton = findElement(bootShell, (node) => node.id === "boot-error-reload");
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
    expect(bootShell?.text).toContain("T3 Code for Convene 无法加载。");
    const reloadButton = findElement(bootShell, (node) => node.id === "boot-error-reload");
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
    const content = findElement(bootShell, (node) => node.id === "boot-error");
    const reloadButton = findElement(content, (node) => node.id === "boot-error-reload");
    const heading = findElement(content, (node) => node.tagName === "h1");
    const explanation = findElement(content, (node) => node.tagName === "p");
    expect(heading).toBeDefined();
    expect(reloadButton?.text).toBe("Reload");
    reloadButton?.dispatchEvent(new Event("click"));
    expect(reload).toHaveBeenCalledOnce();

    resolveSettings({ languagePreference: "zh" });
    await rendered;

    expect(findElement(bootShell, (node) => node.id === "boot-error")).toBe(content);
    expect(content?.text).toContain("T3 Code for Convene 无法加载。");
    expect(content?.text).toContain("Module chunk failed: /src/main.tsx");
    expect(findElement(content, (node) => node.tagName === "h1")).toBe(heading);
    expect(findElement(content, (node) => node.tagName === "p")).toBe(explanation);
    expect(heading?.text).toBe("T3 Code for Convene 无法加载。");
    expect(reloadButton?.text).toBe("重新加载");
    reload.mockClear();
    reloadButton?.dispatchEvent(new Event("click"));
    expect(reload).toHaveBeenCalledOnce();
  });

  it.each([
    ["en", "zh", "T3 Code for Convene could not load.", "Reload"],
    ["system", "en", "T3 Code for Convene 无法加载。", "重新加载"],
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
      expect(findElement(bootShell, (node) => node.id === "boot-error-reload")?.text).toBe(button);
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

    expect(bootShell?.text).toContain("T3 Code for Convene 无法加载。");
    expect(bootShell?.text).toContain("Module chunk failed");
    const reloadButton = findElement(bootShell, (node) => node.id === "boot-error-reload");
    reloadButton?.dispatchEvent(new Event("click"));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("never offers upstream or unsupported issue links without a Convene download source", async () => {
    vi.stubGlobal("window", {
      desktopBridge: {
        getClientSettings: async () => ({ languagePreference: "en" }),
        getUpdateState: async () => ({ status: "idle" }),
        onUpdateState: () => () => {},
      },
      location: { reload: vi.fn() },
    });
    await showBootError(new Error("owned failure"));
    expect(findElement(bootShell, (node) => node.tagName === "a" && !node.hidden)).toBeUndefined();
    expect(bootShell?.text).toContain("Copy error details");
    expect(bootShell?.text).not.toContain("GitHub");
  });
  it("opens only the existing Convene downloads URL through the native bridge", async () => {
    const openExternal = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("window", {
      desktopBridge: {
        openExternal,
        getClientSettings: async () => ({ languagePreference: "zh" }),
        getUpdateState: async () => ({
          status: "idle",
          convene: { downloadsUrl: "https://platform.example/prefix/downloads/latest" },
        }),
        onUpdateState: () => () => {},
      },
      location: { reload: vi.fn() },
    });
    await showBootError(new Error("owned failure"));
    const downloads = findElement(bootShell, (node) => node.tagName === "a" && !node.hidden);
    expect(downloads?.href).toBe("https://platform.example/prefix/downloads/latest");
    downloads?.dispatchEvent(new Event("click", { cancelable: true }));
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(
      "https://platform.example/prefix/downloads/latest",
    );
    expect(downloads?.text).toBe("下载并重新安装 T3 Code for Convene");
  });
  it("keeps the native update action and pushed state when desktop language settings arrive", async () => {
    let pushState!: (state: DesktopUpdateState) => void;
    let resolveInitial!: (state: DesktopUpdateState) => void;
    const initial = new Promise<DesktopUpdateState>((resolve) => {
      resolveInitial = resolve;
    });
    let resolveSettings!: (settings: { languagePreference: "zh" }) => void;
    const settings = new Promise<{ languagePreference: "zh" }>((resolve) => {
      resolveSettings = resolve;
    });
    const state = (status: DesktopUpdateState["status"], patch: Partial<DesktopUpdateState> = {}) =>
      ({ status, ...patch }) as DesktopUpdateState;
    const downloaded = Promise.resolve({ state: state("downloading", { downloadPercent: 41.6 }) });
    const downloadUpdate = vi.fn(() => downloaded);
    const installUpdate = vi.fn().mockResolvedValue({ state: state("up-to-date") });
    vi.stubGlobal("window", {
      desktopBridge: {
        getClientSettings: () => settings,
        getUpdateState: () => initial,
        onUpdateState: (listener: typeof pushState) => {
          pushState = listener;
          return () => {};
        },
        downloadUpdate,
        installUpdate,
      },
      location: { reload: vi.fn() },
    });
    const rendered = showBootError(new Error("owned failure"));
    pushState(state("error", { errorContext: "download", canRetry: true }));
    const update = findElement(bootShell, (node) => node.id === "boot-error-update");
    expect(update?.text).toBe("Download update");
    resolveSettings({ languagePreference: "zh" });
    await rendered;
    expect(findElement(bootShell, (node) => node.id === "boot-error-update")).toBe(update);
    expect(update?.text).toBe("下载更新");
    expect(findElement(bootShell, (node) => node.id === "boot-error-update-note")?.text).toBe(
      "更新下载失败，请再次点击“下载更新”。",
    );
    update?.dispatchEvent(new Event("click"));
    await downloaded;
    expect(downloadUpdate).toHaveBeenCalledOnce();
    expect(update?.text).toBe("正在下载更新（42%）");
    update?.dispatchEvent(new Event("click"));
    expect(downloadUpdate).toHaveBeenCalledOnce();
    resolveInitial(state("up-to-date"));
    await initial;
    expect(update?.hidden).toBe(false);
    expect(update?.text).toBe("正在下载更新（42%）");
    pushState(state("downloaded"));
    expect(update?.text).toBe("重启并更新");
    update?.dispatchEvent(new Event("click"));
    expect(installUpdate).toHaveBeenCalledOnce();
  });

  it("copies the diagnostic report without sending it to an issue service", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", { isSecureContext: true, location: { reload: vi.fn() } });
    vi.stubGlobal("navigator", {
      languages: ["zh-CN"],
      platform: "Linux",
      userAgent: "Test",
      clipboard: { writeText },
    });
    showBootError(new Error("Raw startup diagnostic"));
    const details = findElement(bootShell, (node) => node.id === "boot-error-details");
    const copy = findElement(
      bootShell,
      (node) => node.tagName === "button" && node.text === "复制错误详情",
    );
    copy?.dispatchEvent(new Event("click"));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(details?.text);
    expect(details?.text).toContain("Raw startup diagnostic");
    expect(findElement(bootShell, (node) => node.href.includes("issues"))).toBeUndefined();
  });

  it("does not replace the app after React removes the splash", () => {
    bootShell = null;
    const createElement = vi.spyOn(document, "createElement");

    showBootError(new Error("late failure"));

    expect(createElement).not.toHaveBeenCalled();
  });
});
