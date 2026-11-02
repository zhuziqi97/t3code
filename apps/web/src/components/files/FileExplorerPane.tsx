import { type CSSProperties, type ReactNode, useState } from "react";

import { RightPanelResizeHandle } from "~/components/preview/RightPanelResizeHandle";
import { RESIZABLE_WIDTH_PROPERTY, useResizableWidth } from "~/hooks/useResizableWidth";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { useTranslate } from "~/i18n";
import {
  FILE_EXPLORER_MIN_WIDTH as MIN_WIDTH,
  FILE_EXPLORER_MAX_WIDTH as MAX_WIDTH,
  fileExplorerMaxWidth,
} from "./filePreviewMode";

export function FileExplorerPane({
  resizable,
  children,
}: {
  resizable: boolean;
  children: ReactNode;
}) {
  const t = useTranslate();
  const [maxWidth, setMaxWidth] = useState(MAX_WIDTH);
  const { width, setWidth, handlers } = useResizableWidth({
    storageKey: "t3code.fileExplorerWidth",
    defaultWidth: 256,
    minWidth: MIN_WIDTH,
    maxWidth,
    edge: "left",
  });

  return (
    <aside
      ref={(host) => {
        const row = host?.parentElement;
        if (!row || !resizable) return;
        const measure = () => setMaxWidth(fileExplorerMaxWidth(row.clientWidth));
        measure();
        return observeResize(row, measure);
      }}
      aria-label={t("filePreview.explorer")}
      className={cn(
        "relative flex min-h-0 min-w-0 shrink-0 bg-background",
        resizable
          ? "h-2/5 min-h-40 border-t border-border/60 @min-[34rem]/file-preview:h-auto @min-[34rem]/file-preview:w-(--resizable-width) @min-[34rem]/file-preview:min-h-0 @min-[34rem]/file-preview:border-t-0 @min-[34rem]/file-preview:border-l"
          : "flex-1",
      )}
      style={
        resizable
          ? ({
              [RESIZABLE_WIDTH_PROPERTY]: `${width}px`,
            } as CSSProperties)
          : undefined
      }
    >
      {resizable ? (
        <RightPanelResizeHandle
          handlers={handlers}
          className="hidden @min-[34rem]/file-preview:block"
          label={t("filePreview.resizeExplorer")}
          tabIndex={0}
          aria-valuenow={width}
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={maxWidth}
          onKeyDown={(event) => {
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            let nextWidth: number;
            switch (event.key) {
              case "ArrowLeft":
                nextWidth = width + 16;
                break;
              case "ArrowRight":
                nextWidth = width - 16;
                break;
              case "Home":
                nextWidth = MIN_WIDTH;
                break;
              case "End":
                nextWidth = maxWidth;
                break;
              default:
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            setWidth(nextWidth);
          }}
        />
      ) : null}
      {children}
    </aside>
  );
}
