// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { changeLanguage } from "~/i18n";
import { PreviewUnreachable } from "./PreviewUnreachable";

let root: Root;
let container: HTMLDivElement;
const reload = vi.fn();
const click = (label: string) =>
  act(async () => {
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === label);
    expect(button).toBeDefined();
    button!.click();
  });
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
it("keeps expanded details across language changes and only retries on user input", async () => {
  await act(async () =>
    root.render(
      <PreviewUnreachable
        url="http://qa.test:1234/raw"
        code={-102}
        description="ERR_CONNECTION_REFUSED"
        onReload={reload}
      />,
    ),
  );
  await click("Details");
  await act(async () => changeLanguage("zh"));
  expect(container.textContent).toContain("qa.test:1234：连接被拒绝。");
  expect(container.textContent).toContain("ERR_CONNECTION_REFUSED");
  expect(container.textContent).toContain("隐藏详情");
  expect(reload).not.toHaveBeenCalled();
  await click("隐藏详情");
  await click("重新加载");
  expect(reload).toHaveBeenCalledTimes(1);
  await act(async () =>
    root.render(
      <PreviewUnreachable
        url="http://qa.test:1234/raw"
        code={-999}
        description="Raw diagnostic 原文 {{x}} & detail"
        onReload={reload}
      />,
    ),
  );
  expect(container.textContent).toContain("Raw diagnostic 原文 {{x}} & detail");
  await act(async () => changeLanguage("en"));
  expect(container.textContent).toContain("qa.test:1234: Raw diagnostic 原文 {{x}} & detail.");
  expect(reload).toHaveBeenCalledTimes(1);
});
