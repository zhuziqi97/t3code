import type { TimestampFormat } from "@t3tools/contracts/settings";
import { useTranslate } from "../../i18n";
import { cn } from "../../lib/utils";
import { formatDayAwareTimestamp, formatChatTimestampTooltip } from "../../timestampFormat";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { runEndState } from "./runEndState";
export type RunEndFeedback = NonNullable<ReturnType<typeof runEndState>>;
export function RunEndStateFeedback({
  end,
  timestampFormat,
  inline = false,
}: {
  end: RunEndFeedback;
  timestampFormat: TimestampFormat;
  inline?: boolean;
}) {
  const t = useTranslate();
  const label =
    end.kind === "failed"
      ? t("chat.timeline.runFailed")
      : end.kind === "stopped"
        ? t("chat.timeline.runStopped")
        : end.kind === "rolledBack"
          ? t("chat.timeline.runRolledBack")
          : t("chat.timeline.runEnded");
  return (
    <span
      role="status"
      data-testid={inline ? undefined : "latest-run-end-state"}
      className={cn(
        "inline-flex flex-wrap items-center gap-2 text-xs text-muted-foreground",
        end.kind === "failed" && "text-destructive-foreground",
      )}
    >
      {!inline && end.completedAt ? (
        <Tooltip>
          <TooltipTrigger render={<time dateTime={end.completedAt} className="tabular-nums" />}>
            {formatDayAwareTimestamp(end.completedAt, timestampFormat, undefined, t)}
          </TooltipTrigger>
          <TooltipPopup>
            {formatChatTimestampTooltip(end.completedAt, timestampFormat, t)}
          </TooltipPopup>
        </Tooltip>
      ) : null}
      <span>{label}</span>
    </span>
  );
}
