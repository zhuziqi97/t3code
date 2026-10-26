import { useTranslate } from "../../i18n";
import { ChevronRightIcon, FolderIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { memo } from "react";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useEnvironmentScope } from "../../state/session";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Button } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  MenuSub,
  MenuSubTrigger,
  MenuSubPopup,
} from "../ui/menu";
import { ProjectFavicon } from "../ProjectFavicon";
import { ProjectEnvironmentBadge } from "../ProjectEnvironmentBadge";
import type { ComponentProps } from "react";
import type { ProjectDragHandle } from "./ProjectTreeLayout";
import { useThreadShellsForProjectRefs } from "../../state/entities";
import { filterSidebarV2VisibleThreads } from "../Sidebar.logic";
import { ProjectStatusIndicator, useProjectThreadStatus } from "./ProjectStatusIndicator";

import { useAtomValue } from "@effect/atom-react";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { serverEnvironment } from "../../state/server";
import { OpenInPicker } from "../chat/OpenInPicker";
import type { SidebarProjectGroupMember } from "../../sidebarProjectGrouping";

function ProjectEditorMenu({ project }: { project: SidebarProjectGroupMember }) {
  const config = useAtomValue(serverEnvironment.configValueAtom(project.environmentId));
  return (
    <OpenInPicker
      presentation="menu"
      environmentId={project.environmentId}
      keybindings={config?.keybindings ?? DEFAULT_RESOLVED_KEYBINDINGS}
      availableEditors={config?.availableEditors ?? []}
      openInCwd={project.workspaceRoot}
      workspace={{ projectId: project.id, workspacePath: project.workspaceRoot }}
      enableShortcut={false}
    />
  );
}

export const SidebarProjectRow = memo(function SidebarProjectRow(props: {
  project: SidebarProjectSnapshot;
  label: string;
  isScratch: boolean;
  selected: boolean;
  expanded: boolean;
  badge: ComponentProps<typeof ProjectEnvironmentBadge> | null;
  onSelect: () => void;
  onNewThread: () => void;
  onSettings: () => void;
  dragHandle?: ProjectDragHandle | undefined;
}) {
  const t = useTranslate();
  const canCreate = useEnvironmentScope(props.project.environmentId, AuthOrchestrationOperateScope);
  const threads = useThreadShellsForProjectRefs(props.project.memberProjectRefs);
  const status = useProjectThreadStatus(filterSidebarV2VisibleThreads(threads, null));
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
              ref={props.dragHandle?.setActivatorNodeRef}
              {...props.dragHandle?.attributes}
              {...props.dragHandle?.listeners}
              type="button"
              aria-expanded={props.expanded}
              aria-pressed={props.selected}
              onClick={props.onSelect}
              className={cn(
                "flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm text-sidebar-foreground outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring pointer-coarse:min-h-11",
                props.dragHandle ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
              )}
            />
          }
        >
          {!props.expanded && status ? (
            <ProjectStatusIndicator status={status} compact />
          ) : (
            <ChevronRightIcon
              aria-hidden
              className={cn("size-3 shrink-0 text-icon-muted", props.expanded && "rotate-90")}
            />
          )}
          {props.isScratch ? (
            <FolderIcon aria-hidden className="size-4 shrink-0" />
          ) : (
            <ProjectFavicon project={props.project} className="size-4 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">{props.label}</span>
          {props.badge && <ProjectEnvironmentBadge {...props.badge} />}
        </TooltipTrigger>
        <TooltipPopup>
          {props.label}
          {!props.isScratch && (
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
                aria-label={t("convene.sidebar.newInProject", { project: props.label })}
                disabled={!canCreate}
                onClick={props.onNewThread}
              />
            }
          >
            <PlusIcon />
          </TooltipTrigger>
          <TooltipPopup>{t("convene.sidebar.newInProject", { project: props.label })}</TooltipPopup>
        </Tooltip>
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label={t("convene.sidebar.actions", { project: props.label })}
              />
            }
          >
            <MoreHorizontalIcon />
          </MenuTrigger>
          <MenuPopup>
            {!props.isScratch &&
              props.project.memberProjects.map((member) =>
                props.project.memberProjects.length === 1 ? (
                  <ProjectEditorMenu
                    key={`${member.environmentId}:${member.id}`}
                    project={member}
                  />
                ) : (
                  <MenuSub key={`${member.environmentId}:${member.id}`}>
                    <MenuSubTrigger>
                      {t("chat.editor.open")} · {member.environmentLabel ?? member.environmentId}
                    </MenuSubTrigger>
                    <MenuSubPopup>
                      <ProjectEditorMenu project={member} />
                    </MenuSubPopup>
                  </MenuSub>
                ),
              )}
            <MenuItem onClick={props.onSettings}>{t("convene.sidebar.projectSettings")}</MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    </div>
  );
});
