import { formatDesktopUpdateMessage } from "@t3tools/client-runtime/i18n";
import type { TFunction } from "i18next";
import { i18n } from "../i18n";
import type { DesktopUpdateActionResult, DesktopUpdateState } from "@t3tools/contracts";

export type DesktopUpdateButtonAction = "download" | "install" | "none";

const DESKTOP_RELEASE_HISTORY_URL = "https://github.com/pingdotgg/t3code/releases";
const DESKTOP_RELEASE_TAG_URL = `${DESKTOP_RELEASE_HISTORY_URL}/tag`;

/**
 * The main process fills `downloadedVersion` from the updater's `update-downloaded`
 * event, which is dispatched on its own fiber. A download RPC can therefore resolve
 * before that write lands, so fall back to the version the download was started for.
 */
export function getDesktopUpdateDownloadedVersion(state: DesktopUpdateState): string | null {
  return state.downloadedVersion ?? state.availableVersion;
}

/** Release notes for an exact downloaded build; nightly suffixes are part of the tag. */
export function getDesktopUpdateReleaseUrl(version: string | null): string | null {
  const normalizedVersion = version?.trim();
  if (!normalizedVersion) return null;
  return `${DESKTOP_RELEASE_TAG_URL}/v${encodeURIComponent(normalizedVersion)}`;
}

export function getDesktopUpdateReleaseHistoryUrl(): string {
  return DESKTOP_RELEASE_HISTORY_URL;
}

export function resolveDesktopUpdateButtonAction(
  state: DesktopUpdateState,
): DesktopUpdateButtonAction {
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
): string {
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
    return (state.downloadedVersion ?? state.availableVersion)
      ? translate("update.downloadedVersion", {
          version: state.downloadedVersion ?? state.availableVersion,
        })
      : translate("update.downloaded");
  }
  if (state.status === "error") {
    if (state.errorContext === "download" && state.availableVersion) {
      return translate("update.downloadFailed", { version: state.availableVersion });
    }
    if (state.errorContext === "install" && state.downloadedVersion) {
      return translate("update.installFailed", { version: state.downloadedVersion });
    }
    if (state.downloadedVersion) {
      return translate("update.downloadedVersion", { version: state.downloadedVersion });
    }
    return state.message === null
      ? translate("update.failed")
      : formatDesktopUpdateMessage(state.message, translate);
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

export function shouldToastDesktopUpdateActionResult(result: DesktopUpdateActionResult): boolean {
  return getDesktopUpdateActionError(result) !== null;
}

export function canCheckForUpdate(state: DesktopUpdateState | null): boolean {
  if (!state || !state.enabled) return false;
  return (
    state.status !== "checking" && state.status !== "downloading" && state.status !== "disabled"
  );
}
