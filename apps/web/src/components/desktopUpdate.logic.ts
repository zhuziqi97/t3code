import { formatDesktopUpdateMessage } from "@t3tools/client-runtime/i18n";
import type { TFunction } from "i18next";
import { i18n } from "../i18n";
import { desktopTrackMismatchText } from "@t3tools/client-runtime/state/server";
import type {
  DesktopBridge,
  DesktopUpdateActionResult,
  DesktopUpdateState,
} from "@t3tools/contracts";
import { desktopUpdateChannelOf } from "@t3tools/shared/cliRelease";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../i18n/messages";

export type DesktopUpdateButtonAction = "download" | "open-download" | "install" | "none";

const DEFAULT_DESKTOP_RELEASE_REPOSITORY = "pingdotgg/t3code";
const GITHUB_REPOSITORY_SEGMENT = /^[A-Za-z0-9._-]+$/u;

function isValidRepositorySegment(value: string | undefined): value is string {
  return (
    value !== undefined && value !== "." && value !== ".." && GITHUB_REPOSITORY_SEGMENT.test(value)
  );
}

function desktopReleaseRepositoryUrl(repository: string | undefined): string {
  const configuredRepository = repository?.trim() ?? "";
  const [owner, name, ...extra] = configuredRepository.split("/");
  const releaseRepository =
    isValidRepositorySegment(owner) && isValidRepositorySegment(name) && extra.length === 0
      ? configuredRepository
      : DEFAULT_DESKTOP_RELEASE_REPOSITORY;
  return `https://github.com/${releaseRepository}/releases`;
}

/** The download RPC can beat the updater's downloadedVersion event; fall back to the requested version. */
export function getDesktopUpdateDownloadedVersion(state: DesktopUpdateState): string | null {
  return state.downloadedVersion ?? state.availableVersion;
}

/** Release notes for an exact downloaded build; nightly suffixes are part of the tag. */
export function getDesktopUpdateReleaseUrl(
  version: string | null,
  state?: DesktopUpdateState,
  repository: string | undefined = import.meta.env.T3CODE_DESKTOP_UPDATE_REPOSITORY,
): string | null {
  if (state?.convene) return state.convene.helpUrl;
  const normalizedVersion = version?.trim();
  if (!normalizedVersion) return null;
  return `${desktopReleaseRepositoryUrl(repository)}/tag/v${encodeURIComponent(normalizedVersion)}`;
}

export function getDesktopUpdateReleaseHistoryUrl(
  state?: DesktopUpdateState,
  repository: string | undefined = import.meta.env.T3CODE_DESKTOP_UPDATE_REPOSITORY,
): string | null {
  if (state?.convene)
    return state.convene.baseUrl
      ? `${state.convene.baseUrl.replace(/\/$/, "")}/downloads/versions`
      : null;
  return desktopReleaseRepositoryUrl(repository);
}

export function resolveDesktopUpdateButtonAction(
  state: DesktopUpdateState,
): DesktopUpdateButtonAction {
  if (state.convene) {
    return (state.status === "available" || state.errorContext === "download") &&
      (state.convene.downloadUrl !== null || state.convene.downloadsUrl !== null)
      ? "open-download"
      : "none";
  }
  if (
    state.downloadedVersion &&
    (state.status === "downloaded" ||
      (state.status === "error" &&
        (state.errorContext === null || state.errorContext === "install")))
  ) {
    return "install";
  }
  if (state.status === "available") {
    return "download";
  }
  if (state.status === "error") {
    if (state.errorContext === "download" && state.availableVersion) {
      return "download";
    }
  }
  return "none";
}

export function getDesktopUpdateNoticeIdentity(state: DesktopUpdateState | null): string | null {
  const release = state?.convene;
  if (
    !release?.baseUrl ||
    !state?.availableVersion ||
    (release.relation !== "newer" && release.relation !== "different-build")
  )
    return null;
  return JSON.stringify([release.baseUrl, state.availableVersion, release.releaseBuildId]);
}

export function claimDesktopUpdateNotice(
  state: DesktopUpdateState | null,
  notified: Set<string>,
): boolean {
  const identity = getDesktopUpdateNoticeIdentity(state);
  if (state?.status !== "available" || identity === null || notified.has(identity)) return false;
  notified.add(identity);
  return true;
}

export function shouldShowArm64IntelBuildWarning(state: DesktopUpdateState | null): boolean {
  return state?.hostArch === "arm64" && state.appArch === "x64";
}

export function isDesktopUpdateButtonDisabled(state: DesktopUpdateState | null): boolean {
  return state?.status === "downloading";
}

export function getArm64IntelBuildWarningDescription(
  state: DesktopUpdateState,
  translate: TFunction = i18n.t,
): string {
  if (!shouldShowArm64IntelBuildWarning(state)) {
    return translate("update.architecture.correct");
  }

  const action = resolveDesktopUpdateButtonAction(state);
  if (action === "download") {
    return translate("update.architecture.download");
  }
  if (action === "install") {
    return translate("update.architecture.install");
  }
  return translate("update.architecture.next");
}

