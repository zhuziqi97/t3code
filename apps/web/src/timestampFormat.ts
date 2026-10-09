import type { TFunction } from "i18next";
import { i18n } from "./i18n";
import { type TimestampFormat } from "@t3tools/contracts/settings";

function getTimestampFormatOptions(
  timestampFormat: TimestampFormat,
  includeSeconds: boolean,
): Intl.DateTimeFormatOptions {
  const baseOptions: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
  };

  if (timestampFormat === "locale") {
    return baseOptions;
  }

  return {
    ...baseOptions,
    hour12: timestampFormat === "12-hour",
  };
}

/**
 * Pick the locale to format wall-clock times in, given the locale the host
 * reports. Hosts that report nothing fall back to `undefined`, which is the
 * runtime default and the right answer in a browser.
 *
 * A host reports a locale only when it knows better than the runtime does —
 * see `getSystemLocale` on the desktop bridge for why desktop does.
 */
export function resolveTimestampLocale(
  systemLocale: string | null | undefined,
): string | undefined {
  const tag = systemLocale?.trim();
  if (!tag) return undefined;

  try {
    // Every timestamp in the UI runs through this formatter, so a tag the host
    // could not normalize falls back rather than throwing. Throws on a
    // structurally invalid tag; a well-formed tag ICU has no data for resolves
    // here and is left to ICU's own fallback.
    Intl.DateTimeFormat.supportedLocalesOf([tag]);
    return tag;
  } catch {
    return undefined;
  }
}

function readHostSystemLocale(): string | null {
  if (typeof window === "undefined") return null;
  return window.desktopBridge?.getSystemLocale?.() ?? null;
}

const timestampLocale = resolveTimestampLocale(readHostSystemLocale());

const WEEKDAY_INDEXES = [0, 1, 2, 3, 4, 5, 6] as const;
type WeekdayIndex = (typeof WEEKDAY_INDEXES)[number];

type LocaleWithWeekInfo = Intl.Locale & {
  readonly weekInfo?: { readonly firstDay: number };
  getWeekInfo?: () => { readonly firstDay: number };
};

/**
 * First weekday of a locale as a `Date#getDay` index (0 is Sunday), or
 * `undefined` when the runtime has no week data, so callers keep their own
 * default. Without a locale it reads the runtime's.
 */
export function resolveWeekStartsOn(locale: string | undefined): WeekdayIndex | undefined {
  try {
    const resolved: LocaleWithWeekInfo = new Intl.Locale(
      locale ?? Intl.DateTimeFormat().resolvedOptions().locale,
    );
    // Week info counts Monday as 1 and Sunday as 7.
    const firstDay = resolved.getWeekInfo?.().firstDay ?? resolved.weekInfo?.firstDay;
    return firstDay === undefined ? undefined : WEEKDAY_INDEXES[firstDay % 7];
  } catch {
    return undefined;
  }
}

/** Week start for calendars, from the same locale timestamps are shown in. */
export const weekStartsOn = resolveWeekStartsOn(timestampLocale);

const timestampFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getTimestampFormatter(
  timestampFormat: TimestampFormat,
  includeSeconds: boolean,
): Intl.DateTimeFormat {
  const locale = i18n.resolvedLanguage === "zh" ? "zh-CN" : timestampLocale;
  const cacheKey = `${locale}:${timestampFormat}:${includeSeconds ? "seconds" : "minutes"}`;
  const cachedFormatter = timestampFormatterCache.get(cacheKey);
  if (cachedFormatter) {
    return cachedFormatter;
  }

  const formatter = new Intl.DateTimeFormat(
    locale,
    getTimestampFormatOptions(timestampFormat, includeSeconds),
  );
  timestampFormatterCache.set(cacheKey, formatter);
  return formatter;
}

