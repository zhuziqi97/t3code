import { decodeOptions, gtFallback } from "gt-i18n";
import { createLookupOptions, hashMessage } from "gt-i18n/internal";
import type { MFunctionType } from "gt-i18n/types";

import chinese from "../../../../apps/web/src/i18n/translations/zh.json" with { type: "json" };

const entries: Readonly<Record<string, unknown>> = chinese;

export const resolveChineseMessage: MFunctionType = ((message, variables) => {
  if (typeof message !== "string") return message;
  const decoded = decodeOptions(message);
  const options = typeof decoded?.$_source === "string" ? decoded : (variables ?? {});
  const source = decoded?.$_source ?? message;
  const entry = entries[hashMessage(source, createLookupOptions("zh", options, "ICU"))];
  const translated = typeof entry === "string" ? entry : undefined;
  return gtFallback(translated ?? source, {
    ...options,
    $locale: translated === undefined ? "en" : "zh",
  });
}) as MFunctionType;
