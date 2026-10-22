import { useDndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import { verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLayoutEffect, useRef, type ReactNode, type Ref } from "react";
import type { SidebarListItem } from "../Sidebar.logic";
import { sidebarListItemId } from "../Sidebar.logic";
import { createSidebarListMotion } from "../Sidebar.motion";
import { cn } from "../../lib/utils";

export function sidebarProjectDragId(key: string) {
  return `sidebar-project:${key}`;
}

export type ProjectDragHandle = Pick<
  ReturnType<typeof useDraggable>,
  "attributes" | "listeners" | "setActivatorNodeRef"
>;

function ProjectBlock(props: {
  projectKey: string;
  projectKeys: readonly string[];
  disabled: boolean;
  items: readonly SidebarListItem[];
  renderItem: (item: SidebarListItem, handle?: ProjectDragHandle) => ReactNode;
}) {
  const id = sidebarProjectDragId(props.projectKey);
  const { active, over, activeNodeRect, droppableRects } = useDndContext();
  const bodyRef = useRef<HTMLUListElement>(null);
  const motion = useRef<ReturnType<typeof createSidebarListMotion> | null>(null);
  const bodyKey = props.items.map(sidebarListItemId).join("\n");
  const hasBody = props.items.length > 1;
  const dragging = active !== null;
  const motionPass = { layoutKey: bodyKey, animate: !dragging };
  useLayoutEffect(() => {
    if (!hasBody || !bodyRef.current) return;
    const current = createSidebarListMotion(bodyRef.current);
    motion.current = current;
    return () => current.dispose();
  }, [hasBody]);
  useLayoutEffect(() => {
    motion.current?.update(motionPass.animate);
  }, [motionPass]);
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, isDragging } =
    useDraggable({ id, disabled: props.disabled });
  const { setNodeRef: setDropRef } = useDroppable({ id, disabled: props.disabled });
  const projectIds = props.projectKeys.map(sidebarProjectDragId);
  const activeIndex = active ? projectIds.indexOf(String(active.id)) : -1;
  const overIndex = over ? projectIds.indexOf(String(over.id)) : -1;
  const rects = projectIds.flatMap((key) => {
    const rect = droppableRects.get(key);
    return rect ? [rect] : [];
  });
  const sortedTransform =
    activeIndex >= 0 && overIndex >= 0 && rects.length === projectIds.length
      ? verticalListSortingStrategy({
          activeNodeRect,
          activeIndex,
          overIndex,
          index: props.projectKeys.indexOf(props.projectKey),
          rects,
        })
      : null;
  return (
    <li
      ref={(node) => {
        setNodeRef(node);
        setDropRef(node);
      }}
      data-project-block={props.projectKey}
      className={cn("relative list-none", isDragging && "z-20 rounded-md bg-sidebar opacity-90")}
      style={{
        transform: CSS.Translate.toString(isDragging ? transform : sortedTransform),
        transition: activeIndex >= 0 && !isDragging ? "transform 150ms ease-out" : undefined,
      }}
    >
      <ul role="presentation">
        {props.items[0] &&
          props.renderItem(props.items[0], { attributes, listeners, setActivatorNodeRef })}
      </ul>
      {props.items.length > 1 && (
        <ul
          ref={bodyRef}
          role="presentation"
          className="relative ml-2 border-l border-sidebar-border pl-3"
        >
          {props.items.slice(1).map((item) => props.renderItem(item))}
        </ul>
      )}
    </li>
  );
}

/** Project blocks share the thread drag context, while moving their full contents together. */
export function ProjectTreeLayout({
  items,
  projectKeys,
  dragDisabled,
  listRef,
  className,
  renderItem,
}: {
  items: readonly SidebarListItem[];
  projectKeys: readonly string[];
  dragDisabled: boolean;
  listRef: Ref<HTMLUListElement>;
  className?: string;
  renderItem: (item: SidebarListItem, handle?: ProjectDragHandle) => ReactNode;
}) {
  const top: SidebarListItem[] = [];
  const groups = new Map<string, SidebarListItem[]>();
  for (const item of items) {
    if (item.projectKey === undefined || (item.kind === "thread" && item.section === "pinned")) {
      top.push(item);
    } else {
      const group = groups.get(item.projectKey) ?? [];
      group.push(item);
      groups.set(item.projectKey, group);
    }
  }
  return (
    <ul ref={listRef} role="presentation" className={cn("relative space-y-1", className)}>
      {top.map((item) => renderItem(item))}
      {projectKeys.map((key) => {
        const items = groups.get(key);
        return items ? (
          <ProjectBlock
            key={key}
            projectKey={key}
            projectKeys={projectKeys}
            disabled={dragDisabled}
            items={items}
            renderItem={renderItem}
          />
        ) : null;
      })}
    </ul>
  );
}
