import { ChevronRightIcon, FolderIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { memo } from "react";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useEnvironmentScope } from "../../state/session";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { ProjectFavicon } from "../ProjectFavicon";
import { ProjectEnvironmentBadge } from "../ProjectEnvironmentBadge";
import type { ComponentProps } from "react";

export const SidebarProjectRow = memo(function SidebarProjectRow(props: {
  project: SidebarProjectSnapshot;
  label: string;
  selected: boolean;
  expanded: boolean;
  badge: ComponentProps<typeof ProjectEnvironmentBadge> | null;
  onSelect: () => void;
  onNewThread: () => void;
  onSettings: () => void;
}) {
  const canCreate = useEnvironmentScope(props.project.environmentId, AuthOrchestrationOperateScope);
  return (
    <div
      className={cn(
        "group/project flex min-w-0 items-center rounded-md hover:bg-sidebar-row-hover",
        props.selected && "bg-sidebar-row-selected",
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-expanded={props.expanded}
              aria-pressed={props.selected}
              onClick={props.onSelect}
              className="flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm text-sidebar-foreground outline-hidden focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
            />
          }
        >
          <ChevronRightIcon
            aria-hidden
            className={cn("size-3 shrink-0 text-icon-muted", props.expanded && "rotate-90")}
          />
          {props.label === "No project" ? (
            <FolderIcon aria-hidden className="size-4 shrink-0" />
          ) : (
            <ProjectFavicon project={props.project} className="size-4 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">{props.label}</span>
          {props.badge && <ProjectEnvironmentBadge {...props.badge} />}
        </TooltipTrigger>
        <TooltipPopup>
          {props.label}
          {props.label !== "No project" && (
            <div className="text-xs text-muted-foreground">{props.project.workspaceRoot}</div>
          )}
        </TooltipPopup>
      </Tooltip>
      <div className="flex shrink-0 items-center gap-px pr-1 opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100 pointer-coarse:opacity-100">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label={`New thread in ${props.label}`}
                disabled={!canCreate}
                onClick={props.onNewThread}
              />
            }
          >
            <PlusIcon />
          </TooltipTrigger>
          <TooltipPopup>New thread in {props.label}</TooltipPopup>
        </Tooltip>
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label={`Actions for ${props.label}`}
              />
            }
          >
            <MoreHorizontalIcon />
          </MenuTrigger>
          <MenuPopup>
            <MenuItem onClick={props.onSettings}>Project settings</MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    </div>
  );
});
