// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { changeLanguage } from "../../i18n";
import { ThemeColorField } from "./ThemeColorPicker";

let root: Root;
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
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  await changeLanguage("en");
  changed.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Fixture />));
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Choose Background color"]')!.click(),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLanguage("en");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
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

it("keeps a pending hue adjustment through language changes and commits it once with its original alpha", async () => {
  const hue = document.querySelector<HTMLElement>('[role="slider"][aria-label="Background hue"]')!;
  await act(async () =>
    hue.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
  );
  expect(changed).not.toHaveBeenCalled();
  await switchLanguage();
  expect(document.querySelector('[role="slider"][aria-label="背景色相"]')).toBe(hue);
  expect(changed).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersToNextFrame());
  expect(changed).toHaveBeenCalledExactlyOnceWith("canvas", "#ff040080");
});
