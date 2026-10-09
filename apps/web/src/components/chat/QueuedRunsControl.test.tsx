// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { changeLanguage } from "../../i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  projection: null as unknown,
  workflow: null as unknown,
  command: vi.fn(async (_command: unknown, _request: unknown) => undefined),
}));

vi.mock("@t3tools/client-runtime/environment", () => ({
  scopeThreadRef: () => ({}) as never,
}));

vi.mock("@t3tools/client-runtime/state/thread-workflows", () => ({
  deriveThreadQueueWorkflowState: () => state.workflow,
}));

vi.mock("../../state/entities", () => ({
  useThreadProjection: () => state.projection,
}));

vi.mock("../../state/threads", () => ({
  threadEnvironment: {
    cancelQueuedRun: Symbol("cancelQueuedRun"),
    promoteQueuedRun: Symbol("promoteQueuedRun"),
    reorderQueuedRun: Symbol("reorderQueuedRun"),
  },
}));

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) => (request: unknown) => state.command(command, request),
}));

vi.mock("../../assets/assetUrls", () => ({
  useAssetUrls: (_environmentId: never, resources: ReadonlyArray<{ attachmentId: string }>) =>
    resources.map((resource) => `https://assets.test/${resource.attachmentId}`),
}));

import { QueuedRunsControl } from "./QueuedRunsControl";

describe("QueuedRunsControl automatic completion delivery", () => {
  it("does not render a queue control when only hidden delivery remains", () => {
    state.projection = {
      projection: {
        messages: [
          {
            delegatedCompletion: {
              parentRunId: "run:parent",
              generation: 1,
              taskIds: ["task:child"],
            },
            id: "message:completion",
          },
        ],
      },
    };
    state.workflow = {
      activeRun: { id: "run:active" },
      canPromoteToSteer: true,
      canReorder: true,
      queuedRuns: [],
    };

    const html = renderToStaticMarkup(
      <QueuedRunsControl
        environmentId={"environment:test" as never}
        optimisticMessages={[]}
        threadId={"thread:test" as never}
        editingRunId={null}
        onEditQueuedRun={() => undefined}
        onCancelEdit={() => undefined}
      />,
    );

    expect(html).toBe("");
  });
});

describe("QueuedRunsControl attachments and edit mode", () => {
  const workflowWithAttachment = () => ({
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    canReorder: true,
    queuedRuns: [
      {
        run: { id: "run:queued", userMessageId: "message:queued" },
        text: "Queued with a screenshot",
        attachments: [
          {
            type: "image",
            id: "attachment-1",
            name: "screenshot.png",
            mimeType: "image/png",
            sizeBytes: 128,
          },
        ],
      },
    ],
  });

  it("renders an attachment thumbnail on the queued row", () => {
    state.projection = { projection: { messages: [] } };
    state.workflow = workflowWithAttachment();

    const html = renderToStaticMarkup(
      <QueuedRunsControl
        environmentId={"environment:test" as never}
        optimisticMessages={[]}
        threadId={"thread:test" as never}
        editingRunId={null}
        onEditQueuedRun={() => undefined}
        onCancelEdit={() => undefined}
      />,
    );

    expect(html).toContain("https://assets.test/attachment-1");
    expect(html).toContain("Queued with a screenshot");
    expect(html).toContain("Edit queued message");
    expect(html).toContain("Reorder queued message");
    expect(html).not.toContain("Move queued message up");
  });

  it("drops the optimistic pending row once the projection holds its message", () => {
    state.projection = {
      projection: { messages: [{ id: "message:acknowledged", text: "hello" }] },
    };
    state.workflow = {
      activeRun: { id: "run:active" },
      canPromoteToSteer: true,
      canReorder: true,
      queuedRuns: [],
    };

    const html = renderToStaticMarkup(
      <QueuedRunsControl
        environmentId={"environment:test" as never}
        optimisticMessages={[
          {
            id: "message:acknowledged" as never,
            inputIntent: "queued_turn",
            text: "hello",
            attachments: [],
          },
        ]}
        threadId={"thread:test" as never}
        editingRunId={null}
        onEditQueuedRun={() => undefined}
        onCancelEdit={() => undefined}
      />,
    );

    expect(html).toBe("");
  });

  it("keeps the original queued message visible while editing", () => {
    state.projection = { projection: { messages: [] } };
    state.workflow = workflowWithAttachment();

    const html = renderToStaticMarkup(
      <QueuedRunsControl
        environmentId={"environment:test" as never}
        optimisticMessages={[]}
        threadId={"thread:test" as never}
        editingRunId={"run:queued" as never}
        onEditQueuedRun={() => undefined}
        onCancelEdit={() => undefined}
      />,
    );

    expect(html).toContain("Queued with a screenshot");
  });
});

it("keeps queue state and provider commands intact while switching Chinese and English", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
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
      root.render(
        <QueuedRunsControl
          environmentId={EnvironmentId.make("environment:test")}
          threadId={ThreadId.make("thread:test")}
          optimisticMessages={[]}
          editingRunId={null}
          onEditQueuedRun={edit}
          onCancelEdit={() => {}}
        />,
      ),
    );
    await click("Collapse queued messages");
    await act(async () => {
      await changeLanguage("zh");
    });
    await click("展开排队消息");
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
