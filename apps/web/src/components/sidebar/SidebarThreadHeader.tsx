import { useTranslate } from "../../i18n";
/** Fixed sidebar actions and global thread search. */
import { FolderPlusIcon, SearchIcon, SquarePenIcon, XIcon } from "lucide-react";
import {
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { SidebarInput, SidebarMenuButton } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface SidebarThreadHeaderProps {
  searchFieldRef?: RefObject<HTMLDivElement | null>;
  onNewProject: () => void;
  onNewThread: (event: ReactMouseEvent) => void;
  newThreadDisabled: boolean;
  newThreadShortcutLabel: string | null | undefined;
  newThreadTargetLabel: string | null;
  allThreadsSelected: boolean;
  onAllThreads: () => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  isSearching: boolean;
  searchResultCount: number;
  activeSearchResultIndex: number;
  onClearSearch: () => void;
}

export function SidebarThreadHeader({
  searchFieldRef,
  onNewProject,
  onNewThread,
  newThreadDisabled,
  newThreadShortcutLabel,
  newThreadTargetLabel,
  allThreadsSelected,
  onAllThreads,
  searchInputRef,
  searchQuery,
  onSearchQueryChange,
  onSearchKeyDown,
  isSearching,
  searchResultCount,
  activeSearchResultIndex,
  onClearSearch,
}: SidebarThreadHeaderProps) {
  const t = useTranslate();
  const resultsVisible = isSearching && searchResultCount > 0;
  // Results shrink as the query narrows, so the active index can outrun the
  // list; pointing aria-activedescendant at a removed option strands the
  // screen reader on nothing.
  const activeResultExists = resultsVisible && activeSearchResultIndex < searchResultCount;
  const newThreadLabel = newThreadTargetLabel
    ? t("convene.sidebar.newInProject", { project: newThreadTargetLabel })
    : t("convene.sidebar.newThread");

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                disabled={newThreadDisabled}
                onClick={onNewThread}
              />
            }
          >
            <SquarePenIcon /> {t("thread.new")}
          </TooltipTrigger>
          <TooltipPopup>
            {newThreadLabel}
            {newThreadShortcutLabel ? ` (${newThreadShortcutLabel})` : ""}
          </TooltipPopup>
        </Tooltip>
        <div className="ml-auto">
          <SidebarHeaderIconButton label={t("project.add")} onClick={onNewProject}>
            <FolderPlusIcon />
          </SidebarHeaderIconButton>
        </div>
      </div>
      <div
        ref={searchFieldRef}
        className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
      >
        <SearchIcon className="size-4 shrink-0 text-(--sidebar-icon-color)" />
        <SidebarInput
          ref={searchInputRef}
          nativeInput
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.currentTarget.value)}
          onKeyDown={onSearchKeyDown}
          placeholder={t("thread.search.short")}
          aria-label={t("thread.search")}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={resultsVisible}
          aria-controls={resultsVisible ? "sidebar-thread-search-results" : undefined}
          aria-activedescendant={
            activeResultExists
              ? `sidebar-thread-search-result-${activeSearchResultIndex}`
              : undefined
          }
          className="min-w-0 flex-1"
        />
        {isSearching ? (
          <Button
            type="button"
            size="icon-micro"
            variant="ghost-muted"
            className="shrink-0"
            aria-label={t("thread.search.clear")}
            onClick={() => {
              onClearSearch();
              searchInputRef.current?.focus();
            }}
          >
            <XIcon className="size-3" />
          </Button>
        ) : null}
      </div>
      <SidebarMenuButton type="button" isActive={allThreadsSelected} onClick={onAllThreads}>
        {t("convene.sidebar.allThreads")}
      </SidebarMenuButton>
    </div>
  );
}

export function SidebarHeaderIconButton({
  label,
  tooltip = label,
  className,
  children,
  ...rest
}: {
  label: string;
  tooltip?: ReactNode;
  className?: string | undefined;
  children?: ReactNode;
} & Omit<
  ComponentProps<typeof SidebarMenuButton>,
  "children" | "className" | "tooltip" | "isActive" | "aria-label"
>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarMenuButton
            size="icon"
            type="button"
            aria-label={label}
            {...rest}
            className={cn("relative size-7 shrink-0", className)}
          />
        }
      >
        {children}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
        />
      </TooltipTrigger>
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
