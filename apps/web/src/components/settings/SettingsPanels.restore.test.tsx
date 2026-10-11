// @vitest-environment jsdom
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { changeLanguage } from "../../i18n";

const state = vi.hoisted(() => ({
  settings: null as UnifiedSettings | null,
  update: vi.fn(),
  confirm: vi.fn(),
  theme: "system",
  followSystem: true,
  themeHalves: null as { light: string; dark: string } | null,
}));

vi.mock("../../hooks/useTheme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hooks/useTheme")>()),
  useTheme: () => ({
    theme: state.theme,
    followSystem: state.followSystem,
    themeHalves: state.themeHalves,
    setTheme: vi.fn(),
    setFollowSystem: vi.fn(),
    setThemeHalf: vi.fn(),
    clearThemeHalves: vi.fn(),
  }),
  readThemePreference: () => "system",
  readThemeHalves: () => null,
  readAppearanceModePreference: () => "system",
}));

vi.mock("./useScopedSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useScopedSettings")>()),
  useScopedSettings: () => state.settings,
  useUpdateScopedSettings: () => state.update,
}));

vi.mock("../../localApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../localApi")>()),
  readLocalApi: () => ({ dialogs: { confirm: state.confirm } }),
}));

import { useSettingsRestore } from "./SettingsPanels";

let root: Root;
let container: HTMLDivElement;

function RestoreSettings() {
  const restore = useSettingsRestore();
  return (
    <>
      <p>{restore.changedSettingLabels.join(", ")}</p>
      <button
        disabled={restore.changedSettingLabels.length === 0}
        onClick={() => void restore.restoreDefaults()}
      >
        Restore
      </button>
    </>
  );
}

async function renderRestore() {
  await act(async () => root.render(<RestoreSettings />));
}
async function clickRestore() {
  await act(async () => container.querySelector("button")!.click());
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await changeLanguage("en");
  state.settings = { ...DEFAULT_UNIFIED_SETTINGS };
  state.theme = "system";
  state.followSystem = true;
  state.themeHalves = null;
  state.confirm.mockResolvedValue(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLanguage("en");
  vi.unstubAllGlobals();
});

describe("restoring V2 settings", () => {
  it.each([
    ["persistComposerContextStrip", "Composer context"],
    ["autoResumeLimitedThreads", "Auto-resume limited threads"],
    ["snoozeLimitedThreads", "Snooze limited threads"],
  ] as const)("restores %s when it is the only changed setting", async (key, label) => {
    state.settings = { ...DEFAULT_UNIFIED_SETTINGS, [key]: true };
    await renderRestore();
    expect(container.querySelector("p")!.textContent).toBe(label);
    await clickRestore();
    expect(state.confirm.mock.calls[0]?.[0]).toContain(label);
    expect(state.update).toHaveBeenCalledOnce();
    expect(state.update.mock.calls[0]?.[0][key]).toBe(DEFAULT_UNIFIED_SETTINGS[key]);
  });

  it("includes language in the confirmation and restores the system preference", async () => {
    state.settings = { ...DEFAULT_UNIFIED_SETTINGS, languagePreference: "zh" };
    await renderRestore();
    expect(container.querySelector("p")!.textContent).toBe("Language");
    await act(async () => {
      await changeLanguage("zh");
    });
    expect(container.querySelector("p")!.textContent).toBe("语言");
    await clickRestore();
    expect(state.confirm.mock.calls[0]?.[0]).toBe("恢复默认设置？\n以下设置将被重置：语言。");
    expect(state.update.mock.calls[0]?.[0].languagePreference).toBe("system");
  });

  it("does not reset settings after cancellation", async () => {
    state.settings = { ...DEFAULT_UNIFIED_SETTINGS, autoResumeLimitedThreads: true };
    state.confirm.mockResolvedValue(false);
    await renderRestore();
    await clickRestore();
    expect(state.confirm).toHaveBeenCalledOnce();
    expect(state.update).not.toHaveBeenCalled();
  });
});

it("translates dirty theme and browser defaults in the confirmation and preserves them when cancelled", async () => {
  state.theme = "raw-custom-theme";
  state.followSystem = false;
  state.themeHalves = { light: "raw-light", dark: "raw-dark" };
  state.settings = {
    ...DEFAULT_UNIFIED_SETTINGS,
    sidebarThreadPreviewCount: DEFAULT_UNIFIED_SETTINGS.sidebarThreadPreviewCount + 1,
    browserDefaultViewport: { _tag: "freeform", width: 900, height: 600 },
    browserDefaultZoomFactor: 1.5,
    browserDefaultAppearance: "dark",
    browserRecordingFrameRate: 60,
    browserRecordingShowKeyPresses: true,
    browserRecordingShowMousePresses: true,
    browserLinkTarget: "app",
    browserAutoShowFloatingPreview: !DEFAULT_UNIFIED_SETTINGS.browserAutoShowFloatingPreview,
  };
  state.confirm.mockResolvedValue(false);
  await renderRestore();
  await act(async () => changeLanguage("zh"));
  await clickRestore();
  expect(state.confirm).toHaveBeenCalledExactlyOnceWith(
    "恢复默认设置？\n以下设置将被重置：主题、跟随系统、主题混合、可见会话数量、浏览器视口、浏览器缩放、浏览器外观、录制帧率、录制按键、录制鼠标点击、链接打开位置、悬浮预览。",
    { variant: "destructive" },
  );
  expect(state.update).not.toHaveBeenCalled();
  expect(state.theme).toBe("raw-custom-theme");
  await act(async () => changeLanguage("en"));
  expect(container.querySelector("p")!.textContent).toContain("Browser viewport");
  expect(state.confirm).toHaveBeenCalledOnce();
});
