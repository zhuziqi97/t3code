// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { requestConfirmDialog, resetConfirmDialogForTests } from "../confirmDialog";
import { changeLanguage } from "../i18n";
import { ConfirmDialogHost } from "./ConfirmDialogHost";

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
  resetConfirmDialogForTests();
  await changeLanguage("zh");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ConfirmDialogHost />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  resetConfirmDialogForTests();
  await changeLanguage("en");
  vi.unstubAllGlobals();
});

it.each([
  ["确认", true],
  ["取消", false],
] as const)(
  "shows the Chinese restore question as the title and responds to %s",
  async (label, confirmed) => {
    let answer: Promise<boolean> | undefined;
    await act(async () => {
      answer = requestConfirmDialog("恢复默认设置？\n以下设置将被重置：语言。");
    });
    expect(document.querySelector('[role="alertdialog"] h2')?.textContent).toBe("恢复默认设置？");
    expect(document.body.textContent).toContain("以下设置将被重置：语言。");
    const button = [...document.querySelectorAll("button")].find(
      (element) => element.textContent === label,
    )!;
    await act(async () => button.click());
    await expect(answer).resolves.toBe(confirmed);
  },
);

it("updates generic confirmation controls with the language while preserving the caller message", async () => {
  await act(async () => {
    requestConfirmDialog("raw operation details");
  });
  expect(document.body.textContent).toContain("确认操作");
  await act(async () => {
    await changeLanguage("en");
  });
  expect(document.body.textContent).toContain("Confirm action");
  expect(document.body.textContent).toContain("raw operation details");
  expect([...document.querySelectorAll("button")].map((element) => element.textContent)).toEqual(
    expect.arrayContaining(["Confirm", "Cancel"]),
  );
});
