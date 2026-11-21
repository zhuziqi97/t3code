import { isLanguagePreference } from "@t3tools/client-runtime/i18n";
import { changeLanguage, i18n } from "../i18n";
import { resolveLocaleSelection } from "@t3tools/client-runtime/locales";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { GTProvider, initializeGT, useLocale } from "gt-react-native";
import { createContext, use, useDeferredValue, useEffect, useMemo, type ReactNode } from "react";
import { Platform, TurboModuleRegistry, View, type TurboModule } from "react-native";

import { mobilePreferencesAtom } from "../state/preferences";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./locales";
import { setActiveLocale } from "./messages";

const FormattingLocaleContext = createContext<string>(DEFAULT_LOCALE);

export function useFormattingLocale(): string {
  return use(FormattingLocaleContext);
}

// Committed catalogs, so forks and offline installs never reach GT's CDN. English is the source.
// Required on demand: Metro runs every statically imported module at startup, and only one
// locale's catalog is ever used.
const CATALOGS: Readonly<Record<string, () => unknown>> = {
  es: () => require("./translations/es.json"),
  zh: () => require("./translations/zh.json"),
  "pt-BR": () => require("./translations/pt-BR.json"),
  fr: () => require("./translations/fr.json"),
  de: () => require("./translations/de.json"),
  ja: () => require("./translations/ja.json"),
  ko: () => require("./translations/ko.json"),
  ru: () => require("./translations/ru.json"),
  sv: () => require("./translations/sv.json"),
};

initializeGT({
  defaultLocale: DEFAULT_LOCALE,
  locales: [...SUPPORTED_LOCALES],
  loadTranslations: async (locale: string) => CATALOGS[locale]?.() ?? {},
  // Loaded catalogs never go stale; GT's default 60 s expiry would only reload the same file.
  cacheExpiryTime: null,
});

function readSystemLocales(): ReadonlyArray<string> {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  try {
    const nativeLocales =
      TurboModuleRegistry.get<{ getNativeLocales(): string[] } & TurboModule>(
        "GtReactNative",
      )?.getNativeLocales() ?? [];
    // iOS reports the app bundle locale before the device preferences.
    const preferred = Platform.OS === "ios" ? nativeLocales.slice(1) : nativeLocales;
    return preferred.length > 0 ? preferred : [locale];
  } catch {
    return [locale];
  }
}

export function useLanguagePreference() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  return AsyncResult.isSuccess(preferences)
    ? (preferences.value.languagePreference ?? "system")
    : "system";
}

/** Translates the app into the saved language; "system" follows the device. Mounted once in App. */
export function I18nProvider(props: { readonly children: ReactNode }) {
  const { catalogLocale, formattingLocale } = resolveLocaleSelection(
    useLanguagePreference(),
    readSystemLocales(),
    SUPPORTED_LOCALES,
    DEFAULT_LOCALE,
  );
  // GT suspends while a locale's catalog loads. Deferring the switch keeps the current language
  // on screen until then, instead of GT's full-screen spinner.
  const selection = useDeferredValue(
    useMemo(() => ({ catalogLocale, formattingLocale }), [catalogLocale, formattingLocale]),
  );
  return (
    <GTProvider locale={selection.catalogLocale} fallback={<View className="flex-1 bg-screen" />}>
      <ActiveLocale />
      <FormattingLocaleContext value={selection.formattingLocale}>
        {props.children}
      </FormattingLocaleContext>
    </GTProvider>
  );
}

function ActiveLocale() {
  const locale = useLocale();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- synchronize the loaded locale to both translation runtimes
  useEffect(() => {
    setActiveLocale(locale);
    if (isLanguagePreference(locale) && locale !== "system" && i18n.resolvedLanguage !== locale) {
      void changeLanguage(locale);
    }
  }, [locale]);
  return null;
}
