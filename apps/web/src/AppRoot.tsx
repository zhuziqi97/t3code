import { RouterProvider } from "@tanstack/react-router";

import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { LanguageSync } from "./LanguageSync";
import { I18nProvider } from "./i18n/I18nProvider";
import { persistGTLocale } from "./i18n/settings";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import type { AppRouter } from "./router";

// Keep webviews outside the router but inside its atom registry so route changes preserve them.
export function AppRoot({ router }: { readonly router: AppRouter }) {
  return (
    <I18nProvider onLocaleRequest={persistGTLocale}>
      <AppAtomRegistryProvider>
        <LanguageSync />
        <RouterProvider router={router} />
        <ElectronBrowserHost />
        <QuitHoldOverlay />
      </AppAtomRegistryProvider>
    </I18nProvider>
  );
}
