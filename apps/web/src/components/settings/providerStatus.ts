import type { TFunction } from "i18next";
import { i18n } from "../../i18n";
import type {
  ServerProvider,
  ServerProviderVersionAdvisory,
  ServerProviderCompatibilityAdvisory,
} from "@t3tools/contracts";

/**
 * Visual treatment for each server-reported provider status. Centralized so
 * the default-driver card and per-instance cards share the same language.
 */
export const PROVIDER_STATUS_STYLES = {
  disabled: {
    dot: "bg-muted-foreground/50",
  },
  error: {
    dot: "bg-destructive",
  },
  ready: {
    dot: "bg-success",
  },
  warning: {
    dot: "bg-warning",
  },
} as const;

export type ProviderStatusKey = keyof typeof PROVIDER_STATUS_STYLES;

/** Translate T3's provider guidance while retaining CLI diagnostics verbatim. */
export function formatProviderStatusMessage(message: string, translate: TFunction): string {
  switch (message) {
    case "Timed out while checking Codex app-server provider status.":
      return translate("provider.status.codexTimeout");
    case "Codex is disabled in T3 Code settings.":
      return translate("provider.status.codexDisabled");
    case "Codex provider status has not been checked in this session yet.":
      return translate("provider.status.codexUnchecked");
    case "Codex CLI is not authenticated. Run `codex login` and try again.":
      return translate("provider.status.codexUnauthenticated");
    case "Claude is disabled in T3 Code settings.":
      return translate("provider.status.claudeDisabled");
    case "Claude provider status has not been checked in this session yet.":
      return translate("provider.status.claudeUnchecked");
    case "Claude Agent CLI (`claude`) was not found on PATH.":
      return translate("provider.status.claudeMissing");
    case "Failed to execute Claude Agent CLI health check.":
      return translate("provider.status.claudeHealthFailed");
    case "Claude Agent CLI is installed but failed to run. Timed out while running command.":
      return translate("provider.status.claudeTimeout");
    case "Claude Agent CLI is installed but failed to run.":
      return translate("provider.status.claudeRunFailed");
    case "Could not verify Claude authentication status from initialization result.":
      return translate("provider.status.claudeAuthUnknown");
    case "Claude Code is not authenticated. Run `claude auth login` and try again.":
      return translate("provider.status.claudeUnauthenticated");
    case "Checking Antigravity availability.":
      return translate("provider.status.antigravityChecking");
    case "Antigravity is disabled in T3 Code settings.":
      return translate("provider.status.antigravityDisabled");
    case "Sign in with Google to use Antigravity.":
      return translate("provider.status.antigravitySignIn");
    case "Antigravity is installed. Google account access is not checked yet.":
      return translate("provider.status.antigravityUnchecked");
    case "Set up Codex to get started.":
      return translate("provider.status.codexSetup");
    case "Sign in with ChatGPT to use Codex.":
      return translate("provider.status.codexChatGptSignIn");
    case "Signed in with ChatGPT, but token sharing is disabled. Sign in again and enable token sharing, or use another provider.":
      return translate("provider.status.codexTokenSharingDisabled");
    case "Could not check Codex right now. Retry, or reconnect in provider settings.":
      return translate("provider.status.codexCheckFailed");
  }
  const probeFailure = "Codex app-server provider probe failed: ";
  return message.startsWith(probeFailure)
    ? translate("provider.status.codexProbeFailed", { detail: message.slice(probeFailure.length) })
    : message;
}

/**
 * Derive the headline + detail copy shown under a provider's name in the
 * settings page. Prefers `provider.message` for server-supplied detail and
 * falls back to generic phrasing when the server has not yet reported any
 * state — which happens before the first probe or when an instance names a
 * driver this build does not ship. A ready provider without account metadata
 * remains available and does not imply an authentication failure.
 */
