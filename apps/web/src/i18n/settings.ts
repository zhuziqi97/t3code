import { isLanguagePreference, resolveLanguage } from "@t3tools/client-runtime/i18n";

import {
  getClientSettings,
  subscribeClientSettings,
  updateClientSettings,
} from "../hooks/useSettings";
import { initializeI18n } from "./initializeI18n";
import { requestLocale } from "./runtime";

function applyLanguageSetting(): void {
  void requestLocale(resolveLanguage(getClientSettings().languagePreference, navigator.languages));
}

/** GT's own locale setters write the saved setting, which stays the only source of truth. */
export function persistGTLocale(locale: string): void {
  if (isLanguagePreference(locale)) void updateClientSettings({ languagePreference: locale });
}

export function startI18n(): void {
  initializeI18n(persistGTLocale);
  subscribeClientSettings(applyLanguageSetting);
  applyLanguageSetting();
}