export function getDesktopUpdateButtonTooltip(
  state: DesktopUpdateState,
  translate: TFunction = i18n.t,
  managedDenial?: string,
): string {
  if (managedDenial !== undefined) return managedDenial;
  if (state.convene) {
    if (state.status === "checking") return translate("update.checking");
    if (state.message) return formatDesktopUpdateMessage(state.message, translate);
    if (state.status === "up-to-date") return translate("update.platform.current");
    return state.availableVersion
      ? translate("update.availableVersion", { version: state.availableVersion })
      : translate("update.check");
  }
  if (
    state.notAppliedVersion !== undefined &&
    (state.status === "available" || state.status === "downloaded") &&
    getDesktopUpdateDownloadedVersion(state) === state.notAppliedVersion
  ) {
    return translate("update.notAppliedRetry", { version: state.notAppliedVersion });
  }
  if (
    (state.status === "available" || state.status === "error") &&
    state.errorContext === "download" &&
    state.availableVersion
  ) {
    return translate("update.downloadFailed", { version: state.availableVersion });
  }
  if (state.status === "available") {
    return state.availableVersion
      ? translate("update.availableVersion", { version: state.availableVersion })
      : translate("update.available");
  }
  if (state.status === "downloading") {
    const progress =
      typeof state.downloadPercent === "number" ? ` (${Math.floor(state.downloadPercent)}%)` : "";
    return translate("update.downloading", { progress });
  }
  if (state.status === "downloaded") {
    if (state.errorContext === "install" && state.downloadedVersion) {
      return m(
        msg("Install failed for {version}. Click to retry.", { version: state.downloadedVersion }),
      );
    }
    const version = state.downloadedVersion ?? state.availableVersion;
    return version === null
      ? m(msg("Update ready downloaded. Click to restart and install."))
      : m(msg("Update {version} downloaded. Click to restart and install.", { version }));
  }
  if (state.status === "error") {
    if (state.errorContext === "install" && state.downloadedVersion) {
      return translate("update.installFailed", { version: state.downloadedVersion });
    }
    if (state.downloadedVersion) {
      return translate("update.downloadedVersion", { version: state.downloadedVersion });
    }
    if (state.trackMismatch !== undefined) {
      return m(
        desktopTrackMismatchText({
          buildChannel: state.trackMismatch.buildChannel,
          savedChannel: state.channel,
        }),
      );
    }
    return state.message === null
      ? translate("update.failed")
      : formatDesktopUpdateMessage(state.message, translate);
  }
  const build = desktopUpdateChannelOf(state.currentVersion);
  if (state.status === "up-to-date" && build !== state.channel) {
    return m(
      msg(
        "This {build} build ignores {track} releases. Review the update track in Settings to finish the switch.",
        {
          build: translate(build === "nightly" ? "about.nightly" : "about.stable"),
          track: translate(state.channel === "nightly" ? "about.nightly" : "about.stable"),
        },
      ),
    );
  }
  return translate("update.current");
}

export function getDesktopUpdateInstallConfirmationMessage(
  state: Pick<DesktopUpdateState, "availableVersion" | "downloadedVersion">,
  translate: TFunction = i18n.t,
): string {
  const version = state.downloadedVersion ?? state.availableVersion;
  return version ? translate("update.confirmVersion", { version }) : translate("update.confirm");
}

export function getDesktopUpdateActionError(result: DesktopUpdateActionResult): string | null {
  if (!result.accepted || result.completed) return null;
  if (typeof result.state.message !== "string") return null;
  const message = result.state.message.trim();
  return message.length > 0 ? message : null;
}

/**
 * macOS can refuse the restart after installUpdate resolves; the desktop then reports it as a
 * later state with errorContext "install". Success quits the app, so this never resolves then.
 */
export async function installDesktopUpdate(
  bridge: Pick<DesktopBridge, "installUpdate" | "onUpdateState">,
  expectedVersion?: string,
): Promise<DesktopUpdateActionResult> {
  let awaitingFailure = false;
  let reportFailure: (state: DesktopUpdateState) => void = () => {};
  const failure = new Promise<DesktopUpdateState>((resolve) => {
    reportFailure = resolve;
  });
  const unsubscribe = bridge.onUpdateState((state) => {
    if (awaitingFailure && state.errorContext === "install") reportFailure(state);
  });
  try {
    const result = await bridge.installUpdate(expectedVersion);
    if (!result.accepted || result.completed || getDesktopUpdateActionError(result) !== null) {
      return result;
    }
    awaitingFailure = true;
    return { ...result, state: await failure };
  } finally {
    unsubscribe();
  }
}

export function shouldToastDesktopUpdateActionResult(result: DesktopUpdateActionResult): boolean {
  return getDesktopUpdateActionError(result) !== null;
}

export function canCheckForUpdate(state: DesktopUpdateState | null): boolean {
  if (!state || !state.enabled) return false;
  return (
    state.status !== "checking" && state.status !== "downloading" && state.status !== "disabled"
  );
}

/** `managedDenial` is this machine's policy refusing updates (`managedUpdatesDenial`); it wins. */
export function getDesktopUpdateDisabledReason(
  state: Pick<DesktopUpdateState, "enabled" | "status" | "message"> | null,
  translate: TFunction = i18n.t,
  managedDenial?: string,
  _resolve: MessageResolver = m,
): string | null {
  if (managedDenial !== undefined) return managedDenial;
  if (!state || (state.enabled && state.status !== "disabled")) return null;
  const message = state.message?.trim();
  return message
    ? formatDesktopUpdateMessage(message, translate)
    : translate("about.updateUnsupported");
}

export function getDesktopUpdateIdleTooltip(
  state: Pick<DesktopUpdateState, "enabled" | "status" | "message"> | null,
  translate: TFunction = i18n.t,
  managedDenial?: string,
  _resolve: MessageResolver = m,
) {
  const disabledReason = getDesktopUpdateDisabledReason(state, translate, managedDenial);
  return disabledReason
    ? { title: translate("update.unavailable"), detail: disabledReason }
    : { title: translate("update.check"), detail: null };
}