export function parseTimestampDate(isoDate: string): Date | null {
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatTimestamp(
  isoDate: string,
  timestampFormat: TimestampFormat,
  _t: TFunction = i18n.t,
): string {
  const date = parseTimestampDate(isoDate);
  if (!date) return "";
  return getTimestampFormatter(timestampFormat, true).format(date);
}

// Preserve the English tooltip's ordinal day and month order in English mode.
const monthNameFormatter = new Intl.DateTimeFormat("en-US", { month: "long" });

function ordinalSuffix(day: number): string {
  const lastTwo = day % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return "th";
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/**
 * Long-form tooltip label, e.g. `12:04, 4th June`.
 * Renders the wall-clock time without seconds followed by the ordinal day and month name.
 */
export function formatChatTimestampTooltip(
  isoDate: string,
  timestampFormat: TimestampFormat,
  t: TFunction = i18n.t,
): string {
  const date = parseTimestampDate(isoDate);
  if (!date) return "";
  const time = formatShortTimestamp(isoDate, timestampFormat, t);
  if (i18n.resolvedLanguage === "zh")
    return `${date.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })} ${time}`;
  const day = date.getDate();
  const month = monthNameFormatter.format(date);
  const year = date.getFullYear();
  return `${time}, ${day}${ordinalSuffix(day)} ${month} ${year}`;
}

export function formatShortTimestamp(
  isoDate: string,
  timestampFormat: TimestampFormat,
  _t: TFunction = i18n.t,
): string {
  const date = parseTimestampDate(isoDate);
  if (!date) return "";
  return getTimestampFormatter(timestampFormat, false).format(date);
}

const numericDateFormatter = new Intl.DateTimeFormat(timestampLocale, {
  month: "numeric",
  day: "numeric",
});
const numericDateWithYearFormatter = new Intl.DateTimeFormat(timestampLocale, {
  month: "numeric",
  day: "numeric",
  year: "numeric",
});

/**
 * Chat timestamp that adds the date once the message is no longer from today:
 * today `12:34 PM`, yesterday `yesterday at 12:34 PM`, older `8/13 12:34 PM`
 * (locale digit order), with the year included once the calendar year differs.
 * Boundaries are local calendar days, not 24-hour windows.
 */
export function formatDayAwareTimestamp(
  isoDate: string,
  timestampFormat: TimestampFormat,
  nowMs: number = Date.now(),
  t: TFunction = i18n.t,
): string {
  const date = parseTimestampDate(isoDate);
  if (!date) return "";
  const time = getTimestampFormatter(timestampFormat, false).format(date);

  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfMessageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  // Round so DST-shifted 23/25 hour days still count as whole days.
  const dayDiff = Math.round((startOfToday - startOfMessageDay) / 86_400_000);

  if (dayDiff <= 0) return time;
  if (dayDiff === 1) return t("time.yesterday", { time });
  const dateFormatter =
    date.getFullYear() === now.getFullYear() ? numericDateFormatter : numericDateWithYearFormatter;
  const dateLabel =
    i18n.resolvedLanguage === "zh"
      ? date.toLocaleDateString("zh-CN", {
          month: "numeric",
          day: "numeric",
          ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
        })
      : dateFormatter.format(date);
  return `${dateLabel} ${time}`;
}

/**
 * The forward-looking counterpart of {@link formatDayAwareTimestamp} for an
 * instant that has not happened yet (a usage-limit reset): today `12:34 PM`,
 * tomorrow `tomorrow at 12:34 PM`, later `8/13 12:34 PM`.
 */
export function formatUpcomingTimestamp(
  isoDate: string,
  timestampFormat: TimestampFormat,
  nowMs: number = Date.now(),
  t: TFunction = i18n.t,
): string {
  const date = parseTimestampDate(isoDate);
  if (!date) return "";
  const time = getTimestampFormatter(timestampFormat, false).format(date);

  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTargetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfTargetDay - startOfToday) / 86_400_000);

  if (dayDiff < 0) return formatDayAwareTimestamp(isoDate, timestampFormat, nowMs, t);
  if (dayDiff === 0) return time;
  if (dayDiff === 1) return t("time.tomorrow", { time });
  const dateFormatter =
    date.getFullYear() === now.getFullYear() ? numericDateFormatter : numericDateWithYearFormatter;
  const dateLabel =
    i18n.resolvedLanguage === "zh"
      ? date.toLocaleDateString("zh-CN", {
          month: "numeric",
          day: "numeric",
          ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
        })
      : dateFormatter.format(date);
  return `${dateLabel} ${time}`;
}

/**
 * Format a relative time string from an ISO date.
 * Returns a localized value and suffix so each portion can be styled separately.
 * so callers can style the numeric portion independently.
 */
type RelativeTimeParts = { value: string; suffix: string | null };
export type RelativeTimeState =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "relative"; value: string; suffix: string | null };

export function formatRelativeTime(
  isoDate: string,
  t: TFunction = i18n.t,
): RelativeTimeParts | null {
  const date = parseTimestampDate(isoDate);
  if (!date) return null;
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return { value: t("time.justNow"), suffix: null };
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return { value: t("time.justNow"), suffix: null };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return { value: t("time.compact.minutes", { count: minutes }), suffix: t("time.ago") };
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return { value: t("time.compact.hours", { count: hours }), suffix: t("time.ago") };
  const days = Math.floor(hours / 24);
  return { value: t("time.compact.days", { count: days }), suffix: t("time.ago") };
}

export function formatRelativeTimeLabel(isoDate: string, t: TFunction = i18n.t) {
  const relative = formatRelativeTime(isoDate, t);
  if (!relative) return "";
  return relative.suffix
    ? t("time.relative", { value: relative.value, suffix: relative.suffix })
    : relative.value;
}

