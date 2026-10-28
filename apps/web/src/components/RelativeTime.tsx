import { useTranslate } from "../i18n";
import { useRelativeTimeState } from "../hooks/useRelativeTimeState";

// Use a live clock because the compiler caches inline formatting on the timestamp.
export function RelativeTime(props: { timestamp: string }) {
  const t = useTranslate();
  const relative = useRelativeTimeState(props.timestamp);
  if (relative.status !== "relative") return null;
  return relative.suffix
    ? t("time.relative", { value: relative.value, suffix: relative.suffix })
    : relative.value;
}
