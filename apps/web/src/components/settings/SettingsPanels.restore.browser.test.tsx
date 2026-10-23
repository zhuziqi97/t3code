import "~/index.css";
import { act, render } from "../../../test/render";

import { changeLanguage } from "../../i18n";
import { useEffect } from "react";

import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  settings: null as UnifiedSettings | null,
  update: vi.fn(),
  confirm: vi.fn(),
  theme: "system",
  followSystem: true,
  themeHalves: null as { light?: string; dark?: string } | null,
}));

vi.mock(import("../../hooks/useTheme"), async (original) => ({
  ...(await original()),
  useTheme: () =>
    ({
      theme: state.theme,
      followSystem: state.followSystem,
      themeHalves: state.themeHalves,
      setTheme: vi.fn(),
      setFollowSystem: vi.fn(),
      setThemeHalf: vi.fn(),
      clearThemeHalves: vi.fn(),
    }) as never,
  readThemePreference: () => "system",
  readThemeHalves: () => null,
  readAppearanceModePreference: () => "system",
}));
vi.mock(import("./useScopedSettings"), async (original) => ({
  ...(await original()),
  useScopedSettings: (() => state.settings!) as never,
  useUpdateScopedSettings: () => state.update,
}));
vi.mock(import("../../localApi"), async (original) => ({
  ...(await original()),
  readLocalApi: () => ({ dialogs: { confirm: state.confirm } }) as never,
}));

import { useSettingsRestore } from "./SettingsPanels";
async function renderRestore() {
  let restore!: ReturnType<typeof useSettingsRestore>;
  function Probe() {
    const result = useSettingsRestore();
    useEffect(() => {
      restore = result;
    });
    return null;
  }
  const screen = await render(<Probe />);
  return {
    ...screen,
    get restore() {
      return restore;
    },
  };
}
function setup() {
  vi.clearAllMocks();
  state.settings = { ...DEFAULT_UNIFIED_SETTINGS };
  state.confirm.mockResolvedValue(true);
  state.theme = "system";
  state.followSystem = true;
  state.themeHalves = null;
}

describe("restoring V2 settings", () => {
  it.each([
    ["persistComposerContextStrip", "Composer context"],
    ["compactIdleThreads", "Compact idle Claude threads (beta)"],
    ["autoResumeLimitedThreads", "Auto-resume limited threads"],
    ["snoozeLimitedThreads", "Snooze limited threads"],
  ] as const)("restores %s when it is the only changed setting", async (key, label) => {
    await using _lifecycle = await setupLifecycle();

    setup();
    state.settings = { ...DEFAULT_UNIFIED_SETTINGS, [key]: true };
    await using screen = await renderRestore();
    const { restore } = screen;

    expect(restore.changedSettingLabels).toEqual([label]);
    await act(() => restore.restoreDefaults());

    expect(state.confirm.mock.calls[0]?.[0]).toContain(label);
    expect(state.update).toHaveBeenCalledOnce();
    expect(state.update.mock.calls[0]?.[0][key]).toBe(DEFAULT_UNIFIED_SETTINGS[key]);
  });

  it.each([false, true])(
    "ignores the retired project sort preference regardless of the old sidebar choice (%s)",
    async (legacySidebarEnabled) => {
      await using _lifecycle = await setupLifecycle();

      setup();
      state.settings = {
        ...DEFAULT_UNIFIED_SETTINGS,
        legacySidebarEnabled,
        sidebarProjectSortOrder: "manual",
      };
      await using screen = await renderRestore();
      await act(() => screen.restore.restoreDefaults());

      expect(screen.restore.changedSettingLabels).toEqual([]);
      expect(state.confirm).not.toHaveBeenCalled();
      expect(state.update).not.toHaveBeenCalled();
    },
  );

  it("does not reset settings after cancellation", async () => {
    await using _lifecycle = await setupLifecycle();

    setup();
    state.settings = { ...DEFAULT_UNIFIED_SETTINGS, autoResumeLimitedThreads: true };
    state.confirm.mockResolvedValue(false);
    await using screen = await renderRestore();
    const { restore } = screen;

    await act(() => restore.restoreDefaults());

    expect(state.confirm).toHaveBeenCalledOnce();
    expect(state.update).not.toHaveBeenCalled();
  });

  it("includes language in the confirmation and restores the system preference", async () => {
    await using _lifecycle = await setupLifecycle();

    setup();
    state.settings = { ...DEFAULT_UNIFIED_SETTINGS, languagePreference: "zh" };
    await using screen = await renderRestore();
    expect(screen.restore.changedSettingLabels).toEqual(["Language"]);
    await act(async () => {
      await changeLanguage("zh");
    });
    expect(screen.restore.changedSettingLabels).toEqual(["语言"]);
    await act(() => screen.restore.restoreDefaults());
    expect(state.confirm.mock.calls[0]?.[0]).toBe("恢复默认设置？\n以下设置将被重置：语言。");
    expect(state.update.mock.calls[0]?.[0].languagePreference).toBe("system");
  });
});

it("translates dirty theme and browser defaults in the confirmation and preserves them when cancelled", async () => {
  await using _lifecycle = await setupLifecycle();

  setup();
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
  await using screen = await renderRestore();
  await act(async () => changeLanguage("zh"));
  await act(() => screen.restore.restoreDefaults());
  expect(state.confirm).toHaveBeenCalledExactlyOnceWith(
    "恢复默认设置？\n以下设置将被重置：主题、跟随系统、主题混合、可见会话数量、浏览器视口、浏览器缩放、浏览器外观、录制帧率、录制按键、录制鼠标点击、链接打开位置、悬浮预览。",
    { variant: "destructive" },
  );
  expect(state.update).not.toHaveBeenCalled();
  expect(state.theme).toBe("raw-custom-theme");
  await act(async () => changeLanguage("en"));
  expect(screen.restore.changedSettingLabels).toContain("Browser viewport");
  expect(state.confirm).toHaveBeenCalledOnce();
});

async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  stack.defer(async () => {
    await changeLanguage("en");
  });

  return stack.move();
}
