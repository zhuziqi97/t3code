import { useTranslate } from "../../i18n";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { PlusIcon, SearchIcon } from "lucide-react";

import { openCommandPalette } from "../../commandPaletteBus";
import { Button } from "../ui/button";
import { PullRequestListGhost } from "./PullRequestGhosts";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";

function BranchMark({ joined }: { joined: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 120 72"
      className="h-20 w-32 text-muted-foreground/60"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 58h100" className="text-muted-foreground/30" stroke="currentColor" />
      <circle cx="10" cy="58" r="5" fill="currentColor" fillOpacity={0.25} />
      <circle cx="110" cy="58" r="5" fill="currentColor" fillOpacity={0.25} />
      {joined ? (
        <path d="M30 58c0-18 8-26 24-26h12c16 0 24 8 24 26" />
      ) : (
        <>
          <path d="M30 58c0-18 8-26 24-26h4" />
          <path
            d="M90 58c0-18-8-26-24-26h-4"
            strokeDasharray="2 7"
            className="text-muted-foreground/50"
          />
        </>
      )}
      <circle
        cx="60"
        cy="32"
        r={joined ? 5 : 4}
        fill={joined ? "currentColor" : "none"}
        fillOpacity={0.25}
        className={joined ? undefined : "text-muted-foreground/45"}
      />
    </svg>
  );
}

export function PullRequestListEmptyState({
  query,
  filtered,
  searching,
  hasProjects,
  canLoadMore,
  loadingMore,
  refreshing,
  onClearQuery,
  onLoadMore,
  onRefresh,
}: {
  query: string;
  filtered: boolean;
  searching: boolean;
  hasProjects: boolean;
  canLoadMore: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  onClearQuery: () => void;
  onLoadMore: () => void;
  onRefresh: () => void;
}) {
  const t = useTranslate();
  const displayedQuery = query.length > 48 ? `${query.slice(0, 48)}…` : query;
  // Ahead of the search and the filters, because neither can produce a row until a project does.
  if (!hasProjects) {
    return (
      <Empty>
        <BranchMark joined={false} />
        <EmptyHeader>
          <EmptyTitle>{t("pullRequest.list.noProjects")}</EmptyTitle>
          <EmptyDescription>{t("pullRequest.list.addProjectDescription")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" onClick={() => openCommandPalette({ open: "add-project" })}>
            <PlusIcon className="size-3.5" />
            {t("pullRequest.list.addProject")}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (searching) {
    return (
      <PullRequestListGhost
        rows={5}
        caption={t("pullRequest.list.searching", { query: displayedQuery })}
      />
    );
  }

  if (query.length > 0) {
    return (
      <Empty>
        <BranchMark joined={false} />
        <EmptyHeader>
          {/* A pasted paragraph is still a search, but it is not a title. */}
          <EmptyTitle>{t("pullRequest.list.noMatches", { query: displayedQuery })}</EmptyTitle>
          <EmptyDescription>{t("pullRequest.list.searchAdvice")}</EmptyDescription>
        </EmptyHeader>
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" variant="outline" onClick={onClearQuery}>
            <SearchIcon className="size-3.5" />
            {t("pullRequest.list.clearSearch")}
          </Button>
          <Button size="sm" variant="outline" disabled={refreshing} onClick={onRefresh}>
            <RefreshIcon size="sm" refreshing={refreshing} />
            {refreshing ? t("pullRequest.list.checking") : t("pullRequest.list.checkAgain")}
          </Button>
        </div>
      </Empty>
    );
  }

  return (
    <Empty>
      <BranchMark joined={false} />
      <EmptyHeader>
        <EmptyTitle>
          {filtered ? t("pullRequest.list.nothingFiltered") : t("pullRequest.list.noPullRequests")}
        </EmptyTitle>
        <EmptyDescription>
          {filtered
            ? t("pullRequest.list.filterAdvice")
            : t("pullRequest.list.workspaceDescription")}
        </EmptyDescription>
      </EmptyHeader>
      <div className="flex flex-wrap justify-center gap-2">
        {canLoadMore ? (
          <Button size="sm" variant="outline" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? t("pullRequest.list.loading") : t("pullRequest.list.loadMore")}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" disabled={refreshing} onClick={onRefresh}>
          <RefreshIcon size="sm" refreshing={refreshing} />
          {refreshing ? t("pullRequest.list.checking") : t("pullRequest.list.checkAgain")}
        </Button>
      </div>
    </Empty>
  );
}