export function getProviderSummary(
  provider: ServerProvider | undefined,
  translate: TFunction = i18n.t,
) {
  if (!provider) {
    return {
      headline: translate("provider.checking"),
      detail: translate("provider.waiting"),
    };
  }
  const message =
    provider.message === undefined
      ? undefined
      : formatProviderStatusMessage(provider.message, translate);
  if (!provider.enabled || provider.status === "disabled") {
    return {
      headline: translate("provider.disabled"),
      detail: message ?? translate("provider.disabledDescription"),
    };
  }
  if (!provider.installed) {
    return {
      headline: translate("provider.notFound"),
      detail: message ?? translate("provider.noCli"),
    };
  }
  if (provider.auth.status === "unauthenticated") {
    const authLabel = provider.auth.label ?? provider.auth.type;
    return {
      headline: authLabel
        ? translate("provider.unauthenticatedWithLabel", { label: authLabel })
        : translate("provider.unauthenticated"),
      detail: message ?? null,
    };
  }
  if (provider.status === "warning") {
    return {
      headline: translate("provider.needsAttention"),
      detail: message ?? translate("provider.notVerified"),
    };
  }
  if (provider.status === "error") {
    return {
      headline: translate("provider.unavailable"),
      detail: message ?? translate("provider.checkFailed"),
    };
  }
  if (provider.auth.status === "authenticated") {
    const authLabel = provider.auth.label ?? provider.auth.type;
    return {
      headline: authLabel
        ? translate("provider.authenticatedWithLabel", { label: authLabel })
        : translate("provider.authenticated"),
      detail: message ?? null,
    };
  }
  return {
    headline: translate("provider.available"),
    detail: message ?? null,
  };
}

/**
 * Normalize a version string for display. Adds the `v` prefix when the
 * driver reported a bare version (e.g. `1.2.3`) so cards render
 * consistently regardless of driver.
 */
export function getProviderVersionLabel(version: string | null | undefined) {
  if (!version) return null;
  // Antigravity reports a release tag such as `agy_acp_server_20260818_01_RC01`.
  // Show the date and candidate so the row title keeps room for the name.
  const antigravity = /^agy_acp_server_(\d{4})(\d{2})(\d{2})_\d+(?:_(\w+))?$/.exec(version);
  if (antigravity) {
    const [, year, month, day, candidate] = antigravity;
    return `${year}-${month}-${day}${candidate ? ` ${candidate}` : ""}`;
  }
  // Only bare semver-like versions get a `v` prefix. Other tags are shown as-is.
  return /^\d/.test(version) ? `v${version}` : version;
}

const COMPATIBILITY_TITLE_KEYS = {
  graceful: "provider.version.graceful",
  unsupported: "provider.version.unsupported",
  broken: "provider.version.broken",
} as const;

/** Compatibility guidance shares the version popover, with safe install actions. */
export function getProviderVersionAdvisoryPresentation(
  advisory: ServerProviderVersionAdvisory | undefined,
  compatibility?: ServerProviderCompatibilityAdvisory | undefined,
  showCompatibility = true,
  translate: TFunction = i18n.t,
): {
  readonly title: string;
  readonly detail: string;
  readonly updateCommand: string | null;
  readonly emphasis: "normal" | "strong";
  readonly targetVersion: string | null;
} | null {
  const latestIsIncompatible =
    compatibility?.latestVersionStatus === "broken" ||
    compatibility?.latestVersionStatus === "unsupported";
  if (
    showCompatibility &&
    compatibility &&
    (compatibility.status === "graceful" ||
      compatibility.status === "unsupported" ||
      compatibility.status === "broken")
  ) {
    const targetVersion = compatibility.recommendedVersion;
    const recommendation = getProviderVersionLabel(targetVersion) ?? compatibility.recommendedRange;
    return {
      title: translate(COMPATIBILITY_TITLE_KEYS[compatibility.status]),
      detail:
        compatibility.message ??
        (recommendation
          ? translate("provider.version.recommended", { version: recommendation })
          : translate("provider.version.updateSupport")),
      updateCommand:
        targetVersion || latestIsIncompatible ? null : (advisory?.updateCommand ?? null),
      emphasis: compatibility.status === "graceful" ? "normal" : "strong",
      targetVersion,
    };
  }
  if (
    !advisory ||
    advisory.status === "current" ||
    advisory.status === "unknown" ||
    latestIsIncompatible
  ) {
    return null;
  }

  const label = translate("provider.version.available");
  const version = advisory.latestVersion;
  const versionLabel = getProviderVersionLabel(version);

  return {
    title: label,
    detail:
      advisory.message ??
      (versionLabel
        ? translate("provider.version.installVersion", { version: versionLabel })
        : translate("provider.version.installLatest")),
    updateCommand: advisory.updateCommand,
    emphasis: "normal" as const,
    targetVersion: null,
  };
}
