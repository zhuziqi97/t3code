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
    case "Cursor is disabled in T3 Code settings.":
      return translate("provider.status.cursorDisabled");
    case "Checking Cursor SDK availability...":
      return translate("provider.status.cursorChecking");
    case "Sign in with Cursor or add CURSOR_API_KEY in provider settings.":
      return translate("provider.status.cursorSignIn");
    case "Cursor sign-in expired or was rejected. Sign in again in provider settings.":
      return translate("provider.status.cursorSignInRejected");
    case "Cursor SDK authentication failed. Check CURSOR_API_KEY.":
      return translate("provider.status.cursorAuthFailed");
    case "Cursor SDK catalog request failed. Check server logs for details.":
      return translate("provider.status.cursorCatalogFailed");
    case "Cursor SDK model discovery returned no built-in models.":
      return translate("provider.status.cursorNoModels");
    case "Grok is disabled in T3 Code settings.":
      return translate("provider.status.grokDisabled");
    case "Checking Grok CLI availability...":
      return translate("provider.status.grokChecking");
    case "Grok CLI (`grok`) is not installed or not on PATH.":
      return translate("provider.status.grokMissing");
    case "Failed to execute Grok CLI health check.":
      return translate("provider.status.grokHealthFailed");
    case "Grok CLI is installed but timed out while running `grok --version`.":
      return translate("provider.status.grokTimeout");
    case "Grok CLI is installed but failed to run.":
      return translate("provider.status.grokRunFailed");
    case "Grok CLI is installed but not logged in. Run `grok login`.":
      return translate("provider.status.grokUnauthenticated");
    case "Grok CLI is installed but ACP initialize failed. Model options may be incomplete.":
      return translate("provider.status.grokAcpFailed");
    case "OpenCode is disabled in T3 Code settings.":
      return translate("provider.status.opencodeDisabled");
    case "OpenCode is disabled in T3 Code settings. A server URL is configured.":
      return translate("provider.status.opencodeServerDisabled");
    case "OpenCode provider status has not been checked in this session yet.":
      return translate("provider.status.opencodeUnchecked");
    case "OpenCode server rejected authentication. Check the server URL and password.":
      return translate("provider.status.opencodeAuthFailed");
    case "Failed to connect to the configured OpenCode server.":
      return translate("provider.status.opencodeConnectFailed");
    case "OpenCode CLI (`opencode`) is not installed or not on PATH.":
      return translate("provider.status.opencodeMissing");
    case "macOS is blocking the OpenCode binary (quarantine). Run `xattr -d com.apple.quarantine $(which opencode)` to fix this.":
      return translate("provider.status.opencodeQuarantine");
    case "macOS killed the OpenCode process due to an invalid code signature. The binary may be corrupted — try reinstalling OpenCode.":
      return translate("provider.status.opencodeSignature");
    case "Failed to load OpenCode provider inventory.":
      return translate("provider.status.opencodeInventoryFailed");
    case "Failed to execute OpenCode CLI health check.":
      return translate("provider.status.opencodeHealthFailed");
    case "OpenCode could not load its model list.":
      return translate("provider.status.opencodeModelsFailed");
    case "OpenCode 2 is running, but it did not list any models yet.":
      return translate("provider.status.opencodeNoModels");
    case "Connected to the configured OpenCode server, but it did not report any connected upstream providers.":
      return translate("provider.status.opencodeServerNoUpstreams");
    case "OpenCode is available, but it did not report any connected upstream providers.":
      return translate("provider.status.opencodeNoUpstreams");
    case "Pi is disabled in T3 Code settings.":
      return translate("provider.status.piDisabled");
    case "Checking Pi CLI availability...":
      return translate("provider.status.piChecking");
    case "Pi CLI (`pi`) is not installed or not on PATH. Install with `npm install -g @earendil-works/pi-coding-agent`.":
      return translate("provider.status.piMissing");
    case "Failed to execute Pi CLI health check.":
      return translate("provider.status.piHealthFailed");
    case "Pi CLI is installed but timed out while running `pi --version`.":
      return translate("provider.status.piTimeout");
    case "Pi CLI is installed but failed to run.":
      return translate("provider.status.piRunFailed");
    case "Pi is available, but T3 Code could not refresh its models and commands. The live session will retry startup.":
      return translate("provider.status.piDiscoveryFailed");
    case "Pi is available, but model and command discovery needs interactive input. The live session will handle it.":
      return translate("provider.status.piDiscoveryInteractive");
    case "Pi has no usable models. Run `pi` in a terminal and use /login, or configure an API key in ~/.pi/agent.":
      return translate("provider.status.piNoModels");
    case "Pi launch arguments cannot include positional prompts.":
      return translate("provider.status.piNoPositionalPrompts");
    case "Pi launch argument '--provider' requires '--model'.":
      return translate("provider.status.piProviderRequiresModel");
    case "Checking Muse Code CLI availability...":
      return translate("provider.status.museChecking");
    case "Muse Code is disabled in T3 Code settings.":
      return translate("provider.status.museDisabled");
    case "Muse Code CLI (`muse`) was not found. Install Muse Code and run `muse login` on this T3 server host.":
      return translate("provider.status.museMissing");
    case "Failed to execute Muse Code CLI. Check its binary path on this T3 server host.":
      return translate("provider.status.museHealthFailed");
    case "Muse Code CLI version check timed out.":
      return translate("provider.status.museTimeout");
    case "Muse Code CLI is installed but failed to run.":
      return translate("provider.status.museRunFailed");
    case "Muse Code SDK could not read the model catalog. Check your Muse installation and run `muse login` on this T3 server host.":
      return translate("provider.status.museCatalogFailed");
    case "Muse Code returned no models. Run `muse login` on this T3 server host and refresh its status.":
      return translate("provider.status.museNoModels");
  }
  const detailPrefixes = [
    ["Codex app-server provider probe failed: ", "provider.status.codexProbeFailed"],
    ["Failed to load OpenCode provider inventory: ", "provider.status.opencodeInventoryDetail"],
    ["Failed to execute OpenCode CLI health check: ", "provider.status.opencodeHealthDetail"],
  ] as const;
  for (const [prefix, key] of detailPrefixes) {
    if (message.startsWith(prefix)) return translate(key, { detail: message.slice(prefix.length) });
  }
  const cursorTimeout = /^Cursor SDK catalog request timed out after (\d+)ms\.$/.exec(message);
  if (cursorTimeout)
    return translate("provider.status.cursorTimeout", { milliseconds: cursorTimeout[1] });
  const openCodeServer =
    /^Couldn't reach the configured OpenCode server at ([\s\S]+)\. Check that the server is running and the URL is correct\.$/.exec(
      message,
    );
  if (openCodeServer)
    return translate("provider.status.opencodeServerUnreachable", { url: openCodeServer[1] });
  const openCodeVersion = /^OpenCode v(\S+) is too old\. Upgrade to v(\S+) or newer\.$/.exec(
    message,
  );
  if (openCodeVersion)
    return translate("provider.status.opencodeOldVersion", {
      version: openCodeVersion[1],
      minimum: openCodeVersion[2],
    });
  const openCodeUpstreams =
    /^(\d+) upstream providers? connected through (OpenCode|the configured OpenCode server)\.$/.exec(
      message,
    );
  if (openCodeUpstreams)
    return translate(
      openCodeUpstreams[2] === "OpenCode"
        ? "provider.status.opencodeUpstreams"
        : "provider.status.opencodeServerUpstreams",
      { count: Number(openCodeUpstreams[1]) },
    );
  const openCodeModels = /^OpenCode (\S+) lists (\d+) models?\.$/.exec(message);
  if (openCodeModels)
    return translate("provider.status.opencodeModelCount", {
      version: openCodeModels[1],
      count: Number(openCodeModels[2]),
    });
  const piUnknownVersion =
    /^T3 Code could not determine the Pi version\. Pi (\S+) or newer is required\.$/.exec(message);
  if (piUnknownVersion)
    return translate("provider.status.piUnknownVersion", { minimum: piUnknownVersion[1] });
  const piVersion = /^Pi (\S+) is unsupported\. Update to Pi (\S+) or newer\.$/.exec(message);
  if (piVersion)
    return translate("provider.status.piOldVersion", {
      version: piVersion[1],
      minimum: piVersion[2],
    });
  const piControlledArgument =
    /^Pi launch argument '([\s\S]+)' is controlled by T3 Code and cannot be overridden\.$/.exec(
      message,
    );
  if (piControlledArgument)
    return translate("provider.status.piControlledArgument", { argument: piControlledArgument[1] });
  const piArgumentValue = /^Pi launch argument '([\s\S]+)' requires a value\.$/.exec(message);
  if (piArgumentValue)
    return translate("provider.status.piArgumentValue", { argument: piArgumentValue[1] });
  const piUnsupportedArgument =
    /^Pi launch argument '([\s\S]+)' is not supported by T3 Code\.$/.exec(message);
  if (piUnsupportedArgument)
    return translate("provider.status.piUnsupportedArgument", {
      argument: piUnsupportedArgument[1],
    });
  const piPrompt = /^Pi launch arguments cannot include positional prompt '([\s\S]+)'\.$/.exec(
    message,
  );
  if (piPrompt) return translate("provider.status.piPositionalPrompt", { prompt: piPrompt[1] });
  return message;
}

export function formatProviderAuthLabel(
  provider: ServerProvider,
  translate: TFunction,
): string | undefined {
  const label = provider.auth.label ?? provider.auth.type;
  if (provider.driver === "grok") {
    if (label === "Grok account") return translate("provider.auth.grokAccount");
    if (label === "xAI API key") return translate("provider.auth.xaiApiKey");
  }
  if (provider.driver !== "cursor" || !label) return label;
  if (label === "Cursor account") return translate("provider.auth.cursorAccount");
  if (label === "Cursor API key") return translate("provider.auth.cursorApiKey");
  const namedKey = /^Cursor API key \(([\s\S]+)\)$/.exec(label);
  return namedKey ? translate("provider.auth.cursorNamedApiKey", { name: namedKey[1] }) : label;
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
    const authLabel = formatProviderAuthLabel(provider, translate);
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
    const authLabel = formatProviderAuthLabel(provider, translate);
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
