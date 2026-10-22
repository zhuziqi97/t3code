import type { ComponentProps, ReactNode, Ref } from "react";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipTrigger } from "../ui/tooltip";

export function ProjectThreadRow({
  threadKey,
  rootProps,
  rowProps,
  rowRef,
  title,
  status,
  leading,
  indicators,
  time,
  actions,
  details,
  jumpHint,
  dragging,
}: {
  threadKey: string;
  rootProps: ComponentProps<"li">;
  rowProps: ComponentProps<"div">;
  rowRef: Ref<HTMLDivElement>;
  title: ReactNode;
  status: ReactNode;
  leading: ReactNode;
  indicators: ReactNode;
  time: ReactNode;
  actions: ReactNode;
  details: ReactNode;
  jumpHint: ReactNode;
  dragging: boolean;
}) {
  return (
    <li
      {...rootProps}
      data-thread-item={threadKey}
      className={cn(
        "list-none [content-visibility:auto] [contain-intrinsic-size:auto_32px]",
        dragging && "relative z-20",
      )}
    >
      <Tooltip disabled={dragging}>
        <TooltipTrigger
          render={
            <div
              {...rowProps}
              ref={rowRef}
              data-testid="sidebar-row-project"
              className={cn(
                "group/project-thread relative flex h-8 min-w-0 cursor-pointer select-none items-center gap-1.5 rounded-md px-2 text-left outline-hidden focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                rowProps.className,
              )}
            />
          }
        >
          {leading}
          {status}
          {title}
          {indicators}
          <span className="relative ml-auto flex min-w-10 shrink-0 items-center justify-end text-xs text-sidebar-muted-foreground">
            <span className="group-hover/project-thread:opacity-0 group-focus-within/project-thread:opacity-0">
              {time}
            </span>
            <span className="pointer-events-none absolute right-0 opacity-0 group-hover/project-thread:pointer-events-auto group-hover/project-thread:opacity-100 group-focus-within/project-thread:pointer-events-auto group-focus-within/project-thread:opacity-100">
              {actions}
            </span>
          </span>
          {jumpHint}
        </TooltipTrigger>
        {details}
      </Tooltip>
    </li>
  );
}
