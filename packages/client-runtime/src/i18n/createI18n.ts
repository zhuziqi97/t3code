// Keep shared i18n React-free so each client can bind its own renderer.
import { createInstance, type i18n as I18nInstance, type Module } from "i18next";

import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, type SupportedLanguage } from "./languages.ts";
import { resources } from "./resources.ts";

// Register plugins before synchronous init; i18next does not initialize plugins added later.
export function createI18n(options?: {
  readonly lng?: SupportedLanguage;
  readonly plugins?: ReadonlyArray<Module>;
}): I18nInstance {
  const instance = createInstance();

  for (const plugin of options?.plugins ?? []) {
    instance.use(plugin);
  }

  void instance.init({
    lng: options?.lng ?? DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    resources,
    // Resources are already in memory, so nothing needs a backend or detector.
    initAsync: false,
    // Only match the primary subtag: `zh-Hans` and `zh-TW` both pick `zh`.
    load: "languageOnly",
    nonExplicitSupportedLngs: true,
    // A missing key reads as its own id rather than throwing or blanking a
    // surface. `fallbackLng` normally covers this; this is the last resort.
    returnNull: false,
    interpolation: {
      // React escapes whatever a client renders; letting i18next escape too
      // would double-encode quotes and apostrophes in visible text.
      escapeValue: false,
    },
    react: {
      // Mobile has no Suspense boundary around most screens, and the bundled
      // resources are ready at init, so suspension has nothing to wait for.
      useSuspense: false,
    },
  });

  return instance;
}
