import "~/index.css";
import { act, fakeTimers, render as renderTestUi, type Screen } from "../../../test/render";
import { useState } from "react";

import { expect, it, vi } from "vite-plus/test";
import { changeLanguage } from "../../i18n";
import { ThemeColorField } from "./ThemeColorPicker";

let root: Screen;
let container: HTMLDivElement;
const changed = vi.fn();
function Fixture() {
  const [value, setValue] = useState("#ff000080");
  return (
    <ThemeColorField
      role="canvas"
      value={value}
      onChange={(role, color) => {
        changed(role, color);
        setValue(color);
      }}
    />
  );
}

async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function switchLanguage() {
  await act(async () => changeLanguage("zh"));
}

it("keeps an incomplete HEX draft and the open picker across language changes, then commits a native color", async () => {
  await using _lifecycle = await setupLifecycle();

  const input = document.querySelector<HTMLInputElement>(
    '[aria-label="Background picker hex value"]',
  )!;
  await fill(input, "#12");
  await switchLanguage();
  expect(document.querySelector('[aria-label="背景选择器的 HEX 值"]')).toBe(input);
  expect(input.value).toBe("#12");
  expect(changed).not.toHaveBeenCalled();
  await fill(input, "#112233");
  expect(changed).toHaveBeenCalledExactlyOnceWith("canvas", "#112233");
});

it("preserves an RGB draft through language changes and retains alpha on a native RGB commit", async () => {
  await using _lifecycle = await setupLifecycle();

  const input = document.querySelector<HTMLInputElement>(
    '[aria-label="Background picker RGB value"]',
  )!;
  await fill(input, "12, 34,");
  await switchLanguage();
  expect(document.querySelector('[aria-label="背景选择器的 RGB 值"]')).toBe(input);
  expect(input.value).toBe("12, 34,");
  expect(changed).not.toHaveBeenCalled();
  await fill(input, "12, 34, 56");
  expect(changed).toHaveBeenCalledExactlyOnceWith("canvas", "#0c223880");
});

it("keeps a pending hue adjustment through language changes and commits it once on close with its original alpha", async () => {
  await using _lifecycle = await setupLifecycle();

  const hue = document.querySelector<HTMLElement>('[role="slider"][aria-label="Background hue"]')!;
  await act(async () =>
    hue.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
  );
  expect(changed).not.toHaveBeenCalled();
  await switchLanguage();
  expect(document.querySelector('[role="slider"][aria-label="背景色相"]')).toBe(hue);
  expect(changed).not.toHaveBeenCalled();
  await act(() =>
    container.querySelector<HTMLButtonElement>('[aria-label="选择背景颜色"]')!.click(),
  );
  expect(changed).toHaveBeenCalledExactlyOnceWith("canvas", "#ff040080");
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {
    await act(async () => root.unmount());
    container.remove();
    await changeLanguage("en");
    vi.unstubAllGlobals();
  });

  await changeLanguage("en");
  changed.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));
  renderStack.use(fakeTimers());
  await act(async () => root.rerender(<Fixture />));
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Choose Background color"]')!.click(),
  );

  renderStack = stack.move();
  return renderStack;
}
