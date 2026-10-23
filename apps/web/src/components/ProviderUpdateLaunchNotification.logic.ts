import { i18n } from "../i18n";
import type { TFunction } from "i18next";
import {
  defaultInstanceIdForDriver,
  PROVIDER_DISPLAY_NAMES,
  type EnvironmentId,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";

export type ProviderUpdateCandidate = ServerProvider & {
  readonly versionAdvisory: NonNullable<ServerProvider["versionAdvisory"]> & {
    readonly status: "behind_latest";
    readonly latestVersion: string;
  };
};

export type ProviderSettingsUpdateCandidate = ServerProvider & {
  readonly versionAdvisory: NonNullable<ServerProvider["versionAdvisory"]> & {
    readonly canUpdate: true;
    readonly updateCommand: string;
  };
};

export type ProviderUpdateSidebarPillTone = "loading" | "warning" | "error" | "success";

export interface ProviderUpdateSidebarPillView {
  readonly key: string;
  readonly tone: ProviderUpdateSidebarPillTone;
  readonly title: string;
  readonly description: string;
  readonly dismissible?: boolean;
  readonly dismissAfterVisibleMs?: number;
}

interface ProviderUpdateSidebarPillOptions {
  readonly visibleAfterIso?: string;
  readonly dismissedKeys?: ReadonlySet<string>;
}

const PROVIDER_UPDATE_SUCCESS_VISIBLE_MS = 3_000;

function formatVersion(value: string): string {
  return value.startsWith("v") ? value : `v${value}`;
}

function chooseRepresentativeProvider(
  current: ServerProvider | undefined,
  candidate: ServerProvider,
): ServerProvider {
  if (!current) {
    return candidate;
  }
  const defaultInstanceId = defaultInstanceIdForDriver(candidate.driver);
  if (candidate.instanceId === defaultInstanceId) {
    return candidate;
  }
  if (current.instanceId === defaultInstanceId) {
    return current;
  }
  return candidate.checkedAt.localeCompare(current.checkedAt) >= 0 ? candidate : current;
}

function dedupeProvidersByDriver<T extends ServerProvider>(providers: ReadonlyArray<T>): T[] {
  const latestProviderByDriver = new Map<ProviderDriverKind, T>();

  for (const provider of providers) {
    latestProviderByDriver.set(
      provider.driver,
      chooseRepresentativeProvider(latestProviderByDriver.get(provider.driver), provider) as T,
    );
  }

  return [...latestProviderByDriver.values()];
}

function getProviderUpdatedTitle(
  provider: Pick<ServerProvider, "driver" | "version">,
  t: TFunction = i18n.t,
): string {
  const providerName = PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver;
  return provider.version
    ? t("providerUpdate.provider.updated-version", {
        provider: providerName,
        version: formatVersion(provider.version),
      })
    : t("providerUpdate.provider.updated", { provider: providerName });
}

function getProviderUpdatedDescription(providerCount: number, t: TFunction): string {
  return t("providerUpdate.future-sessions", { count: providerCount });
}

function getProviderFailedUpdateTitle(
  provider: Pick<ServerProvider, "driver" | "versionAdvisory">,
  t: TFunction = i18n.t,
): string {
  const providerName = PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver;
  const attemptedVersion = provider.versionAdvisory?.latestVersion;
  return attemptedVersion
    ? t("providerUpdate.provider.failed-version", {
        provider: providerName,
        version: formatVersion(attemptedVersion),
      })
    : t("providerUpdate.provider.failed", { provider: providerName });
}

export function isProviderUpdateCandidate(
  provider: ServerProvider,
): provider is ProviderUpdateCandidate {
  return (
    provider.enabled &&
    provider.compatibilityAdvisory?.latestVersionStatus !== "broken" &&
    provider.compatibilityAdvisory?.latestVersionStatus !== "unsupported" &&
    provider.versionAdvisory?.status === "behind_latest" &&
    provider.versionAdvisory.latestVersion !== null
  );
}

export function isProviderUpdateActive(provider: Pick<ServerProvider, "updateState">): boolean {
  return provider.updateState?.status === "queued" || provider.updateState?.status === "running";
}

export function collectProviderUpdateCandidates(
  providers: ReadonlyArray<ServerProvider>,
): ProviderUpdateCandidate[] {
  return dedupeProvidersByDriver(providers.filter(isProviderUpdateCandidate));
}

export function isProviderSettingsUpdateCandidate(
  provider: ServerProvider,
): provider is ProviderSettingsUpdateCandidate {
  return (
    provider.enabled &&
    provider.compatibilityAdvisory?.latestVersionStatus !== "broken" &&
    provider.compatibilityAdvisory?.latestVersionStatus !== "unsupported" &&
    provider.versionAdvisory?.status === "behind_latest" &&
    provider.versionAdvisory.canUpdate === true &&
    provider.versionAdvisory.updateCommand !== null
  );
}

export function hasOneClickUpdateProviderCandidate(
  candidate: ProviderUpdateCandidate,
  providers: ReadonlyArray<ServerProvider>,
): boolean {
  if (
    candidate.versionAdvisory.canUpdate !== true ||
    candidate.versionAdvisory.updateCommand === null
  ) {
    return false;
  }

  const driverProviders = providers.filter((provider) => provider.driver === candidate.driver);
  if (driverProviders.length === 0) {
    return false;
  }

  const updateCommands = new Set<string>();
  for (const provider of driverProviders) {
    if (!isProviderUpdateCandidate(provider)) {
      continue;
    }
    const advisory = provider.versionAdvisory;
    if (!advisory || advisory.canUpdate !== true || advisory.updateCommand === null) {
      return false;
    }
    updateCommands.add(advisory.updateCommand);
  }

  return updateCommands.size === 1;
}

export function canOneClickUpdateProviderCandidate(
  candidate: ProviderUpdateCandidate,
  providers: ReadonlyArray<ServerProvider>,
): boolean {
  return (
    !isProviderUpdateActive(candidate) && hasOneClickUpdateProviderCandidate(candidate, providers)
  );
}

function formatProviderList(
  providers: ReadonlyArray<Pick<ServerProvider, "driver">>,
  t: TFunction = i18n.t,
) {
  const names = providers.map(
    (provider) => PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver,
  );
  if (names.length <= 2) {
    return names.join(t("providerUpdate.list.pair-separator"));
  }
  return t("providerUpdate.list.many", {
    first: names.slice(0, -1).join(t("providerUpdate.list.separator")),
    last: names[names.length - 1],
  });
}

export interface ProviderUpdateRun {
  readonly environmentId: EnvironmentId;
  readonly machineLabel: string;
  readonly driver: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly result: AtomCommandResult<
    { readonly providers: ReadonlyArray<ServerProvider> },
    unknown
  >;
}

export function getProviderUpdateRunOutcome(
  run: ProviderUpdateRun,
):
  | { readonly status: "interrupted" | "updated" }
  | { readonly status: "failed"; readonly line: string } {
  if (isAtomCommandInterrupted(run.result)) return { status: "interrupted" };
  const label = `${run.machineLabel} · ${PROVIDER_DISPLAY_NAMES[run.driver] ?? run.driver}`;
  if (run.result._tag === "Failure") {
    const error = squashAtomCommandFailure(run.result);
    return {
      status: "failed",
      line: `${label}: ${error instanceof Error ? error.message : "Provider update failed."}`,
    };
  }
  const updateState = run.result.value.providers.find(
    (provider) => provider.instanceId === run.instanceId,
  )?.updateState;
  return updateState?.status === "succeeded"
    ? { status: "updated" }
    : {
        status: "failed",
        line: `${label}: ${updateState?.message ?? "Provider update did not finish."}`,
      };
}

export function getProviderUpdateRunToastView(
  runs: ReadonlyArray<ProviderUpdateRun>,
  t: TFunction = i18n.t,
): { type: "success" | "error"; title: string; description: string } | null {
  const settled = runs
    .map(getProviderUpdateRunOutcome)
    .filter((outcome) => outcome.status !== "interrupted");
  if (settled.length === 0) {
    return null;
  }
  const failureLines = settled.flatMap((outcome) =>
    outcome.status === "failed" ? [outcome.line] : [],
  );
  if (failureLines.length === 0) {
    return {
      type: "success",
      title:
        settled.length === 1
          ? t("providerUpdate.succeeded.title", { count: 1 })
          : t("providerUpdate.succeeded.count", { count: settled.length }),
      description: getProviderUpdatedDescription(settled.length, t),
    };
  }
  return {
    type: "error",
    title:
      failureLines.length < settled.length
        ? t("providerUpdate.failed.partial", { failed: failureLines.length, count: settled.length })
        : t("providerUpdate.failed.title", { count: settled.length }),
    description: failureLines.join("\n"),
  };
}

function getUpdateFinishedAt(provider: ServerProvider): string | null {
  return provider.updateState?.finishedAt ?? null;
}

function isRecentTerminalProvider(
  provider: ServerProvider,
  visibleAfterIso: string | undefined,
): boolean {
  const status = provider.updateState?.status;
  if (status !== "failed" && status !== "unchanged" && status !== "succeeded") {
    return false;
  }
  if (visibleAfterIso === undefined) {
    return true;
  }
  const finishedAt = getUpdateFinishedAt(provider);
  return finishedAt !== null && finishedAt >= visibleAfterIso;
}

function latestFinishedAtForProviders(providers: ReadonlyArray<ServerProvider>): string | null {
  return providers.reduce<string | null>((latest, provider) => {
    const finishedAt = getUpdateFinishedAt(provider);
    if (finishedAt === null) {
      return latest;
    }
    return latest === null || finishedAt > latest ? finishedAt : latest;
  }, null);
}

/**
 * Collapses terminal update states to the most recently finished instance per
 * driver, so an update on a non-default instance is not hidden behind an
 * older outcome on the driver's default instance.
 */
function latestTerminalProvidersByDriver(providers: ReadonlyArray<ServerProvider>) {
  const latestProviderByDriver = new Map<ProviderDriverKind, ServerProvider>();

  for (const provider of providers) {
    const current = latestProviderByDriver.get(provider.driver);
    if (!current || (getUpdateFinishedAt(provider) ?? "") >= (getUpdateFinishedAt(current) ?? "")) {
      latestProviderByDriver.set(provider.driver, provider);
    }
  }

  return [...latestProviderByDriver.values()];
}

export function getProviderUpdateSidebarPillView(
  providers: ReadonlyArray<ServerProvider>,
  t: TFunction = i18n.t,
  options?: ProviderUpdateSidebarPillOptions,
): ProviderUpdateSidebarPillView | null {
  // Update state is recorded per instance, so pick the instances with an
  // update before collapsing to one entry per driver.
  const activeProviders = dedupeProvidersByDriver(providers.filter(isProviderUpdateActive));
  if (activeProviders.length > 0) {
    const activeProvider = activeProviders[0]!;
    const activeProviderName =
      PROVIDER_DISPLAY_NAMES[activeProvider.driver] ?? activeProvider.driver;
    return {
      key: `loading:${activeProviders
        .map((provider) => `${provider.driver}:${provider.updateState?.status ?? "idle"}`)
        .toSorted()
        .join("|")}`,
      tone: "loading",
      title:
        activeProviders.length === 1
          ? t("providerUpdate.pill.running-provider", { provider: activeProviderName })
          : t("providerUpdate.pill.running-count", { count: activeProviders.length }),
      description: t("providerUpdate.pill.running-description", {
        count: activeProviders.length,
        providers: formatProviderList(activeProviders, t),
      }),
    };
  }

  const recentTerminalProviders = latestTerminalProvidersByDriver(
    providers.filter((provider) => isRecentTerminalProvider(provider, options?.visibleAfterIso)),
  );
  const terminalCandidates: ProviderUpdateSidebarPillView[] = [];

  const failedProviders = recentTerminalProviders.filter(
    (provider) => provider.updateState?.status === "failed",
  );
  if (failedProviders.length > 0) {
    const failedProvider = failedProviders[0]!;
    terminalCandidates.push({
      key: `failed:${failedProviders
        .map(
          (provider) =>
            `${provider.driver}:${provider.updateState?.finishedAt ?? "pending"}:${provider.updateState?.message ?? ""}`,
        )
        .toSorted()
        .join("|")}`,
      tone: "error",
      title:
        failedProviders.length === 1
          ? getProviderFailedUpdateTitle(failedProvider, t)
          : t("providerUpdate.pill.failed-count", { count: failedProviders.length }),
      description: getFailedProviderUpdateDescription(failedProviders, t),
      dismissible: true,
    });
  }

  const unchangedProviders = recentTerminalProviders.filter(
    (provider) => provider.updateState?.status === "unchanged",
  );
  if (unchangedProviders.length > 0) {
    const unchangedProvider = unchangedProviders[0]!;
    const unchangedProviderName =
      PROVIDER_DISPLAY_NAMES[unchangedProvider.driver] ?? unchangedProvider.driver;
    terminalCandidates.push({
      key: `unchanged:${unchangedProviders
        .map(
          (provider) =>
            `${provider.driver}:${provider.updateState?.finishedAt ?? "pending"}:${provider.updateState?.message ?? ""}`,
        )
        .toSorted()
        .join("|")}`,
      tone: "warning",
      title:
        unchangedProviders.length === 1
          ? t("providerUpdate.pill.unchanged-provider", { provider: unchangedProviderName })
          : t("providerUpdate.pill.unchanged-count", { count: unchangedProviders.length }),
      description: t("providerUpdate.pill.unchanged-description", {
        count: unchangedProviders.length,
        providers: formatProviderList(unchangedProviders, t),
      }),
      dismissible: true,
    });
  }

  const succeededProviders = recentTerminalProviders.filter(
    (provider) => provider.updateState?.status === "succeeded",
  );
  if (succeededProviders.length > 0) {
    const succeededProvider = succeededProviders[0]!;
    terminalCandidates.push({
      key: `succeeded:${succeededProviders
        .map(
          (provider) =>
            `${provider.driver}:${provider.updateState?.finishedAt ?? "pending"}:${provider.updateState?.message ?? ""}`,
        )
        .toSorted()
        .join("|")}`,
      tone: "success",
      title:
        succeededProviders.length === 1
          ? getProviderUpdatedTitle(succeededProvider, t)
          : t("providerUpdate.succeeded.count", { count: succeededProviders.length }),
      description: getProviderUpdatedDescription(succeededProviders.length, t),
      dismissAfterVisibleMs: PROVIDER_UPDATE_SUCCESS_VISIBLE_MS,
    });
  }

  return (
    terminalCandidates
      .toSorted((left, right) => {
        const leftProviders =
          left.tone === "error"
            ? failedProviders
            : left.tone === "warning"
              ? unchangedProviders
              : succeededProviders;
        const rightProviders =
          right.tone === "error"
            ? failedProviders
            : right.tone === "warning"
              ? unchangedProviders
              : succeededProviders;
        const leftFinishedAt = latestFinishedAtForProviders(leftProviders) ?? "";
        const rightFinishedAt = latestFinishedAtForProviders(rightProviders) ?? "";
        return rightFinishedAt.localeCompare(leftFinishedAt);
      })
      .find((candidate) => !options?.dismissedKeys?.has(candidate.key)) ?? null
  );
}

function getFailedProviderUpdateDescription(
  providers: ReadonlyArray<ServerProvider>,
  t: TFunction = i18n.t,
): string {
  if (providers.length === 1) {
    const provider = providers[0]!;
    if (provider.updateState?.message) {
      return formatProviderUpdateMessage(provider.updateState.message, t);
    }
  }
  return t("providerUpdate.failed.description", { providers: formatProviderList(providers, t) });
}

const PROVIDER_UPDATE_MESSAGE_KEYS = {
  "This connection cannot manage provider accounts.": "providerUpdate.access.denied",
  "This connection cannot manage provider accounts. View provider settings for update details.":
    "providerUpdate.access.details",
  "Provider update failed.": "providerUpdate.error.generic",
  "Provider update did not finish.": "providerUpdate.error.unfinished",
  "Update timed out — try again.": "providerUpdate.error.timeout-retry",
  "This environment isn’t connected — try again once it reconnects.":
    "providerUpdate.error.disconnected",
  "Waiting for another provider update to finish.": "providerUpdate.message.waiting",
  "Checking for the latest version": "providerUpdate.message.checking",
  "Verifying the installed version": "providerUpdate.message.verifying",
  "Provider installation changed. Refresh and try again.": "providerUpdate.message.changed",
  "This version is no longer recommended or this installer cannot install a specific version. Refresh provider settings.":
    "providerUpdate.message.target-unavailable",
  "The latest provider version is incompatible with this T3 Code release. Review provider settings.":
    "providerUpdate.message.incompatible",
  "Update timed out.": "providerUpdate.message.timeout",
  "Update command failed.": "providerUpdate.message.command-failed",
  "Update command failed to run.": "providerUpdate.message.command-not-run",
  "Update command completed, but T3 Code could not verify the provider version.":
    "providerUpdate.message.unverified",
  "Update command completed, but T3 Code still detects an outdated provider version.":
    "providerUpdate.message.outdated",
  "Provider updated.": "providerUpdate.message.updated",
} as const;

function formatProviderUpdateMessage(message: string, t: TFunction): string {
  const key = PROVIDER_UPDATE_MESSAGE_KEYS[message as keyof typeof PROVIDER_UPDATE_MESSAGE_KEYS];
  if (key) return t(key);
  const exit = /^Update command exited with code (-?\d+)\.$/.exec(message);
  return exit ? t("providerUpdate.message.exit-code", { code: exit[1] }) : message;
}
