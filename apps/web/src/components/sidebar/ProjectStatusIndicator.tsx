import { useShallow } from "zustand/react/shallow";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { SidebarThreadSummary } from "../../types";
import { useTranslate } from "../../i18n";
import { useUiStateStore } from "../../uiStateStore";
import { resolveThreadLastVisitedAt } from "../Sidebar.logic";
import { localizedStatusLabel } from "../ThreadStatusIndicators";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  highestProjectThreadStatus,
  resolveProjectThreadStatus,
  type ProjectThreadStatus,
} from "./projectThreadStatus";

export function useProjectThreadStatus(threads: readonly SidebarThreadSummary[]) {
  const localVisits = useUiStateStore(
    useShallow((state) =>
      threads.map(
        (thread) =>
          state.threadLastVisitedAtById[
            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))
          ],
      ),
    ),
  );
  return highestProjectThreadStatus(
    threads.map((thread, index) =>
      resolveProjectThreadStatus({
        ...thread,
        lastVisitedAt: resolveThreadLastVisitedAt(thread.lastVisitedAt, localVisits[index]),
      }),
    ),
  );
}

export function ProjectStatusIndicator(props: {
  status: ProjectThreadStatus | null;
  compact?: boolean;
}) {
  const t = useTranslate();
  const status = props.status;
  if (!status) return null;
  const label =
    status.label === "Stopped"
      ? t("chat.status.stopped")
      : status.label === "Rolled back"
        ? t("chat.timeline.runRolledBack")
        : status.label === "Limited"
          ? t("thread.limited")
          : localizedStatusLabel(status.label, t);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={status.label === "Completed" ? t("thread.unreadCompletion") : label}
            className={`inline-flex shrink-0 items-center gap-1 text-3xs ${status.colorClass}`}
          />
        }
      >
        <span className={`size-2 shrink-0 rounded-full ${status.dotClass}`} />
        {!props.compact && <span>{label}</span>}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
