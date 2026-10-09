// @vitest-environment jsdom
import { RuntimeRequestId, type ProviderRequestKind } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { changeLanguage } from "../../i18n";
import { ComposerPendingApprovalPanel } from "./ComposerPendingApprovalPanel";

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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

it.each([
  ["command", "命令执行审批"],
  ["file-read", "文件读取审批"],
  ["file-change", "文件修改审批"],
  ["mcp-elicitation", "应用访问审批"],
  ["permission", "应用权限审批"],
] satisfies Array<[ProviderRequestKind, string]>)(
  "updates %s labels while preserving the complete request",
  async (requestKind, label) => {
    const detail = `bun run release -- ${"x".repeat(500)}\nsecond line`;
    const appName = "Custom application";
    await act(async () =>
      root.render(
        <ComposerPendingApprovalPanel
          approval={{
            requestId: RuntimeRequestId.make("approval-1"),
            requestKind,
            createdAt: "2026-10-09T00:00:00Z",
            detail,
            appName,
            responseCapability: "live",
          }}
          pendingCount={1}
        />,
      ),
    );
    await act(async () => {
      await changeLanguage("zh");
    });
    expect(container.textContent).toContain(label);
    expect(container.textContent).toContain(appName);
    expect(container.querySelector("[data-approval-detail]")?.textContent).toBe(detail);
  },
);

it("explains an unavailable provider response without showing a misleading active command", async () => {
  await changeLanguage("zh");
  await act(async () =>
    root.render(
      <ComposerPendingApprovalPanel
        approval={{
          requestId: RuntimeRequestId.make("approval-2"),
          requestKind: "file-read",
          createdAt: "2026-10-09T00:00:00Z",
          detail: "cat /tmp/file",
          responseCapability: "not_resumable",
        }}
        pendingCount={1}
      />,
    ),
  );
  expect(container.textContent).toContain("智能体提供方进程已退出");
});
