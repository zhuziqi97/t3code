import type { TFunction } from "i18next";
import type { MessageKey } from "@t3tools/client-runtime/i18n";

// These messages come from our desktop bridge. Unknown native/CLI diagnostics stay verbatim.
const messages: Readonly<Record<string, MessageKey>> = {
  "Try again.": "snapshots.native.retry",
  "Restart T3 Code to finish capture setup.": "snapshots.native.restart",
  "Could not start shortcut recording.": "snapshots.native.recording",
  "Add a letter, number, or function key to your shortcut.": "snapshots.native.modifier-key",
  "Could not check this shortcut.": "snapshots.native.check-shortcut",
  "SnapShots are not supported on this platform.": "snapshots.native.unsupported",
  "SnapShots require a Wayland session. X11 capture is not supported.": "snapshots.native.wayland",
  "Modifier-pair shortcuts aren't available in this Wayland session. Choose another shortcut or use Take snapshot from the command palette.":
    "snapshots.native.modifier-pair",
  "Allow Screen Recording in System Settings, then restart T3 Code.": "snapshots.native.mac-screen",
  "Allow Accessibility in System Settings, then restart T3 Code.":
    "snapshots.native.mac-accessibility",
  "Allow Accessibility and Screen Recording in System Settings, then restart T3 Code.":
    "snapshots.native.mac-both",
  "Configure the capture shortcut in your Niri config, not in T3 Code.":
    "snapshots.native.niri-config",
  "Change the capture binding in your Hyprland config, then save it.":
    "snapshots.native.hypr-config",
  "Your desktop will confirm this shortcut when you save it.": "snapshots.native.desktop-confirm",
  "Unsupported shortcut.": "snapshots.native.shortcut-unsupported",
  "The Niri capture endpoint disconnected. Restart T3 Code.": "snapshots.native.niri-disconnected",
  "Set up the shortcut to add it to your Niri config.": "snapshots.native.niri-setup",
  "Could not start the Niri capture endpoint. Another T3 Code instance may be using it.":
    "snapshots.native.niri-owned",
  "Could not connect to your desktop's shortcut service.": "snapshots.native.desktop-connect",
  "The system could not register this shortcut.": "snapshots.native.register",
  "This shortcut is already used by the system or another app.": "snapshots.native.conflict",
  "Shift combinations are used for typing and text selection. Add another modifier.":
    "snapshots.native.shift-conflict",
  "This shortcut controls running commands in terminals.": "snapshots.native.terminal-conflict",
  "The system uses Alt+Tab to switch apps.": "snapshots.native.alt-tab",
  "The system already uses this shortcut.": "snapshots.native.system-conflict",
  "Choose a config file smaller than 1 MB.": "snapshots.native.config-size",
  "Choose a text config file.": "snapshots.native.config-text",
  "Niri couldn't validate the proposed config. Nothing was changed. Check your config in Advanced.":
    "snapshots.native.config-niri-validation",
  "Hyprland reported config errors.": "snapshots.native.config-hypr-validation",
  "Couldn't check Hyprland's current shortcuts. Try again from your Hyprland session.":
    "snapshots.native.config-hypr-check",
  "Wait for the current config change to finish.": "snapshots.native.config-wait",
  "Couldn't read your settings file. Choose a different file in Advanced.":
    "snapshots.native.config-read",
  "Choose your own config, not system or Omarchy defaults.": "snapshots.native.config-user",
  "Choose a .kdl Niri config or a .conf/.lua Hyprland config.": "snapshots.native.config-format",
  "This config has too many included files. Use manual setup in Advanced.":
    "snapshots.native.config-includes",
  "This config uses a dynamic include. Use manual setup in Advanced.":
    "snapshots.native.config-dynamic",
  "Couldn't read an included Niri config. Check its location in Advanced.":
    "snapshots.native.config-include-read",
  "This preview expired. Review changes again before saving.": "snapshots.native.config-expired",
  "Your config changed since this preview. Review changes again before saving.":
    "snapshots.native.config-changed",
  "Your config changed since this preview. Nothing was saved. Review changes again before saving.":
    "snapshots.native.config-unsaved",
  "Config saved, but Hyprland couldn't reload it cleanly. Check hyprctl configerrors, then run hyprctl reload.":
    "snapshots.native.config-warning",
  "Choose a letter, number, or function key with Ctrl, Alt, or Super.":
    "snapshots.native.config-invalid-keys",
  "This Niri config has an unexpected binds section. Check it in Advanced.":
    "snapshots.native.config-niri-binds",
  "Couldn't resolve a Niri include. Choose the config in Advanced.":
    "snapshots.native.config-resolve",
  "Install the bundled helper to capture the window you're using without a picker.":
    "snapshots.native.helper-install",
  "Install the bundled helper to capture the window you're using.":
    "snapshots.native.helper-install-hypr",
  "The capture helper is missing from this build. Update or reinstall T3 Code.":
    "snapshots.native.helper-missing",
  "The Hyprland capture helper is missing from this build. Update or reinstall T3 Code.":
    "snapshots.native.helper-hypr-missing",
  "Update the bundled capture helper to continue.": "snapshots.native.helper-update",
  "KDE capture access is ready. Next, choose your shortcut.": "snapshots.native.kde-ready",
  "Helper ready. Hyprland may ask for screen-sharing permission on your first capture.":
    "snapshots.native.hypr-ready",
  "Couldn't check KDE capture access.": "snapshots.native.kde-check",
  "Couldn't check Hyprland capture access.": "snapshots.native.hypr-check",
  "Install the bundled extension to capture the active window without a picker. No download or administrator password is needed.":
    "snapshots.native.gnome-install",
  "Installed. Save your work, sign out of GNOME and sign back in, then return here to enable the extension. Restarting T3 Code alone is not enough.":
    "snapshots.native.gnome-login",
  "A newer extension is bundled with this app. Install it, then sign out and back in to load the update.":
    "snapshots.native.gnome-update",
  "GNOME has disabled user extensions. Turn on Extensions in the GNOME Extensions app, then check again. T3 Code will not enable your other extensions for you.":
    "snapshots.native.gnome-disabled",
  "The T3 Code extension is running. Active-window snapshots are available.":
    "snapshots.native.gnome-ready",
  "GNOME could not load the extension. Check GNOME Extensions for details, or sign out and back in.":
    "snapshots.native.gnome-error",
  "Enable the T3 Code extension to allow active-window snapshots. You can disable it here at any time.":
    "snapshots.native.gnome-enable",
  "Could not check GNOME extension setup.": "snapshots.native.gnome-check",
  "This shortcut is Select All in most apps.": "snapshots.native.common-all",
  "This shortcut is Copy in most apps.": "snapshots.native.common-copy",
  "This shortcut is Find in most apps.": "snapshots.native.common-find",
  "This shortcut is New in most apps.": "snapshots.native.common-new",
  "This shortcut is Open in most apps.": "snapshots.native.common-open",
  "This shortcut is Print in most apps.": "snapshots.native.common-print",
  "This shortcut is Quit in most apps.": "snapshots.native.common-quit",
  "This shortcut is Save in most apps.": "snapshots.native.common-save",
  "This shortcut is New Tab in most apps.": "snapshots.native.common-tab",
  "This shortcut is Paste in most apps.": "snapshots.native.common-paste",
  "This shortcut is Close Window in most apps.": "snapshots.native.common-close",
  "This shortcut is Cut in most apps.": "snapshots.native.common-cut",
  "This shortcut is Undo in most apps.": "snapshots.native.common-undo",
};
export function formatSnapShotMessage(message: string, t: TFunction): string {
  const key = messages[message];
  if (key) return t(key);
  const gnome = /^The bundled extension supports GNOME (.+)\. This session runs GNOME (.+)\.$/.exec(
    message,
  );
  if (gnome) return t("snapshots.native.gnome-version", { supported: gnome[1], current: gnome[2] });
  const conflict = /^(.+) is already used in (.+)\. Choose another shortcut\.$/.exec(message);
  if (conflict)
    return conflict[2] === "this config"
      ? t("snapshots.native.local-conflict", { shortcut: conflict[1] })
      : t("snapshots.native.config-conflict", { shortcut: conflict[1], path: conflict[2] });
  const hyprland = /^(.+) is already used by Hyprland\. Choose another shortcut\.$/.exec(message);
  if (hyprland) return t("snapshots.native.hypr-conflict", { shortcut: hyprland[1] });
  const pair = /^((Shift|Ctrl|Control|Option|Alt|Command|Super) \+ \2) is (.+)$/.exec(message);
  if (pair) {
    const description = pair[3];
    if (description === "not available on this system.")
      return t("snapshots.native.pair-unavailable", { shortcut: pair[1] });
    if (description === "observed and cannot be reserved exclusively.")
      return t("snapshots.native.pair-observed", { shortcut: pair[1] });
    if (
      description ===
      "observed and cannot be reserved exclusively. This key can also open the system's own menu."
    )
      return t("snapshots.native.pair-system", { shortcut: pair[1] });
    if (
      description ===
      "observed and cannot be reserved exclusively. This key can also activate app menu bars."
    )
      return t("snapshots.native.pair-menu", { shortcut: pair[1] });
  }
  return message;
}
