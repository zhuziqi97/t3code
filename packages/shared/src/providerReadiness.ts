import type { ServerProvider } from "@t3tools/contracts";

/** Discovery warnings do not revoke installation or a live execution capability. */
export function isProviderReady(
  provider: Pick<ServerProvider, "enabled" | "installed" | "status" | "auth" | "availability">,
): boolean {
  return (
    provider.enabled &&
    provider.availability !== "unavailable" &&
    provider.installed === true &&
    provider.auth.status !== "unauthenticated" &&
    (provider.status === "ready" || provider.status === "warning")
  );
}

/** A known selection can start while background discovery is still connecting. */
export function canStartProviderSession(
  provider: Pick<ServerProvider, "enabled" | "installed" | "status" | "auth" | "availability">,
): boolean {
  return (
    provider.enabled &&
    provider.availability !== "unavailable" &&
    provider.installed !== false &&
    provider.auth.status !== "unauthenticated" &&
    (provider.status === "checking" || isProviderReady(provider))
  );
}
