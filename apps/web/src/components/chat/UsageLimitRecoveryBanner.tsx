import type { TFunction } from "i18next";
import { i18n, useTranslate } from "../../i18n";
import {
  type OrchestrationV2LimitRecovery,
  type OrchestrationV2LimitRecoveryUpdate,
  type RunId,
} from "@t3tools/contracts";
import { GaugeIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

type RecoveryProps = {
  runId: RunId;
  resetAt: string | null;
  stoppedAt: string;
  snoozedUntil: string | null;
  recovery: OrchestrationV2LimitRecovery | null;
  onChange: (recovery: OrchestrationV2LimitRecoveryUpdate) => Promise<void>;
};

export function usageLimitRecoveryBannerItem(
  props: RecoveryProps,
  t: TFunction = i18n.t,
): ComposerBannerStackItem {
  const { runId, resetAt, stoppedAt } = props;
  const canSchedule = resetAt !== null && Date.parse(resetAt) > Date.parse(stoppedAt);
  return {
    id: `usage-limit-recovery:${runId}`,
    variant: "warning",
    priority: "urgent",
    icon: <GaugeIcon />,
    title: t("thread.status.limit"),
    description: resetAt
      ? t("chat.recovery.resetTime", { time: new Date(resetAt).toLocaleString() })
      : t("chat.recovery.noResetTime"),
    actions: canSchedule ? <RecoveryActions key={`${runId}:${resetAt}`} {...props} /> : null,
  };
}

function RecoveryActions({ runId, resetAt, recovery, snoozedUntil, onChange }: RecoveryProps) {
  const t = useTranslate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const delay = Date.parse(resetAt ?? "") - Math.max(nowMs, Date.now());
    if (!Number.isFinite(delay) || delay <= 0) return;
    const timer = window.setTimeout(() => setNowMs(Date.now()), Math.min(delay + 1, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [resetAt, nowMs]);

  const scheduled =
    recovery?.runId === runId && recovery.resetAt === resetAt && recovery.autoResume;
  const snoozed =
    recovery?.snooze === true &&
    recovery.runId === runId &&
    recovery.resetAt === resetAt &&
    resetAt !== null &&
    snoozedUntil !== null &&
    Date.parse(snoozedUntil) === Date.parse(resetAt);
  async function toggle(action: "resume" | "snooze") {
    if (resetAt === null) return;
    if (action === "snooze" && !snoozed && Date.parse(resetAt) <= Date.now()) {
      setError(t("chat.recovery.resetPassed"));
      setNowMs(Date.now());
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onChange({
        runId,
        resetAt,
        ...(action === "resume" ? { autoResume: !scheduled } : { snooze: !snoozed }),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("chat.recovery.updateFailed"));
    }
    setPending(false);
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="xs" variant="ghost" disabled={pending} onClick={() => void toggle("resume")}>
        {pending
          ? "Saving..."
          : scheduled
            ? t("chat.recovery.cancelResume")
            : t("chat.recovery.resumeAtReset")}
      </Button>
      {!snoozed ? (
        <Button
          size="xs"
          variant="ghost"
          disabled={pending || Date.parse(resetAt!) <= nowMs}
          onClick={() => void toggle("snooze")}
        >
          {pending ? "Saving..." : t("chat.recovery.snoozeUntilReset")}
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="basis-full text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
