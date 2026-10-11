// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  refresh: vi.fn(),
  copy: vi.fn(),
  toast: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("~/assets/assetUrls", () => ({ useAssetUrlRefresh: () => state.refresh }));
vi.mock("~/hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({ copyToClipboard: state.copy, isCopied: false }),
}));
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: (select: (s: { wordWrap: boolean }) => unknown) => select({ wordWrap: false }),
  useUpdateClientSettings: () => vi.fn(),
}));
vi.mock("~/components/ui/toast", () => ({ toastManager: { add: state.toast } }));
vi.mock("./ReadOnlySourcePreview", () => ({
  default: ({ text }: { text: string }) => <pre>{text}</pre>,
}));

import { changeLanguage } from "~/i18n";
import { AttachmentFilePreview } from "./AttachmentFilePreview";

let root: Root;
let container: HTMLDivElement;
const url = "https://qa.test/raw-file.html";
const rawText = "<p>Keep raw text 原文 {{value}} & symbols</p>";
const render = () =>
  act(async () =>
    root.render(
      <AttachmentFilePreview
        name="附件 原文.html"
        mimeType="text/html"
        sizeBytes={100}
        asset={{
          environmentId: EnvironmentId.make("raw-environment"),
          attachmentId: "raw-attachment",
        }}
      />,
    ),
  );
const click = (label: string) =>
  act(async () => {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(button).not.toBeNull();
    button!.click();
  });
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.refresh.mockResolvedValue(url);
  state.fetch.mockImplementation(async () => new Response(rawText));
  vi.stubGlobal("fetch", state.fetch);
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

it("keeps the document and source across language changes without reauthorizing or refetching", async () => {
  await render();
  const frame = container.querySelector("iframe")!;
  await act(async () => changeLanguage("zh"));
  expect(container.querySelector("iframe")).toBe(frame);
  expect(frame.title).toBe("附件 原文.html");
  expect(state.refresh).toHaveBeenCalledTimes(1);
  await click("显示 HTML 源码");
  const source = container.querySelector("pre")!;
  expect(source.textContent).toBe(rawText);
  await act(async () => changeLanguage("en"));
  expect(container.querySelector("pre")).toBe(source);
  expect(state.fetch).toHaveBeenCalledExactlyOnceWith(
    url,
    expect.objectContaining({ cache: "default" }),
  );
  await click("Copy contents");
  expect(state.copy).toHaveBeenCalledExactlyOnceWith(rawText, undefined);
  await click("Show rendered page");
  expect(container.querySelector("iframe")?.getAttribute("src")).toBe(url);
  expect(state.refresh).toHaveBeenCalledTimes(1);
});

it("retranslates a stored error and retries only when the user clicks", async () => {
  state.refresh.mockResolvedValue(null);
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Reconnect to the environment and try again.",
  );
  await act(async () => changeLanguage("zh"));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "请重新连接执行环境后重试。",
  );
  expect(state.refresh).toHaveBeenCalledTimes(1);
  state.refresh.mockResolvedValue(url);
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(),
  );
  expect(state.refresh).toHaveBeenCalledTimes(2);
  expect(container.querySelector("iframe")?.title).toBe("附件 原文.html");
});

it("reports a failed download in the completion language and retains its diagnostic", async () => {
  await render();
  let fail!: (error: Error) => void;
  state.refresh.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  await click("Save file");
  await act(async () => changeLanguage("zh"));
  expect(state.refresh).toHaveBeenCalledTimes(2);
  expect(
    container.querySelector('button[aria-label="正在准备文件…"]')?.hasAttribute("disabled"),
  ).toBe(true);
  await act(async () => fail(new Error("EACCES: /原始路径/file.html")));
  expect(state.toast).toHaveBeenCalledWith({
    type: "error",
    title: "无法保存文件",
    description: "EACCES: /原始路径/file.html",
  });
  expect(state.fetch).not.toHaveBeenCalled();
  expect(container.querySelector('button[aria-label="保存文件"]')?.hasAttribute("disabled")).toBe(
    false,
  );
});
