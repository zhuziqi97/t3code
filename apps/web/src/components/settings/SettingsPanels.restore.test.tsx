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
}));

vi.mock("../../hooks/useTheme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hooks/useTheme")>()),
  useTheme: () => ({
    theme: "system",
    followSystem: true,
    themeHalves: null,
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
