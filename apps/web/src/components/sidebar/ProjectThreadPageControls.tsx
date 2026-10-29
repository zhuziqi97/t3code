import type { SidebarThreadSummary } from "../../types";
import { useTranslate } from "../../i18n";
import { ProjectStatusIndicator, useProjectThreadStatus } from "./ProjectStatusIndicator";

export function ProjectThreadPageControls(props: {
  hiddenThreads: readonly SidebarThreadSummary[];
  unloadedCount?: number;
  loading?: boolean;
  failed?: boolean;
  pageSize: number;
  expanded: boolean;
  onMore: () => void;
  onLess: () => void;
}) {
  const t = useTranslate();
  const remaining = props.hiddenThreads.length + (props.unloadedCount ?? 0);
  const status = useProjectThreadStatus(props.hiddenThreads);
  const buttonClass =
    "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs text-sidebar-foreground hover:bg-sidebar-row-hover focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";
  return (
    <>
      {(remaining > 0 || props.loading || props.failed) && (
        <button
          type="button"
          disabled={props.loading}
          onClick={props.onMore}
          className={buttonClass}
        >
          <ProjectStatusIndicator status={status} compact />
          {props.loading
            ? t("common.loading")
            : props.failed
              ? "Could not load older threads. Retry"
              : t("convene.sidebar.moreRemaining", {
                  count: Math.min(props.pageSize, remaining),
                  remaining,
                })}
        </button>
      )}
      {props.expanded && (
        <button type="button" onClick={props.onLess} className={buttonClass}>
          {t("legacy.showLess")}
        </button>
      )}
    </>
  );
}
