// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { changeLanguage } from "../../i18n";
import {
  finishRelayClientInstall,
  readRelayClientInstallDialogState,
  reportRelayClientInstallProgress,
  requestRelayClientInstallConfirmation,
  resetRelayClientInstallDialogForTests,
} from "../../cloud/relayClientInstallDialog";
import { RelayClientInstallDialog } from "./RelayClientInstallDialog";

let root: Root;
let container: HTMLDivElement;
const version = "2026.10.0-raw";

function button(label: string) {
  const element = [...document.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  );
  if (!element) throw new Error(`Missing action: ${label}`);
  return element;
}

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
  resetRelayClientInstallDialogForTests();
  await changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<RelayClientInstallDialog />));
});

afterEach(async () => {
  await act(async () => {
    finishRelayClientInstall();
    root.unmount();
  });
  container.remove();
  resetRelayClientInstallDialogForTests();
  await changeLanguage("en");
  vi.unstubAllGlobals();
});

it("switches the open confirmation without losing the requested version and returns a decline", async () => {
  let confirmation: Promise<boolean> | undefined;
  await act(async () => {
    confirmation = requestRelayClientInstallConfirmation(version);
  });
  expect(document.body.textContent).toContain(
    `T3 Code will download and install version ${version} locally.`,
  );
  await act(async () => {
    await changeLanguage("zh");
  });
  expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("安装中继客户端？");
  expect(document.body.textContent).toContain(`T3 Code 将在本地下载并安装 ${version} 版本。`);
  expect(readRelayClientInstallDialogState()).toEqual({ status: "confirming", version });
  await act(async () => button("取消").click());
  await expect(confirmation).resolves.toBe(false);
});

it("keeps installation progress while changing language and finishes the same controlled operation", async () => {
  let confirmation: Promise<boolean> | undefined;
  await act(async () => {
    confirmation = requestRelayClientInstallConfirmation(version);
  });
  await act(async () => button("Download and install").click());
  await expect(confirmation).resolves.toBe(true);
  await act(async () => {
    reportRelayClientInstallProgress({ type: "progress", stage: "downloading" });
  });
  expect(document.body.textContent).toContain("Downloading relay client");
  expect(document.body.textContent).toContain("3 of 7");
  await act(async () => {
    await changeLanguage("zh");
  });
  expect(document.body.textContent).toContain("正在下载中继客户端");
  expect(document.body.textContent).toContain("第 3 步，共 7 步");
  expect(document.querySelector("progress")?.getAttribute("aria-label")).toBe("中继客户端安装进度");
  expect(readRelayClientInstallDialogState()).toEqual({
    status: "installing",
    version,
    stage: "downloading",
  });
  expect(
    [...document.querySelectorAll("button")].some((element) =>
      /取消|Cancel/.test(element.textContent ?? ""),
    ),
  ).toBe(false);
  await act(async () => {
    reportRelayClientInstallProgress({ type: "progress", stage: "activating" });
  });
  expect(document.body.textContent).toContain("正在启用已安装的客户端");
  expect(document.querySelector("progress")?.value).toBe(7);
  await act(async () => {
    await changeLanguage("en");
  });
  expect(document.body.textContent).toContain("Activating installation");
  expect(document.querySelector("progress")?.getAttribute("aria-label")).toBe(
    "Relay client installation progress",
  );
  await act(async () => {
    finishRelayClientInstall();
  });
  expect(readRelayClientInstallDialogState().status).not.toBe("installing");
});
