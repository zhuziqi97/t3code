import { useEffect } from "react";
import { resolveLanguage } from "@t3tools/client-runtime/i18n";
import { useClientSettings } from "./hooks/useSettings";
import { i18n, changeLanguage } from "./i18n";

/**
 * Applies the stored language preference to i18next and to the document.
 *
 * Rendered once above the router rather than inside a route, because
 * `__root` returns several separate trees (pair, welcome, app shell) and a
 * branch that forgets this would silently render in the source language.
 *
 * The host locale is consulted only for `system`, and only here: resolving it
 * at module load would freeze the choice before settings hydrate.
 */
export function LanguageSync() {
  const languagePreference = useClientSettings((settings) => settings.languagePreference);

  useEffect(() => {
    const language = resolveLanguage(languagePreference, navigator.languages);
    if (i18n.resolvedLanguage !== language) {
      void changeLanguage(language);
    }
    document.documentElement.lang = language;
  }, [languagePreference]);

  return null;
}
