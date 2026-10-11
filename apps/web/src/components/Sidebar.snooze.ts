import type { TFunction } from "i18next";
import { i18n } from "../i18n";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import {
  resolveSnoozePresets as resolveSharedSnoozePresets,
  snoozeWakeLabel as sharedSnoozeWakeLabel,
  type SnoozePreset,
} from "@t3tools/client-runtime/state/thread-settled";

import { formatShortTimestamp, parseTimestampDate } from "../timestampFormat";

export { type SnoozePreset };

export function snoozeWakeLabel(
  snoozedUntil: string,
  options: { readonly now: string },
  t: TFunction = i18n.t,
): string {
  const label = sharedSnoozeWakeLabel(snoozedUntil, options);
  if (label === "now") return t("time.compact.now");
  const match = /^(\d+)([mhd])$/.exec(label);
  if (!match) return label;
  const keys: Record<string, string> = {
    m: "time.compact.minutes",
    h: "time.compact.hours",
    d: "time.compact.days",
  };
  return t(keys[match[2]!]!, { count: Number(match[1]) });
}

const DAY_MS = 24 * 60 * 60 * 1_000;

function timeOfDayLabel(date: Date, timestampFormat: TimestampFormat, t: TFunction): string {
  return formatShortTimestamp(date.toISOString(), timestampFormat, t);
}

export function resolveSnoozePresets(
  now: Date,
  timestampFormat: TimestampFormat,
  t: TFunction = i18n.t,
): ReadonlyArray<SnoozePreset> {
  return resolveSharedSnoozePresets(now).map((preset) => {
    const wake = parseTimestampDate(preset.snoozedUntil);
    if (wake === null) return preset;
    const time = timeOfDayLabel(wake, timestampFormat, t);
    return {
      ...preset,
      label: t(`thread.snooze.preset.${preset.id}`),
      whenLabel:
        preset.id === "next-week"
          ? `${wake.toLocaleDateString(i18n.resolvedLanguage === "zh" ? "zh-CN" : undefined, { weekday: "short" })} ${time}`
          : time,
    };
  });
}

/**
 * Human wake time for menus and toasts: "tomorrow 9:00", "Mon 9:00",
 * "17:30" (today).
 */
export function snoozeWakeDescription(
  snoozedUntil: string,
  now: Date,
  timestampFormat: TimestampFormat,
  t: TFunction = i18n.t,
): string {
  const wake = parseTimestampDate(snoozedUntil);
  if (wake === null) return "";
  const time = timeOfDayLabel(wake, timestampFormat, t);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const dayDelta = Math.floor((wake.getTime() - startOfToday.getTime()) / DAY_MS);
  if (dayDelta === 0) return time;
  if (dayDelta === 1) return t("thread.snooze.tomorrow", { time });
  const weekday = wake.toLocaleDateString(i18n.resolvedLanguage === "zh" ? "zh-CN" : undefined, {
    weekday: "short",
  });
  if (dayDelta < 7) return `${weekday} ${time}`;
  const date = wake.toLocaleDateString(i18n.resolvedLanguage === "zh" ? "zh-CN" : undefined, {
    month: "short",
    day: "numeric",
  });
  return `${date}, ${time}`;
}
