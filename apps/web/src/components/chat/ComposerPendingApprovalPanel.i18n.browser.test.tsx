import "~/index.css";
import { act, render as renderTestUi, type Screen } from "../../../test/render";
import { RuntimeRequestId, type ProviderRequestKind } from "@t3tools/contracts";

import { expect, it, vi } from "vite-plus/test";
import { changeLanguage } from "../../i18n";
import { ComposerPendingApprovalPanel } from "./ComposerPendingApprovalPanel";

let root: Screen;
let container: HTMLDivElement;

it.each([
  ["command", "命令执行审批"],
  ["file-read", "文件读取审批"],
  ["file-change", "文件修改审批"],
  ["mcp-elicitation", "应用访问审批"],
  ["permission", "应用权限审批"],
] satisfies Array<[ProviderRequestKind, string]>)(
  "updates %s labels while preserving the complete request",
  async (requestKind, label) => {
    await using _lifecycle = await setupLifecycle();

    const detail = `bun run release -- ${"x".repeat(500)}\nsecond line`;
    const appName = "Custom application";
    await act(async () =>
      root.rerender(
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
  await using _lifecycle = await setupLifecycle();

  await act(async () =>
    root.rerender(
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
  const detail = container.querySelector("[data-approval-detail]");
  expect(detail?.textContent).toBe(
    "Provider process is gone. Interrupt or restart the run to respond.",
  );
  await act(() => changeLanguage("zh"));
  expect(container.querySelector("[data-approval-detail]")).toBe(detail);
  expect(detail?.textContent).toBe("智能体提供方进程已退出。请中断或重新启动运行后再处理此请求。");
  expect(container.textContent).not.toContain("cat /tmp/file");
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
  container = document.createElement("div");
  document.body.append(container);
  root = renderStack.use(await renderTestUi(null, { container: container, router: false }));

  renderStack = stack.move();
  return renderStack;
}
