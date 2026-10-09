// @vitest-environment jsdom
import { EnvironmentId } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { changeLanguage } from "../../i18n";

vi.mock("~/hooks/useSettings", () => ({ useClientSettings: () => undefined }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => ({}) }));
vi.mock("~/state/server", () => ({ primaryServerKeybindingsAtom: Symbol("keybindings") }));
vi.mock("~/hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("../files/projectFilesQueryState", () => ({
  useProjectFilePickerQuery: () => ({
    entries: [],
    error: null,
    isPending: false,
    matchedQuery: "",
  }),
}));
vi.mock("../ui/toast", () => ({ toastManager: { add: vi.fn() } }));
vi.mock("../CommandPaletteContent", () => ({
  CommandPaletteContent: ({
    footerTrailing,
    children,
  }: {
    footerTrailing: ReactNode;
    children: ReactNode;
  }) => (
    <>
      {footerTrailing}
      {children}
    </>
  ),
}));
vi.mock("../CommandPaletteResults", () => ({ CommandPaletteResults: () => null }));
vi.mock("../ui/command", () => ({
  CommandDialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? children : null,
  CommandDialogPopup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandFooterAction: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));

import { toastManager } from "../ui/toast";
import {
  canPickExternalProjectFavicon,
  ProjectFaviconPickerDialog,
} from "./ProjectFaviconPickerDialog";
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLanguage("en");
  vi.unstubAllGlobals();
});
async function open(
  onPickExternal: () => Promise<string | null>,
  onOpenChange = vi.fn(),
  onSelect = vi.fn(),
) {
  await act(async () =>
    root.render(
      <ProjectFaviconPickerDialog
        cwd="/Users/me/project"
        environmentId={EnvironmentId.make("local")}
        onOpenChange={onOpenChange}
        onPickExternal={onPickExternal}
        onSelect={onSelect}
        open
        projectName="Project"
      />,
    ),
  );
  return { onOpenChange, onSelect };
}
describe("project image selection", () => {
  it("switches the native picker label to Chinese and selects the same file", async () => {
    const result = await open(vi.fn().mockResolvedValue("/Users/me/Pictures/icon.png"));
    expect(container.querySelector("button")!.textContent).toBe("Open in Finder");
    await act(async () => {
      await changeLanguage("zh");
    });
    expect(container.querySelector("button")!.textContent).toBe("在 Finder 中打开");
    await act(async () => container.querySelector("button")!.click());
    expect(result.onOpenChange).toHaveBeenCalledWith(false);
    expect(result.onSelect).toHaveBeenCalledWith("/Users/me/Pictures/icon.png");
  });
  it("keeps the dialog available after a native picker failure", async () => {
    const result = await open(vi.fn().mockRejectedValue(new Error("picker failed")));
    await act(async () => container.querySelector("button")!.click());
    expect(result.onOpenChange).not.toHaveBeenCalled();
    expect(result.onSelect).not.toHaveBeenCalled();
    expect(container.querySelector("button")!.disabled).toBe(false);
    expect(toastManager.add).toHaveBeenCalledWith({
      type: "error",
      title: "Could not open image picker",
      description: "picker failed",
    });
  });
  it("keeps native selection limited to native Windows paths on Windows", () => {
    expect(canPickExternalProjectFavicon("/home/me/project", "Win32")).toBe(false);
    expect(canPickExternalProjectFavicon("C:\\Users\\me\\project", "Win32")).toBe(true);
  });
});
