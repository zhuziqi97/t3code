import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../../test/render";
import { type ReactNode, type ReactElement } from "react";

import { describe, expect, it, vi } from "vite-plus/test";

// Keep the picker open while exercising keyboard input and saved color behavior.
vi.mock("../ui/popover", async (original) => ({
  ...(await original<typeof import("../ui/popover")>()),
  Popover: ({ children }: { children: ReactNode }) => children,
  PopoverPopup: ({ children }: { children: ReactNode }) => children,
  PopoverTrigger: () => null,
  PopoverClose: ({ render }: { render: ReactElement }) => render,
}));
vi.mock("../ui/tooltip", async (original) => ({
  ...(await original<typeof import("../ui/tooltip")>()),
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ render }: { render: ReactElement }) => render,
  TooltipPopup: () => null,
}));

import { ProviderAccentColorPicker } from "./ProviderAccentColorPicker";

import { changeLanguage } from "../../i18n";

let root: Screen;
let container: HTMLDivElement;
let nextFrameId = 0;
const frames = new Map<number, FrameRequestCallback>();

function slider(label: string) {
  return container.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
}
async function key(label: string, key: string, shiftKey = false) {
  await act(async () =>
    slider(label).dispatchEvent(
      new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }),
    ),
  );
}

describe("shared color controls in settings", () => {
  it("keeps a provider color through a language switch and operates its translated controls", async () => {
    await using _lifecycle = await setupLifecycle();

    const onCommit = vi.fn();
    await act(async () => {
      await root.rerender(
        <ProviderAccentColorPicker
          displayName="User provider"
          value="#ff0000"
          onCommit={onCommit}
        />,
      );
    });
    await key("Accent color hue", "ArrowRight", true);
    expect(onCommit).toHaveBeenLastCalledWith("#ff2a00");
    onCommit.mockClear();
    await act(async () => changeLanguage("zh"));
    expect(onCommit).not.toHaveBeenCalled();
    await key("强调色色相", "ArrowRight", true);
    expect(onCommit).toHaveBeenLastCalledWith("#ff5500");
    await key("强调色亮度", "ArrowDown", true);
    expect(onCommit).toHaveBeenLastCalledWith("#e64c00");
    const clear = [...container.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("清除颜色"),
    )!;
    await act(async () => clear.click());
    expect(onCommit).toHaveBeenLastCalledWith("");
  });
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    await act(async () => root.unmount());
    container.remove();
    frames.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await changeLanguage("en");
  });

  container = document.createElement("div");
  document.body.append(container);
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));

  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrameId, callback);
    return nextFrameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));

  renderStack = stack.move();
  return renderStack;
}
