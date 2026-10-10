import type { TFunction } from "i18next";
import { PREVIEW_ERROR_CODE_MESSAGES } from "./previewConstants";

/**
 * Resolve a friendly description for a Chromium / network error. Falls back
 * to the description string passed in when it isn't in our table.
 */
export function describePreviewError(description: string, t?: TFunction): string {
  const friendly = PREVIEW_ERROR_CODE_MESSAGES[description];
  if (friendly) return t ? t(`browser.network.${description}`) : friendly;
  if (description.length > 0) return description;
  return t ? t("browser.networkError") : "Network error";
}
