import { GTProvider } from "gt-react";
import { useSyncExternalStore, type ReactNode } from "react";

import { getI18nSnapshot, subscribeI18n } from "./runtime";

export function I18nProvider({
  children,
  onLocaleRequest,
}: {
  readonly children: ReactNode;
  readonly onLocaleRequest?: (locale: string) => void;
}) {
  const { locale, translations } = useSyncExternalStore(subscribeI18n, getI18nSnapshot);
  return (
    <GTProvider
      locale={locale}
      translations={translations}
      _reload={(state) => onLocaleRequest?.(state.locale)}
    >
      {children}
    </GTProvider>
  );
}
