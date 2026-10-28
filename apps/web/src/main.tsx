import React from "react";
import ReactDOM from "react-dom/client";

import "@fontsource-variable/inter";
import "./index.css";

import { hasCloudPublicConfig } from "./cloud/publicConfig";
import { isElectron } from "./env";
import { startAppServices } from "./appInit";
import { AppRoot } from "./AppRoot";
import { chunkLoadRecovery, clearChunkReloadGuard } from "./lib/chunkReloadGuard";

const router = startAppServices();

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

const app = <AppRoot router={router} />;

// Split by runtime to keep Clerk out of local startup and clerk-js out of browser builds.
const managedAuthShellModule =
  clerkPublishableKey && hasCloudPublicConfig()
    ? isElectron
      ? import("./components/clerk/ElectronManagedAuthShell")
      : import("./components/clerk/BrowserManagedAuthShell")
    : null;

export const startup = Promise.all([
  managedAuthShellModule?.then((module) => module.default) ?? null,
  router.load(),
])
  .then(([ManagedAuthShell]) => {
    // Route chunk failures resolve router.load() and surface later through the error boundary. Skip the
    // paint when a reload is on its way, and only re-arm the guard after a boot
    // that fetched every chunk it asked for.
    if (chunkLoadRecovery.reloading) return;
    if (!chunkLoadRecovery.failed) clearChunkReloadGuard();
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        {ManagedAuthShell && clerkPublishableKey ? (
          <ManagedAuthShell publishableKey={clerkPublishableKey}>{app}</ManagedAuthShell>
        ) : (
          app
        )}
      </React.StrictMode>,
    );
  })
  .catch((error: unknown) => {
    // Let the bootstrap entry show the error unless a reload is already scheduled.
    if (chunkLoadRecovery.reloading) return;
    throw error;
  });
