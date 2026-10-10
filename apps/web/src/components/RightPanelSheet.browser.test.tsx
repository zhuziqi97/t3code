// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { BrowserSurfaceSlot } from "~/browser/BrowserSurfaceSlot";
import { useBrowserSurfaceStore } from "~/browser/browserSurfaceStore";
import { changeLanguage } from "~/i18n";
import { RightPanelSheet } from "./RightPanelSheet";
import { Dialog, DialogPopup, DialogTitle } from "./ui/dialog";

let root: Root;
let container: HTMLDivElement;
let styles: HTMLStyleElement;

function Harness() {
  const [open, setOpen] = useState(true);
  const [confirmation, setConfirmation] = useState(false);
  return (
    <>
      <button data-retained-browser>Native browser control</button>
      <button onClick={() => setOpen(true)}>Reopen panel</button>
      <RightPanelSheet open={open} animationDurationMs={0} onClose={() => setOpen(false)}>
        <button onClick={() => setConfirmation(true)}>Open confirmation</button>
        <BrowserSurfaceSlot tabId="native-test" visible={open} />
        <Dialog open={confirmation} onOpenChange={setConfirmation}>
          <DialogPopup>
            <DialogTitle>Raw confirmation</DialogTitle>
          </DialogPopup>
        </Dialog>
      </RightPanelSheet>
      <BrowserSurfaceSlot tabId="inline-test" visible />
    </>
  );
}
const settle = () => act(async () => vi.runOnlyPendingTimersAsync());
const click = async (label: string) => {
  await act(async () => {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (e) => e.textContent === label,
    );
    expect(button).toBeDefined();
    button!.focus();
    button!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    button!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    button!.click();
  });
  await settle();
};
const panel = () => document.querySelector<HTMLElement>('[data-slot="sheet-popup"]')!;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 10,
    y: 20,
    width: 300,
    height: 200,
    top: 20,
    left: 10,
    right: 310,
    bottom: 220,
    toJSON: () => ({}),
  });
  useBrowserSurfaceStore.setState({ byTabId: {}, activityByTabId: {} });
  await changeLanguage("en");
  styles = document.createElement("style");
  styles.textContent = '[data-slot="sheet-viewport"] { z-index: 46; }';
  document.head.append(styles);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
  await settle();
});
afterEach(async () => {
  await act(async () => root.unmount());
  await settle();
  container.remove();
  styles.remove();
  useBrowserSurfaceStore.setState({ byTabId: {}, activityByTabId: {} });
  await changeLanguage("en");
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("allows a retained browser outside the sheet to receive focus and input, while preserving modal dialogs", async () => {
  const browserControl = document.querySelector<HTMLButtonElement>("[data-retained-browser]")!;
  expect(browserControl.closest('[aria-hidden="true"]')).toBeNull();
  expect(useBrowserSurfaceStore.getState().byTabId["native-test"]?.zIndex).toBe(47);
  expect(useBrowserSurfaceStore.getState().byTabId["inline-test"]?.zIndex).toBe(30);
  await click("Native browser control");
  expect(document.activeElement).toBe(browserControl);
  expect(panel().hasAttribute("data-open")).toBe(true);
  await click("Open confirmation");
  expect(document.querySelector('[data-slot="dialog-popup"]')).not.toBeNull();
  expect(browserControl.closest('[aria-hidden="true"]')).not.toBeNull();
  await act(async () => changeLanguage("zh"));
  await act(async () =>
    document.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!.click(),
  );
  await settle();
  expect(panel().hasAttribute("data-open")).toBe(true);
  expect(browserControl.closest('[aria-hidden="true"]')).toBeNull();
});

it("closes on the sheet's empty layer or Escape and keeps the surface lease when reopened", async () => {
  await act(async () => {
    const viewport = document.querySelector<HTMLElement>('[data-slot="sheet-viewport"]')!;
    viewport.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    viewport.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    viewport.click();
  });
  await settle();
  expect(panel().hasAttribute("data-open")).toBe(false);
  expect(useBrowserSurfaceStore.getState().byTabId["native-test"]?.visible).toBe(false);
  await click("Reopen panel");
  const owner = useBrowserSurfaceStore.getState().byTabId["native-test"]?.owner;
  expect(panel().hasAttribute("data-open")).toBe(true);
  await act(async () =>
    panel().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  await settle();
  expect(panel().hasAttribute("data-open")).toBe(false);
  await click("Reopen panel");
  expect(useBrowserSurfaceStore.getState().byTabId["native-test"]?.owner).toBe(owner);
  expect(useBrowserSurfaceStore.getState().byTabId["native-test"]?.visible).toBe(true);
});
