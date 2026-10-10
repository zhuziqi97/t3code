import { type ReactNode } from "react";

import { Sheet, SheetPopup } from "./ui/sheet";

export function RightPanelSheet(props: {
  animationDurationMs: number;
  children: ReactNode;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={props.open}
      // The retained native browser lives outside this popup's DOM tree.
      // Keep it focusable, and dismiss only from the sheet's own empty layer.
      modal={false}
      onOpenChange={(open, details) => {
        if (details.reason === "focus-out") return;
        if (
          details.reason === "outside-press" &&
          (!(details.event.target instanceof Element) ||
            !details.event.target.matches(
              '[data-slot="sheet-backdrop"], [data-slot="sheet-viewport"]',
            ))
        ) {
          return;
        }
        if (!open) {
          props.onClose();
        }
      }}
    >
      <SheetPopup
        transitionDurationMs={props.animationDurationMs}
        side="right"
        showCloseButton={false}
        keepMounted
        className="w-[min(42vw,28rem)] min-w-80 max-w-[28rem] max-[760px]:w-[min(88vw,24rem)] max-[760px]:min-w-0 wco:mt-(--workspace-topbar-height) wco:h-[calc(100%-var(--workspace-topbar-height))] wco:max-h-[calc(100%-var(--workspace-topbar-height))]"
      >
        {props.children}
      </SheetPopup>
    </Sheet>
  );
}
