import type { TFunction } from "i18next";

/** Translate messages owned by the current desktop updater; native diagnostics stay verbatim. */
export function formatDesktopUpdateMessage(message: string, translate: TFunction): string {
  const fixed: Readonly<Record<string, string>> = {
    "Automatic updates are not available because no update feed is configured.":
      "update.disabled.feed",
    "Automatic updates are only available in packaged production builds.":
      "update.disabled.production",
    "Automatic updates are disabled by the T3CODE_DISABLE_AUTO_UPDATE setting.":
      "update.disabled.setting",
    "Automatic updates on Linux require the AppImage or the .deb package.": "update.disabled.linux",
  };
  if (fixed[message]) return translate(fixed[message]);
  const busy =
    /^Cannot change the desktop update channel to (latest|nightly) while an update (check|download|install|channel) action is in progress\.$/.exec(
      message,
    );
  if (busy)
    return translate("update.channel.busy", {
      channel: busy[1],
      action: translate(`update.action.${busy[2]}`),
    });
  const persistence = /^Failed to persist the (latest|nightly) desktop update channel\.$/.exec(
    message,
  );
  if (persistence) return translate("update.channel.persistFailed", { channel: persistence[1] });
  const operation =
    /^Desktop updater (check|download|install|channel|background) operation reported an error\.$/.exec(
      message,
    );
  if (operation)
    return translate("update.operation.failed", {
      operation: translate(`update.action.${operation[1]}`),
    });
  const action = /^Desktop update (download|install) action failed unexpectedly\.$/.exec(message);
  if (action)
    return translate("update.action.failed", { action: translate(`update.action.${action[1]}`) });
  return message;
}
