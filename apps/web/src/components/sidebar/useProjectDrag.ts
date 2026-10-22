import { closestCenter, type CollisionDetection } from "@dnd-kit/core";
import { useState } from "react";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useUiStateStore } from "../../uiStateStore";
import { sidebarProjectDragId } from "./ProjectTreeLayout";

export function useProjectDrag(groups: readonly SidebarProjectSnapshot[]) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const reorderProjects = useUiStateStore((state) => state.reorderProjects);
  const groupFor = (id: string) =>
    groups.find((group) => sidebarProjectDragId(group.projectKey) === id);
  const projectIds = new Set(groups.map((group) => sidebarProjectDragId(group.projectKey)));
  const collisionDetection: CollisionDetection | null =
    activeKey === null
      ? null
      : (args) =>
          closestCenter({
            ...args,
            droppableContainers: args.droppableContainers.filter((entry) =>
              projectIds.has(String(entry.id)),
            ),
          });
  return {
    activeKey,
    collisionDetection,
    start: (id: string) => {
      const group = groupFor(id);
      if (!group) return false;
      setActiveKey(group.projectKey);
      return true;
    },
    end: (id: string, overId: string | null) => {
      const source = groupFor(id);
      if (!source) return false;
      setActiveKey(null);
      const target = overId === null ? undefined : groupFor(overId);
      if (target && source !== target) {
        reorderProjects(
          groups.flatMap((group) =>
            group.memberProjects.map((member) => member.physicalProjectKey),
          ),
          source.memberProjects.map((member) => member.physicalProjectKey),
          target.memberProjects.map((member) => member.physicalProjectKey),
        );
      }
      return true;
    },
    cancel: () => setActiveKey(null),
  };
}
