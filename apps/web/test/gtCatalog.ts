import {
  decodeOptions,
  getReactI18nCache,
  getTranslationsSnapshot,
  gtFallback,
  initializeGT,
} from "gt-react";
import type { MessageResolver } from "../src/i18n/messages";
import chinese from "../src/i18n/translations/zh.json" with { type: "json" };

await initializeGT({
  defaultLocale: "en",
  locales: ["en", "zh"],
  loadTranslations: async (locale) => (locale === "zh" ? chinese : {}),
  cacheExpiryTime: null,
});
await getTranslationsSnapshot("zh");

export const resolveChineseMessage: MessageResolver = ((message, variables) => {
  if (typeof message !== "string") return message;
  const decoded = decodeOptions(message);
  const options = typeof decoded?.$_source === "string" ? decoded : (variables ?? {});
  const source = decoded?.$_source ?? message;
  const translated = getReactI18nCache().lookupTranslation("zh", source, {
    ...options,
    $format: "ICU",
  });
  return gtFallback(typeof translated === "string" ? translated : source, {
    ...options,
    $locale: typeof translated === "string" ? "zh" : "en",
  });
}) as MessageResolver;
