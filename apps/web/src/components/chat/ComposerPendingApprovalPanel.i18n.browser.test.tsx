import "~/index.css";
import { act, render } from "../../../test/render";
import { RuntimeRequestId, type ProviderRequestKind } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { changeLanguage } from "../../i18n";
import { TimelinePendingApprovalRow } from "./TimelinePendingApprovalRow";

vi.mock("./timelineRowContext", async () => {
  const { createContext } = await import("react");
  return {
    TimelineRowCtx: createContext({
      respondingRequestIds: [],
      canOperateThread: false,
      onRespondToApproval: undefined,
    }),
  };
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
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await changeLanguage("en");
    });
    await changeLanguage("en");
    const detail = `bun run release -- ${"x".repeat(500)}\nsecond line`;
    const appName = "Custom application";
    // This row is tested without routing or granting any response permission.
    await using screen = await render(
      <TimelinePendingApprovalRow
        approval={{
          requestId: RuntimeRequestId.make("approval-1"),
          requestKind,
          createdAt: "2026-10-09T00:00:00Z",
          detail,
          appName,
          responseCapability: "live",
        }}
      />,
      { router: false },
    );
    await act(() => changeLanguage("zh"));
    await expect.element(screen.getByRole("group", { name: label })).toBeVisible();
    expect(screen.container.textContent).toContain(appName);
    expect(screen.container.querySelector("[data-approval-detail]")?.textContent).toBe(detail);
  },
);

it("explains an unavailable provider response without showing a misleading active command", async () => {
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(async () => {
    await changeLanguage("en");
  });
  await changeLanguage("en");
  // The isolated approval row has no navigation.
  await using screen = await render(
    <TimelinePendingApprovalRow
      approval={{
        requestId: RuntimeRequestId.make("approval-2"),
        requestKind: "file-read",
        createdAt: "2026-10-09T00:00:00Z",
        detail: "cat /tmp/file",
        responseCapability: "not_resumable",
      }}
    />,
    { router: false },
  );
  const detail = screen.container.querySelector("[data-approval-detail]");
  expect(detail?.textContent).toBe(
    "Provider process is gone. Interrupt or restart the run to respond.",
  );
  await act(() => changeLanguage("zh"));
  expect(screen.container.querySelector("[data-approval-detail]")).toBe(detail);
  expect(detail?.textContent).toBe("智能体提供方进程已退出。请中断或重新启动运行后再处理此请求。");
  expect(screen.container.textContent).not.toContain("cat /tmp/file");
});
