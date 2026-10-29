import type { TFunction } from "i18next";
import { i18n } from "../i18n";
import type { EnvironmentId } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import {
  pickSnoozePreset as pickSharedSnoozePreset,
  resolveSnoozePresets as resolveSharedSnoozePresets,
  snoozeWakeLabel as sharedSnoozeWakeLabel,
  type SnoozePreset,
} from "@t3tools/client-runtime/state/thread-settled";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { serverEnvironment } from "../state/server";
import { parseTimestampDate, formatShortTimestamp } from "../timestampFormat";
import { toastManager } from "./ui/toast";

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

/** The snooze menu for a thread, from its environment's presets, read when the menu opens. */
export function resolveSnoozePresets(
  now: Date,
  timestampFormat: TimestampFormat,
  environmentId: EnvironmentId,
  t: TFunction = i18n.t,
): ReadonlyArray<SnoozePreset> {
  return resolveSharedSnoozePresets(now, snoozeOptions(timestampFormat, environmentId)).map(
    (preset) => ({
      ...preset,
      label: i18n.exists(`thread.snooze.preset.${preset.id}`)
        ? t(`thread.snooze.preset.${preset.id}`)
        : preset.label,
    }),
  );
}

/** A shown menu choice as picked; see the shared `pickSnoozePreset`. */
export function pickSnoozePreset(
  shown: ReadonlyArray<SnoozePreset>,
  id: string,
  timestampFormat: TimestampFormat,
  environmentId: EnvironmentId,
): SnoozePreset | undefined {
  const picked = pickSharedSnoozePreset({
    shown,
    id,
    now: new Date(),
    ...snoozeOptions(timestampFormat, environmentId),
  });
  if (!picked) {
    toastManager.add({
      type: "warning",
      title: "Could not snooze thread",
      description: "That snooze time has passed. Choose another time.",
    });
  }
  return picked;
}

function snoozeOptions(timestampFormat: TimestampFormat, environmentId: EnvironmentId) {
  const presets = appAtomRegistry.get(
    serverEnvironment.settingsValueAtom(environmentId),
  )?.snoozePresets;
  return {
    ...(presets ? { presets } : {}),
    formatTime: (date: Date) => formatShortTimestamp(date.toISOString(), timestampFormat),
  };
}

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
