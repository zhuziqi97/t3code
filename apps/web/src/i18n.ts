/**
 * The web client's i18next binding.
 *
 * The instance is configured and initialized at module load, so the first
 * render already has catalogs in memory and never flashes raw keys. Registering
 * the instance with `initReactI18next` also lets `useTranslation` find it
 * without a provider, which keeps component tests that render a screen directly
 * working unchanged.
 */
import { getI18n, initReactI18next, setI18n, useTranslation } from "react-i18next";

import { createI18n } from "@t3tools/client-runtime/i18n";
import type { SupportedLanguage } from "@t3tools/client-runtime/i18n";

// A newly loaded consumer can import this binding before dispose data is
// available. Reuse the renderer's instance rather than registering a second one.
const preservedInstance = import.meta.hot?.data
  ? (getI18n() ?? (import.meta.hot.data.i18n as ReturnType<typeof createI18n> | undefined))
  : undefined;
export const i18n = preservedInstance ?? createI18n({ plugins: [initReactI18next] });

if (import.meta.hot?.data) {
  import.meta.hot.accept();
  // Catalog edits replace this module too. Keep React's instance and the active
  // language, otherwise unchanged language preferences never reapply after HMR.
  import.meta.hot.dispose((data) => {
    data.i18n = i18n;
  });
  if (preservedInstance) {
    setI18n(i18n);
    const updatedCatalogs = createI18n();
    for (const [language, namespaces] of Object.entries(updatedCatalogs.store.data)) {
      for (const [namespace, messages] of Object.entries(namespaces)) {
        i18n.removeResourceBundle(language, namespace);
        i18n.addResourceBundle(language, namespace, messages);
      }
    }
    void i18n.changeLanguage(i18n.language);
  }
}

/**
 * Switch the interface language.
 *
 * Resolves once catalogs for `language` are active. Catalogs are bundled, so
 * this never waits on a request; the returned promise keeps callers free to
 * treat it as async.
 */
export function changeLanguage(language: SupportedLanguage): Promise<unknown> {
  return i18n.changeLanguage(language);
}

/** Translate function bound to the active language. */
export function useTranslate() {
  return useTranslation(undefined, { i18n }).t;
}
