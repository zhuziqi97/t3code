import { useTranslate } from "../../i18n";
import { useEffect, useEffectEvent, useState } from "react";

export function usePermissionStatus<Id extends string>(
  check: () => Promise<Record<Id, boolean>>,
  initialStatus: Record<Id, boolean>,
  enabled = true,
) {
  const t = useTranslate();
  const [status, setStatus] = useState(initialStatus);
  const [hasError, setHasError] = useState(false);
  const checkLatest = useEffectEvent(check);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let checking = false;
    const refresh = async () => {
      if (disposed || checking || document.visibilityState === "hidden") return;
      checking = true;
      try {
        const next = await checkLatest();
        if (!disposed) {
          setStatus(next);
          setHasError(false);
        }
      } catch {
        if (!disposed) setHasError(true);
      }
      checking = false;
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [enabled]);
  return {
    status,
    error: hasError ? t("permissions.checkFailed") : null,
    isReady: (required: readonly Id[]) => !hasError && required.every((id) => status[id]),
  };
}
