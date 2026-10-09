import { createContext } from "react";
import type { ResponsiveSidebarState } from "./sidebarState";

// Keep context identities stable when translated sidebar components hot-reload.
export type SidebarContextProps = {
  state: ResponsiveSidebarState;
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
};

export type SidebarResolvedResizableOptions = {
  maxWidth: number;
  minWidth: number;
  onResize?: (width: number) => void;
  shouldAcceptWidth?: (context: {
    currentWidth: number;
    nextWidth: number;
    rail: HTMLButtonElement;
    side: "left" | "right";
    sidebarRoot: HTMLElement;
    wrapper: HTMLElement;
  }) => boolean;
  storageKey: string | null;
};

export type SidebarInstanceContextProps = {
  resizable: SidebarResolvedResizableOptions | null;
  side: "left" | "right";
};

export const SidebarContext = createContext<SidebarContextProps | null>(null);
export const SidebarInstanceContext = createContext<SidebarInstanceContextProps | null>(null);
