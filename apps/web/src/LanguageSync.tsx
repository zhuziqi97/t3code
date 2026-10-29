import { useEffect } from "react";
import { resolveLanguage } from "@t3tools/client-runtime/i18n";
import { useClientSettings, useClientSettingsHydrated } from "./hooks/useSettings";
import { i18n, changeLanguage } from "./i18n";

// Mount above the router so pairing, welcome, and app routes share the hydrated language.
export function LanguageSync() {
  const languagePreference = useClientSettings((settings) => settings.languagePreference);
  const settingsHydrated = useClientSettingsHydrated();

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Sync the hydrated preference to i18next and the document language.
  useEffect(() => {
    if (!settingsHydrated) return;
    const language = resolveLanguage(languagePreference, navigator.languages);
    if (i18n.resolvedLanguage !== language) {
      void changeLanguage(language);
    }
    document.documentElement.lang = language;
  }, [languagePreference, settingsHydrated]);

  return null;
}
