/**
 * The web client's i18next binding.
 *
 * The instance is configured and initialized at module load, so the first
 * render already has catalogs in memory and never flashes raw keys. Registering
 * the instance with `initReactI18next` also lets `useTranslation` find it
 * without a provider, which keeps component tests that render a screen directly
 * working unchanged.
 */
import { initReactI18next, useTranslation } from "react-i18next";

import { createI18n } from "@t3tools/client-runtime/i18n";
import type { SupportedLanguage } from "@t3tools/client-runtime/i18n";

export const i18n = createI18n({ plugins: [initReactI18next] });

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
  return useTranslation().t;
}
