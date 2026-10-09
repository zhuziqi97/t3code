import { afterEach, expect, it, vi } from "vite-plus/test";
vi.mock("~/env", () => ({ isElectron: true }));
import { changeLanguage } from "../../i18n";
import { getSettingsSearchTargetScope, searchableSetting, searchSettings } from "./settingsSearch";

afterEach(async () => {
  await changeLanguage("en");
});
it("finds desktop update controls from bilingual queries and keeps the device-local destination", async () => {
  for (const language of ["zh", "en"] as const) {
    await changeLanguage(language);
    for (const query of [
      "桌面更新",
      "检查更新",
      "更新渠道",
      "Desktop updates",
      "check for updates",
    ]) {
      expect(searchSettings(query)).toContainEqual(
        expect.objectContaining({
          id: "desktop-updates",
          title: language === "zh" ? "桌面更新" : "Desktop updates",
          to: "/settings/general",
          desktopOnly: true,
        }),
      );
    }
    expect(searchableSetting("desktop-updates").id).toBe("desktop-updates");
    expect(getSettingsSearchTargetScope("desktop-updates")?.scope).toBeNull();
  }
});
