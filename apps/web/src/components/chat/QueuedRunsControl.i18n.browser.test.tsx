import "~/index.css";
import { act, render as renderTestUi } from "../../../test/render";

import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { changeLanguage } from "../../i18n";

import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  projection: null as unknown,
  workflow: null as unknown,
  command: vi.fn(async (_command: unknown, _request: unknown) => undefined),
}));

vi.mock("@t3tools/client-runtime/state/thread-workflows", async (original) => ({
  ...(await original<typeof import("@t3tools/client-runtime/state/thread-workflows")>()),
  deriveThreadQueueWorkflowState: () => state.workflow,
}));

vi.mock("../../state/entities", async (original) => ({
  ...(await original<typeof import("../../state/entities")>()),
  useThreadProjection: () => state.projection,
}));

vi.mock("../../state/threads", async (original) => ({
  ...(await original<typeof import("../../state/threads")>()),
  threadEnvironment: {
    cancelQueuedRun: Symbol("cancelQueuedRun"),
    promoteQueuedRun: Symbol("promoteQueuedRun"),
    reorderQueuedRun: Symbol("reorderQueuedRun"),
  },
}));

vi.mock("../../state/use-atom-command", async (original) => ({
  ...(await original<typeof import("../../state/use-atom-command")>()),
  useAtomCommand: (command: unknown) => (request: unknown) => state.command(command, request),
}));

vi.mock("../../assets/assetUrls", async (original) => ({
  ...(await original<typeof import("../../assets/assetUrls")>()),
  useAssetUrls: (_environmentId: never, resources: ReadonlyArray<{ attachmentId: string }>) =>
    resources.map((resource) => `https://assets.test/${resource.attachmentId}`),
}));

import { QueuedRunsControl } from "./QueuedRunsControl";

it("keeps queue state and provider commands intact while switching Chinese and English", async () => {
  await using _lifecycle = await setupLifecycle();

  const container = document.createElement("div");
  document.body.append(container);
  const root = renderStack.use(await renderTestUi(null, { container: container, router: false }));
  const edit = vi.fn();
  state.command.mockClear();
  const attachment = {
    type: "image",
    id: "image-1",
    name: "原始 screenshot.png",
    mimeType: "image/png",
    sizeBytes: 128,
  };
  state.projection = { projection: { messages: [] } };
  state.workflow = {
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    canReorder: true,
    queuedRuns: [
      {
        run: { id: "run:queued", userMessageId: "message:queued" },
        text: "保持 user prompt 原文",
        attachments: [attachment],
      },
      ...[2, 3, 4].map((ordinal) => ({
        run: { id: `run:queued-${ordinal}`, userMessageId: `message:queued-${ordinal}` },
        text: `Raw queued message ${ordinal}`,
        attachments: [],
      })),
    ],
  };
  async function click(label: string) {
    const button = [...container.querySelectorAll("button")].find(
      (button) =>
        button.getAttribute("aria-label") === label || button.textContent?.trim() === label,
    );
    expect(button, label).toBeDefined();
    await act(async () => button!.click());
  }
  try {
    await changeLanguage("en");
    await act(async () =>
      root.rerender(
        <QueuedRunsControl
          editBlockedReason={null}
          environmentId={EnvironmentId.make("environment:test")}
          threadId={ThreadId.make("thread:test")}
          optimisticMessages={[]}
          editingRunId={null}
          onEditQueuedRun={edit}
          onCancelEdit={() => {}}
        />,
      ),
    );
    await click("Show all 4 queued");
    await act(async () => {
      await changeLanguage("zh");
    });
    expect(container.textContent).toContain("Raw queued message 4");
    await click("收起");
    expect(container.textContent).not.toContain("Raw queued message 4");
    await click("显示全部 4 条排队消息");
    expect(container.textContent).toContain("保持 user prompt 原文");
    await click("编辑排队消息");
    expect(edit).toHaveBeenCalledWith({
      runId: "run:queued",
      messageId: "message:queued",
      text: "保持 user prompt 原文",
      attachments: [attachment],
    });
    await click("引导");
    expect(state.command).toHaveBeenLastCalledWith(expect.any(Symbol), {
      environmentId: "environment:test",
      input: { threadId: "thread:test", queuedRunId: "run:queued", targetRunId: "run:active" },
    });
    await act(async () => {
      await changeLanguage("en");
    });
    expect(container.textContent).toContain("保持 user prompt 原文");
    await click("Remove queued message");
    expect(state.command).toHaveBeenLastCalledWith(expect.any(Symbol), {
      environmentId: "environment:test",
      input: { threadId: "thread:test", runId: "run:queued" },
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    await changeLanguage("en");
  }
});

let renderStack: AsyncDisposableStack;
async function setupLifecycle() {
  await using stack = new AsyncDisposableStack();
  renderStack = stack;
  stack.defer(async () => {});

  renderStack = stack.move();
  return renderStack;
}
