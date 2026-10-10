// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { changeLanguage } from "~/i18n";
import { PreviewChromeRow } from "./PreviewChromeRow";

let root: Root;
let container: HTMLDivElement;
const submit = vi.fn();
const props = {
  url: "https://qa.test/路径?q={{raw}}",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  refreshDisabled: false,
  onBack: vi.fn(),
  onForward: vi.fn(),
  onRefresh: vi.fn(),
  onSubmit: submit,
};
const render = () => act(async () => root.render(<PreviewChromeRow {...props} />));
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
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
it("keeps an in-progress address edit through language changes and submits the raw destination once", async () => {
  await render();
  const input = container.querySelector<HTMLInputElement>("input")!;
  await act(async () => input.focus());
  const destination = "https://qa.test/new?q=原文&value={{x}}#anchor";
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      destination,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => changeLanguage("zh"));
  expect(container.querySelector("input")).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe(destination);
  expect(input.placeholder).toBe("搜索或输入网址");
  expect(submit).not.toHaveBeenCalled();
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    ),
  );
  expect(submit).toHaveBeenCalledExactlyOnceWith(destination);
  expect(input.value).toBe(props.url);
  await act(async () => input.focus());
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "discard this edit",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => changeLanguage("en"));
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    ),
  );
  expect(input.value).toBe(props.url);
  expect(submit).toHaveBeenCalledTimes(1);
});
