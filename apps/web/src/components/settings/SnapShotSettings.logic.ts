import { i18n } from "../../i18n";
import type { TFunction } from "i18next";
import { formatSnapShotMessage } from "./snapShotMessages";
import type { ClientSettingsPatch, DesktopSnapShotState, SnapShotSound } from "@t3tools/contracts";
import {
  captureSetupBackend,
  captureSetupDesktopName,
  captureSetupAccessReady,
  captureSetupMacPermissionsReady,
} from "./SnapShotSetupDialog.logic";

export function snapShotStatus(
  state: DesktopSnapShotState | null,
  enabled: boolean,
  t: TFunction = i18n.t,
): string {
  if (!state) return t("snapshots.status.checking");
  if (state.mode === "unavailable")
    return state.message
      ? formatSnapShotMessage(state.message, t)
      : t("snapshots.status.unsupported");
  if (!enabled) return t("snapshots.status.enable");
  return snapShotSetupSummary(state, enabled, t);
}

export function snapShotSetupSummary(
  state: DesktopSnapShotState,
  enabled: boolean,
  t: TFunction = i18n.t,
): string {
  if (state.message) return t("snapshots.status.attention");
  if (state.linuxBackend === "hyprland" && state.hyprlandHelper?.status !== "ready")
    return state.hyprlandHelper?.status === "error"
      ? t("snapshots.status.check-access")
      : t("snapshots.status.install-helper");
  if (captureSetupBackend(state) === "gnome" && state.gnomeExtension?.status !== "enabled")
    return t("snapshots.status.active-window");
  if (captureSetupBackend(state) === "kde" && state.kdeHelper?.status !== "ready")
    return state.kdeHelper?.status === "error"
      ? t("snapshots.status.check-access")
      : t("snapshots.status.install-helper");
  if (captureSetupBackend(state) === "picker") return t("snapshots.status.manual");
  if (!enabled) return t("snapshots.status.enable-continue");
  if (state.shortcutPending)
    return state.linuxBackend === "hyprland"
      ? t("snapshots.status.connecting")
      : t("snapshots.status.waiting");
  if (state.shortcutVerified) return t("snapshots.status.ready");
  if (state.linuxBackend === "niri" && state.shortcutBinding)
    return t("snapshots.status.use-shortcut");
  if (state.linuxBackend === "hyprland" && state.shortcutActionRegistered)
    return t("snapshots.status.use-shortcut");
  if (state.shortcutRegistered)
    return state.shortcutLabel ? t("snapshots.status.ready") : t("snapshots.status.saved");
  return t("snapshots.status.finish");
}

export function snapShotShortcutStatus(
  state: DesktopSnapShotState | null,
  t: TFunction = i18n.t,
): string | null {
  if (!state) return null;
  if (state.linuxBackend === "hyprland")
    return state.shortcutMessage ? formatSnapShotMessage(state.shortcutMessage, t) : null;
  if (state.shortcutPending) return t("snapshots.shortcut.approve");
  if (state.shortcutRegistered)
    return state.mode === "portal" ? null : t("snapshots.shortcut.saved");
  return state.shortcutMessage ? formatSnapShotMessage(state.shortcutMessage, t) : null;
}

export function snapShotSetupButtonLabel(
  state: DesktopSnapShotState | null,
  t: TFunction = i18n.t,
): string {
  if (!state) return t("snapshots.setup.continue");
  if (captureSetupAccessReady(state)) return t("snapshots.setup.manage");
  const desktop = captureSetupDesktopName(state);
  return desktop ? t("snapshots.setup.desktop-action", { desktop }) : t("snapshots.setup.continue");
}

// Windows needs no permissions or setup: turning capture on is enough. macOS setup
// has nothing left to manage once permissions and the shortcut are in place; the
// shortcut row stays editable inline. Revoking a permission brings the button back
// as "Continue setup" through the state message.
export function snapShotSetupComplete(
  state: DesktopSnapShotState | null,
  includeAccessibility: boolean,
): boolean {
  if (state?.windows) return true;
  return (
    state?.macPermissions !== undefined &&
    captureSetupAccessReady(state) &&
    captureSetupMacPermissionsReady(state, includeAccessibility) &&
    state.shortcutRegistered
  );
}

export type SnapShotSoundSelection = SnapShotSound | "off";

export function snapShotFeedbackUnavailableMessage(
  state: DesktopSnapShotState | null,
  t: TFunction = i18n.t,
): string | undefined {
  if (state?.mode !== "portal" || state.linuxFeedbackAvailable) return undefined;
  if (state.linuxBackend === "hyprland")
    return state.hyprlandHelper?.status === "ready"
      ? t("snapshots.effects.unavailable")
      : t("snapshots.effects.helper");
  if (state.linuxBackend === "niri") return t("snapshots.effects.niri");
  if (state.linuxBackend === "kde")
    return state.kdeHelper?.status === "ready"
      ? t("snapshots.effects.unavailable")
      : t("snapshots.effects.helper");
  return state.linuxBackend === "gnome-extension"
    ? t("snapshots.effects.gnome-update")
    : captureSetupBackend(state) === "gnome"
      ? t("snapshots.effects.gnome-setup")
      : t("snapshots.effects.unavailable");
}

export function snapShotDescription(
  state: DesktopSnapShotState | null,
  t: TFunction = i18n.t,
): string {
  return state?.mode === "portal" && captureSetupBackend(state) === "picker"
    ? t("snapshots.description.picker")
    : t("snapshots.description");
}

export function snapShotAccessibilityUnavailableMessage(
  state: DesktopSnapShotState | null,
  t: TFunction = i18n.t,
): string | undefined {
  if (state?.mode !== "portal") return undefined;
  if (state.linuxBackend === "picker" || state.linuxBackend === "screenshot-portal")
    return t("snapshots.text.unavailable");
  return undefined;
}

export function snapShotUnavailableMessage(
  hasBridge: boolean,
  t: TFunction = i18n.t,
): string | undefined {
  if (hasBridge) return undefined;
  return typeof window !== "undefined" && window.desktopBridge
    ? t("snapshots.unavailable.update")
    : t("snapshots.unavailable.desktop");
}

export function snapShotSoundPatch(sound: SnapShotSoundSelection): ClientSettingsPatch {
  return sound === "off"
    ? { snapShotPlaySound: false }
    : { snapShotPlaySound: true, snapShotSound: sound };
}

export function createRecordingRequestTracker() {
  let currentRequest: symbol | null = null;

  return {
    tryBegin() {
      if (currentRequest) return null;
      currentRequest = Symbol();
      return currentRequest;
    },
    clear() {
      currentRequest = null;
    },
    owns(request: symbol) {
      return currentRequest === request;
    },
  };
}
