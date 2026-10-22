import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

export const useConveneResourceStore = create<{
  target: { threadRef: ScopedThreadRef; uri: string } | null;
  open: (threadRef: ScopedThreadRef, uri: string) => void;
  close: () => void;
}>()((set) => ({
  target: null,
  open: (threadRef, uri) => set({ target: { threadRef, uri } }),
  close: () => set({ target: null }),
}));
