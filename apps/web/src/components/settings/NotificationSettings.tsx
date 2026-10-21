import { useTranslate } from "../../i18n";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

import {
  hasDesktopNotifications,
  hasNotificationSound,
  NOTIFICATION_MODE_LABELS,
  unlockNotificationAudio,
} from "../../threadNotifications";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function NotificationSettings() {
  const t = useTranslate();
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const updateSettings = useUpdateScopedSettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  return (
    <SettingsRow
      {...searchableSetting("thread-notifications", t)}
      description={permissionMessage ? t(permissionMessage) : t("notifications.description")}
      control={
        <Select
          value={mode}
          disabled={requesting}
          onValueChange={async (value) => {
            if (
              value !== "off" &&
              value !== "notifications" &&
              value !== "sound" &&
              value !== "notifications-and-sound"
            )
              return;
            setPermissionMessage(null);
            if (hasNotificationSound(value)) unlockNotificationAudio();
            if (hasDesktopNotifications(value)) {
              if (typeof Notification === "undefined" || !window.isSecureContext) {
                setPermissionMessage("notifications.unsupported");
                return;
              }
              setRequesting(true);
              const permission = await settlePromise(() => Notification.requestPermission());
              setRequesting(false);
              if (permission._tag === "Failure") {
                setPermissionMessage(
                  "Notifications are unavailable in this browser. Sound only is still available.",
                );
                return;
              }
              if (permission.value !== "granted") {
                setPermissionMessage(
                  "Allow notifications in your browser or system settings, then choose this option again. Sound only is still available.",
                );
                return;
              }
            }
            updateSettings({ notificationMode: value });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label={t("notifications.label")}>
            <SelectValue>{t(`options.notifications.${mode}`)}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {Object.entries(NOTIFICATION_MODE_LABELS).map(([value]) => (
              <SelectItem key={value} hideIndicator value={value}>
                {t(`options.notifications.${value}`)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
