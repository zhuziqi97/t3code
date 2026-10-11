// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { changeLanguage } from "../i18n";
import { CustomSnoozeDialogHost, requestCustomSnooze } from "./CustomSnoozeDialog";

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 9, 10, 0));
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<CustomSnoozeDialogHost />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await changeLanguage("en");
});
async function click(text: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === text,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
it("keeps the chosen duration across a language switch and returns the same wake instant", async () => {
  let choice!: ReturnType<typeof requestCustomSnooze>;
  await act(async () => {
    choice = requestCustomSnooze();
  });
  await click("Duration");
  await act(async () => {
    await changeLanguage("zh");
  });
  expect(document.body.textContent).toContain("自定义暂缓时间");
  expect(document.body.textContent).toContain("小时");
  await act(async () => document.querySelector("form")!.requestSubmit());
  await expect(choice).resolves.toEqual({
    snoozedUntil: new Date(2026, 9, 9, 12, 0).toISOString(),
  });
});
it("localizes the date picker while cancellation leaves the request unchanged", async () => {
  let choice!: ReturnType<typeof requestCustomSnooze>;
  await act(async () => {
    choice = requestCustomSnooze();
    await changeLanguage("zh");
  });
  const dateButton = document.querySelector<HTMLButtonElement>("button[id$='-date']")!;
  expect(dateButton.textContent).toContain("2026年10月9日");
  await act(async () => dateButton.click());
  const next = document.querySelector<HTMLButtonElement>("button[aria-label='下个月']")!;
  expect(next).toBeDefined();
  await act(async () => next.click());
  expect(document.body.textContent).toContain("2026年11月");
  await act(async () => dateButton.click());
  await click("取消");
  await expect(choice).resolves.toBeNull();
});