export function getRelativeTimeState(
  isoDate: string | null,
  t: TFunction = i18n.t,
): RelativeTimeState {
  if (!isoDate) return { status: "missing" };
  const relative = formatRelativeTime(isoDate, t);
  if (!relative) return { status: "invalid" };
  return { status: "relative", ...relative };
}

/**
 * Relative elapsed duration since an ISO instant, without an "ago" suffix.
 * Useful for labels like "Connected for 3m".
 */
export function formatElapsedDurationLabel(
  isoDate: string,
  nowMs: number = Date.now(),
  t: TFunction = i18n.t,
): string {
  const date = parseTimestampDate(isoDate);
  if (!date) return "";
  const diffMs = nowMs - date.getTime();
  if (diffMs <= 0) return t("time.justNow");

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 5) return t("time.justNow");
  if (seconds < 60) return t("time.compact.seconds", { count: seconds });

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("time.compact.minutes", { count: minutes });

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.compact.hours", { count: hours });

  const days = Math.floor(hours / 24);
  return t("time.compact.days", { count: days });
}

/**
 * Relative time until an ISO instant (e.g. expiry). Mirrors {@link formatRelativeTime} but for future times.
 */
export function formatRelativeTimeUntil(
  isoDate: string,
  t: TFunction = i18n.t,
): RelativeTimeParts | null {
  const date = parseTimestampDate(isoDate);
  if (!date) return null;
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return { value: t("time.expired"), suffix: null };
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 5) return { value: t("time.soon"), suffix: null };
  if (seconds < 60)
    return { value: t("time.compact.seconds", { count: seconds }), suffix: t("time.left") };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return { value: t("time.compact.minutes", { count: minutes }), suffix: t("time.left") };
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return { value: t("time.compact.hours", { count: hours }), suffix: t("time.left") };
  const days = Math.floor(hours / 24);
  return { value: t("time.compact.days", { count: days }), suffix: t("time.left") };
}

export function formatRelativeTimeUntilLabel(isoDate: string, t: TFunction = i18n.t): string {
  const relative = formatRelativeTimeUntil(isoDate, t);
  if (!relative) return "";
  return relative.suffix
    ? t("time.relative", { value: relative.value, suffix: relative.suffix })
    : relative.value;
}

/**
 * Countdown for a future instant (e.g. link expiry): "Expires in 4m 12s", with second precision under one hour.
 * Pass `nowMs` when a parent tick drives re-renders so the diff matches that snapshot.
 */
export function formatExpiresInLabel(
  isoDate: string,
  nowMs: number = Date.now(),
  t: TFunction = i18n.t,
): string {
  const date = parseTimestampDate(isoDate);
  if (!date) return "";
  const diffMs = date.getTime() - nowMs;
  if (diffMs <= 0) return t("time.expired");

  const totalSeconds = Math.floor(diffMs / 1000);
  if (totalSeconds < 5) return t("time.expiresSoon");
  if (totalSeconds < 60)
    return t("time.expiresIn", { duration: t("time.compact.seconds", { count: totalSeconds }) });

  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds === 0
      ? t("time.expiresIn", { duration: t("time.compact.minutes", { count: minutes }) })
      : t("time.expiresIn", {
          duration: `${t("time.compact.minutes", { count: minutes })} ${t("time.compact.seconds", { count: seconds })}`,
        });
  }

  if (totalSeconds < 86_400) {
    const hours = Math.floor(totalSeconds / 3600);
    const rem = totalSeconds % 3600;
    const minutes = Math.floor(rem / 60);
    const seconds = rem % 60;
    const parts = [t("time.compact.hours", { count: hours })];
    if (minutes > 0) parts.push(t("time.compact.minutes", { count: minutes }));
    if (seconds > 0) parts.push(t("time.compact.seconds", { count: seconds }));
    return t("time.expiresIn", { duration: parts.join(" ") });
  }

  const days = Math.floor(totalSeconds / 86_400);
  const remAfterDays = totalSeconds % 86_400;
  if (remAfterDays === 0)
    return t("time.expiresIn", { duration: t("time.compact.days", { count: days }) });
  const hours = Math.floor(remAfterDays / 3600);
  const rem = remAfterDays % 3600;
  const minutes = Math.floor(rem / 60);
  const seconds = rem % 60;
  const tail: string[] = [];
  if (hours > 0) tail.push(t("time.compact.hours", { count: hours }));
  if (minutes > 0) tail.push(t("time.compact.minutes", { count: minutes }));
  if (seconds > 0) tail.push(t("time.compact.seconds", { count: seconds }));
  return tail.length > 0
    ? t("time.expiresIn", {
        duration: `${t("time.compact.days", { count: days })} ${tail.join(" ")}`,
      })
    : t("time.expiresIn", { duration: t("time.compact.days", { count: days }) });
}
