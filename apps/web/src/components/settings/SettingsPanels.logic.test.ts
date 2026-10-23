import { getChangedTypographySettingLabels } from "./SettingsPanels.logic";
import { i18n } from "../../i18n";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts";

import * as Duration from "effect/Duration";
import { describe, expect, it } from "vite-plus/test";
import {
  backgroundActivitySharedPolicySettings,
  getChangedBrowserSettingLabels,
  hasChangedBackgroundActivitySettings,
} from "./SettingsPanels.logic";
import { createI18n } from "@t3tools/client-runtime/i18n";
const translations = createI18n();
const t = translations.getFixedT("en");

describe("typography settings restore", () => {
  it("detects family and size changes by font row", () => {
    expect(getChangedTypographySettingLabels(DEFAULT_UNIFIED_SETTINGS, t)).toEqual([]);
    expect(
      getChangedTypographySettingLabels(
        {
          ...DEFAULT_UNIFIED_SETTINGS,
          fontSizeInterface: 18,
          fontFamilyCode: "Fira Code",
        },
        t,
      ),
    ).toEqual(["Interface font", "Code font"]);
  });
});

describe("background activity settings restore", () => {
  it("detects legacy interval values even when the structured setting is at its default", () => {
    expect(
      hasChangedBackgroundActivitySettings({
        backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
        backgroundActivityProfile: DEFAULT_UNIFIED_SETTINGS.backgroundActivityProfile,
        automaticGitFetchInterval: Duration.seconds(45),
        providerHealthRefreshInterval: DEFAULT_UNIFIED_SETTINGS.providerHealthRefreshInterval,
      }),
    ).toBe(true);
    expect(
      hasChangedBackgroundActivitySettings({
        backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
        backgroundActivityProfile: DEFAULT_UNIFIED_SETTINGS.backgroundActivityProfile,
        automaticGitFetchInterval: DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval,
        providerHealthRefreshInterval: Duration.minutes(7),
      }),
    ).toBe(true);
    expect(hasChangedBackgroundActivitySettings(DEFAULT_UNIFIED_SETTINGS)).toBe(false);
  });

  it("preserves advanced overrides when the shared policy changes", () => {
    const automaticGitFetchInterval = Duration.seconds(42);
    expect(
      backgroundActivitySharedPolicySettings(
        {
          ...DEFAULT_UNIFIED_SETTINGS,
          backgroundActivity: {
            schemaVersion: 1,
            profile: "custom",
            baseProfile: "balanced",
            overrides: {
              automaticGitFetchInterval,
              pauseWhenOnBattery: true,
            },
          },
        },
        "performance",
      ),
    ).toEqual({
      schemaVersion: 1,
      profile: "custom",
      baseProfile: "performance",
      overrides: {
        automaticGitFetchInterval,
        pauseWhenOnBattery: true,
      },
    });
  });

  it("materializes legacy advanced overrides before changing the shared policy", () => {
    const automaticGitFetchInterval = Duration.seconds(42);
    expect(
      backgroundActivitySharedPolicySettings(
        {
          ...DEFAULT_UNIFIED_SETTINGS,
          automaticGitFetchInterval,
        },
        "battery-saver",
      ),
    ).toEqual({
      schemaVersion: 1,
      profile: "custom",
      baseProfile: "battery-saver",
      overrides: {
        automaticGitFetchInterval,
      },
    });
  });
});

describe("getChangedBrowserSettingLabels", () => {
  it("reports nothing for the defaults", () => {
    expect(getChangedBrowserSettingLabels(DEFAULT_UNIFIED_SETTINGS, i18n.getFixedT("en"))).toEqual(
      [],
    );
  });

  it("treats a structurally equal viewport as unchanged", () => {
    expect(
      getChangedBrowserSettingLabels(
        {
          ...DEFAULT_UNIFIED_SETTINGS,
          browserDefaultViewport: { ...DEFAULT_UNIFIED_SETTINGS.browserDefaultViewport },
        },
        i18n.getFixedT("en"),
      ),
    ).toEqual([]);
  });

  it("counts a retained custom search URL so restore clears it", () => {
    expect(
      getChangedBrowserSettingLabels({
        ...DEFAULT_UNIFIED_SETTINGS,
        browserCustomSearchUrl: "https://search.example/?q=%s",
      }),
    ).toEqual(["Search engine"]);
  });

  it("labels each browser default that differs", () => {
    expect(
      getChangedBrowserSettingLabels(
        {
          ...DEFAULT_UNIFIED_SETTINGS,
          browserDefaultViewport: { _tag: "freeform", width: 900, height: 600 },
          browserDefaultZoomFactor: 1.5,
          browserDefaultAppearance: "dark",
          browserRecordingFrameRate: 60,
          browserRecordingShowKeyPresses: true,
          browserRecordingShowMousePresses: true,
          browserLinkTarget: "app",
          pullRequestLinksOpenInApp: false,
          browserAutoShowFloatingPreview: !DEFAULT_UNIFIED_SETTINGS.browserAutoShowFloatingPreview,
        },
        i18n.getFixedT("en"),
      ),
    ).toEqual([
      "Browser viewport",
      "Browser zoom",
      "Browser appearance",
      "Recording frame rate",
      "Recording key presses",
      "Recording mouse presses",
      "Open links in",
      "Floating preview",
      "Open pull requests in T3 Code",
    ]);
  });
});
