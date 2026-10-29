// Bundle catalogs eagerly so the first render never waits for translations.
import { en, type MessageKey } from "./messages.en.ts";
import { zh } from "./messages.zh.ts";

/** Key type only: the catalogs themselves stay private to this module. */
export type { MessageKey };
export type Messages = Record<MessageKey, string>;

/** Every shipped catalog, keyed by the language tag clients select. */
export const resources = {
  en: { translation: en },
  zh: { translation: zh },
} as const;
