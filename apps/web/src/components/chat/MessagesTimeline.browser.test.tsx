import { ScheduledTaskId } from "@t3tools/contracts";
import { userEvent } from "vite-plus/test/browser";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";

import { EnvironmentId, MessageId, RunId, ThreadId } from "@t3tools/contracts";

import type { LegendListRef } from "@legendapp/list/react";
import { createRef, Profiler, type ComponentProps, type ReactElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { act, render } from "../../../test/render";
import { MessagesTimeline } from "./MessagesTimeline";
import { remarkThoughtPreview } from "./TimelineWorkEntryRow.logic";
import { parseMarkdownWithMath } from "@t3tools/shared/markdownMath";
import { collectThreadFindRanges } from "./threadFindHighlights";

const environmentQuery = vi.hoisted(() => ({
  error: "Pull request not found",
  data: null as unknown,
}));
vi.mock(import("~/state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: (() => ({
    data: environmentQuery.data,
    dataUpdatedAt: 0,
    error: environmentQuery.error,
    failure: null,
    isPending: false,
    isSuccess: false,
    refresh: () => {},
  })) as never,
}));

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const CREATED_AT = "2026-03-17T19:12:28.000Z";

type TimelineProps = ComponentProps<typeof MessagesTimeline>;
type Entry = TimelineProps["timelineEntries"][number];

// The timeline remembers scroll position and open disclosures per thread key,
// so every render gets a fresh thread.
function baseProps(): Omit<TimelineProps, "timelineEntries"> {
  return {
    isWorking: false,
    activeTurnInProgress: false,
    listRef: createRef<LegendListRef | null>(),
    latestRun: null,
    turnDiffSummaries: [],
    runs: [],
    routeThreadKey: `environment-local:thread-${Math.random().toString(36).slice(2)}`,
    onOpenTurnDiff: () => {},
    onOpenThread: () => {},
    onForkFromRun: async () => {},
    onRollbackCheckpoint: () => {},
    supportsConversationRollback: false,
    onRevertToTurnCount: () => {},
    isRevertingCheckpoint: false,
    onImageExpand: () => {},
    activeThreadEnvironmentId: ENVIRONMENT_ID,
    markdownCwd: undefined,
    resolvedTheme: "light",
    timestampFormat: "locale",
    workspaceRoot: undefined,
    anchorMessageId: null,
    onAnchorReady: () => {},
    onAnchorSizeChanged: () => {},
    contentInsetEndAdjustment: 0,
    emptyPlaceholderInset: 0,
    liveFollowEnabled: true,
    onIsAtEndChange: () => {},
    onManualNavigation: () => {},
  };
}

function message(
  text: string,
  overrides: Partial<Extract<Entry, { kind: "message" }>["message"]> = {},
  id = "message-1",
): Entry {
  return {
    id: `entry-${id}`,
    kind: "message",
    createdAt: CREATED_AT,
    message: {
      id: MessageId.make(id),
      role: "user",
      text,
      runId: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      streaming: false,
      ...overrides,
    },
  };
}

async function renderElement(element: ReactElement) {
  const container = document.createElement("div");
  container.style.cssText = "height: 1200px; width: 900px; display: flex; flex-direction: column;";
  const screen = await render(element, { container });
  const buttons = (name: string | RegExp) =>
    [...container.querySelectorAll<HTMLElement>("button, [role=button]")].filter((button) => {
      const label = button.getAttribute("aria-label") ?? button.textContent ?? "";
      return typeof name === "string" ? label === name : name.test(label);
    });
  return Object.assign(screen, {
    text: () => container.textContent ?? "",
    buttons,
    button: (name: string | RegExp) => {
      const [match] = buttons(name);
      if (!match) throw new Error(`Missing button: ${String(name)}`);
      return match;
    },
  });
}

function renderTimeline(entries: ReadonlyArray<Entry>, props: Partial<TimelineProps> = {}) {
  return renderElement(
    <MessagesTimeline {...baseProps()} timelineEntries={entries as Entry[]} {...props} />,
  );
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

function setup({ scheduledTasks = [] as ReadonlyArray<{ id: string; title: string }> } = {}) {
  environmentQuery.data = { tasks: scheduledTasks };
}

const TASK_ID = ScheduledTaskId.make("task-1");
const AUTOMATION_PROMPT = "Triage the inbox\n\nLabel every new issue and close duplicates.";

describe("MessagesTimeline messages", () => {
  it("settles when equally long messages have very different rendered heights", async () => {
    const props = baseProps();
    const tall = message("a\n\n".repeat(6000), { role: "assistant" }, "tall");
    const earlier = Array.from({ length: 80 }, (_, index) =>
      message(
        `<details><summary>Reply ${index}</summary>${"compact ".repeat(2250)}</details>`,
        { role: "assistant" },
        `earlier-${index}`,
      ),
    );
    let nestedCommits = 0;
    let maxNestedCommits = 0;
    const onRender = (_id: string, phase: string) => {
      nestedCommits = phase === "nested-update" ? nestedCommits + 1 : 0;
      maxNestedCommits = Math.max(maxNestedCommits, nestedCommits);
    };
    const timeline = (entries: Entry[]) => (
      <Profiler id="timeline" onRender={onRender}>
        <MessagesTimeline {...props} timelineEntries={entries} />
      </Profiler>
    );
    await using screen = await renderElement(timeline([tall]));
    await vi.waitFor(() =>
      expect(props.listRef.current?.getState().sizeAtIndex(0)).toBeGreaterThan(100_000),
    );
    const viewport = props.listRef.current!.getScrollableNode()!;
    await act(() => {
      viewport.scrollTop = 0;
      viewport.dispatchEvent(new Event("scroll"));
    });
    await screen.rerender(timeline([...earlier, tall]));
    await act(() => {
      void props.listRef.current!.scrollToIndex({ index: 0, animated: false });
    });
    await vi.waitFor(async () => {
      await act(() => {
        viewport.scrollTop = 0;
        viewport.dispatchEvent(new Event("scroll"));
      });
      expect(screen.text().includes("Reply 0")).toBe(true);
      expect(props.listRef.current!.getState().sizeAtIndex(0)).toBeGreaterThan(0);
    });
    expect(maxNestedCommits).toBeLessThan(20);
  });

  it("preserves XML-like tags and comparisons in user messages as text", async () => {
    const source = [
      'Without reading a file, do you have <global-agent-instructions scope="workspace">',
      'Before <nested data-value="a&b">inside</nested> after',
      "</global-agent-instructions> in your context?",
      "Comparison: 2 < 3 and 5 > 4.",
    ];
    await using screen = await renderTimeline([message(source.join("\n"))]);
    for (const line of source) expect(screen.text()).toContain(line);
    expect(screen.container.querySelector("global-agent-instructions, nested")).toBeNull();
  });

  it("renders unsafe user HTML as inert source text", async () => {
    const source =
      '<script>globalThis.__t3Xss = 1</script><img src="x" onerror="globalThis.__t3Xss = 2">';
    await using screen = await renderTimeline([message(source)]);
    expect(screen.text()).toContain(source);
    expect(screen.container.querySelector("script, img")).toBeNull();
    expect((globalThis as { __t3Xss?: number }).__t3Xss).toBeUndefined();
  });

  it("renders sanitized raw HTML in assistant messages", async () => {
    await using screen = await renderTimeline([
      message(
        [
          '<details onclick="globalThis.__t3Xss = 1">',
          "<summary>Safe details</summary>",
          "<script>globalThis.__t3Xss = 2</script>",
          '<img src="x" onerror="globalThis.__t3Xss = 3">',
          '<a href="javascript:globalThis.__t3Xss = 4">Unsafe link</a>',
          "</details>",
        ].join(""),
        { role: "assistant" },
      ),
    ]);
    expect(screen.container.querySelector("[data-markdown-details]")?.textContent).toContain(
      "Safe details",
    );
    expect(screen.text()).not.toContain("<details");
    expect(screen.container.querySelector("script, [onclick], [onerror]")).toBeNull();
    expect(screen.container.innerHTML).not.toContain("javascript:");
    await click(screen.button("Safe details"));
    expect((globalThis as { __t3Xss?: number }).__t3Xss).toBeUndefined();
  });
});

describe("MessagesTimeline automation prompts", () => {
  it("folds an automation prompt into a bubble titled by its task", async () => {
    setup({ scheduledTasks: [{ id: TASK_ID, title: "Nightly triage" }] });
    await using screen = await renderTimeline([
      message(AUTOMATION_PROMPT, { scheduledTaskId: TASK_ID }),
    ]);
    const row = screen.button(/^Automation/);
    expect(row.textContent).toContain("Nightly triage");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(screen.text()).not.toContain("close duplicates");

    await click(row);
    expect(screen.text()).toContain("Label every new issue and close duplicates.");
    const link = [...screen.container.querySelectorAll("a")].find(
      (anchor) => anchor.textContent === "Open automation",
    );
    expect(link?.getAttribute("href")).toContain(`taskId=${TASK_ID}`);
    expect(screen.buttons(/copy/i)).not.toHaveLength(0);
  });

  it("falls back to the prompt's first line without a task title", async () => {
    setup();
    await using screen = await renderTimeline([
      message(AUTOMATION_PROMPT, { scheduledTaskId: TASK_ID }),
    ]);
    expect(screen.button(/^Automation/).textContent).toContain("Triage the inbox");
  });

  it("leaves ordinary user messages as full bubbles", async () => {
    setup();
    await using screen = await renderTimeline([message(AUTOMATION_PROMPT)]);
    expect(screen.buttons(/^Automation/)).toHaveLength(0);
    expect(screen.text()).toContain("Label every new issue and close duplicates.");
  });

  it("reveals a find match beyond the folded automation prompt's initial viewport", async () => {
    setup();
    const prompt = `${"Inspect the next item.\n\n".repeat(16)}Close duplicates.`;
    await using screen = await renderTimeline([message(prompt, { scheduledTaskId: TASK_ID })], {
      findExpanded: true,
      findQuery: "duplicates",
      activeFindMatch: { entryId: "entry-message-1", runId: null, occurrence: 0 },
    });
    await vi.waitFor(() =>
      expect(screen.button(/^Automation/).getAttribute("aria-expanded")).toBe("true"),
    );
    const { range } = collectThreadFindRanges(screen.container, "duplicates")[0]!;
    const details = screen.container.querySelector("[data-thread-find-text]")!;
    expect(range.getBoundingClientRect().top - details.getBoundingClientRect().top).toBeGreaterThan(
      384,
    );
    expect(range.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      details.getBoundingClientRect().bottom,
    );
  });

  it("shows edit-from-here once an automation prompt is expanded", async () => {
    setup();
    const runId = RunId.make("run-1");
    await using screen = await renderTimeline(
      [
        message(
          AUTOMATION_PROMPT,
          { scheduledTaskId: TASK_ID, runId, inputIntent: "turn_start" },
          "user-1",
        ),
        message("Done", { role: "assistant", runId }, "assistant-1"),
      ],
      {
        latestRun: { runId, status: "running", startedAt: CREATED_AT, completedAt: null },
      },
    );
    expect(screen.text()).toContain("Current response remains visible");
    expect(screen.text()).not.toContain("Partial response from the old attempt");
    const disclosure = screen.button(/Superseded attempt/);
    expect(disclosure.textContent).toContain("Cut off by a steer");
    await click(disclosure);
    expect(screen.text()).toContain("Partial response from the old attempt");
  });

  it("forks from a completed assistant response", async () => {
    const onForkFromRun = vi.fn(async () => {});
    await using screen = await renderTimeline(
      [
        {
          ...message("Done", { role: "assistant", runId: RunId.make("run-1") }, "assistant-1"),
          projectedItem: v2Item("assistant_message", {
            id: "assistant-item-1",
            messageId: "assistant-1",
            text: "Done",
            streaming: false,
          }),
        } as Entry,
      ],
      {
        onForkFromRun,
        latestRun: {
          runId: RunId.make("run-1"),
          status: "completed",
          startedAt: CREATED_AT,
          completedAt: CREATED_AT,
        },
      },
    );
    using clipboard = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await expect.element(screen.getByText("Turn ended", { exact: true })).toBeVisible();
    const meta = screen.container.querySelector<HTMLElement>(
      '[data-testid="latest-run-end-state"]',
    )!;
    expect(meta.querySelectorAll("time")).toHaveLength(1);
    expect(meta.querySelectorAll("button")[0]?.getAttribute("aria-label")).toBe("Copy message");
    expect(meta.querySelectorAll("button")[1]?.getAttribute("aria-label")).toBe(
      "Fork from this response",
    );
    expect(getComputedStyle(meta).opacity).toBe("1");
    const time = meta.querySelector("time")!.getBoundingClientRect();
    const status = meta.querySelector('[role="status"]')!.getBoundingClientRect();
    expect(Math.abs(time.top - status.top)).toBeLessThan(2);
    screen.container.style.width = "170px";
    await screen.rerender(
      <MessagesTimeline
        {...baseProps()}
        timelineEntries={[
          {
            ...message("Done", { role: "assistant", runId: RunId.make("run-1") }, "assistant-1"),
            projectedItem: v2Item("assistant_message", {
              id: "assistant-item-1",
              messageId: "assistant-1",
              text: "Done",
              streaming: false,
            }),
          } as Entry,
        ]}
        onForkFromRun={onForkFromRun}
        latestRun={{
          runId: RunId.make("run-1"),
          status: "completed",
          startedAt: CREATED_AT,
          completedAt: CREATED_AT,
        }}
      />,
    );
    await expect.element(screen.getByText("Turn ended", { exact: true })).toBeVisible();
    const narrowMeta = screen.container.querySelector<HTMLElement>(
      '[data-testid="latest-run-end-state"]',
    )!;
    expect(narrowMeta.scrollWidth).toBeLessThanOrEqual(narrowMeta.clientWidth + 1);
    expect(
      narrowMeta.querySelector('[role="status"]')!.getBoundingClientRect().top,
    ).toBeGreaterThanOrEqual(narrowMeta.querySelector("time")!.getBoundingClientRect().top);
    await click(screen.button("Copy message"));
    expect(clipboard).toHaveBeenCalledWith("Done");
    await click(screen.button("Fork from this response"));
    expect(onForkFromRun).toHaveBeenCalledWith({ sourceThreadId: "thread-1", runId: "run-1" });
  });

  it("opens the changed files of an assistant response", async () => {
    const assistantMessageId = MessageId.make("assistant-with-files");
    const runId = RunId.make("run-with-files");
    const onOpenTurnDiff = vi.fn();
    await using screen = await renderTimeline(
      [message("Updated the fixture.", { role: "assistant", runId }, assistantMessageId)],
      {
        onOpenTurnDiff,
        latestRun: { runId, status: "completed", startedAt: CREATED_AT, completedAt: CREATED_AT },
        turnDiffSummaries: [
          {
            runId,
            checkpointTurnCount: 1,
            checkpointRef: "checkpoint-1" as never,
            status: "ready",
            files: [],
            assistantMessageId: MessageId.make("assistant-1"),
            completedAt: CREATED_AT,
          },
        ],
      },
    );
    expect(screen.buttons("Edit from here")).toHaveLength(0);
    await click(screen.button(/^Automation/));
    expect(screen.buttons("Edit from here")).toHaveLength(1);
  });
});

const SENDER_THREAD_ID = ThreadId.make("thread-sender");
const AGENT_MESSAGE = "Review finished\n\nThe migration drops the index before backfilling it.";

describe("MessagesTimeline agent messages", () => {
  it("folds a message from another agent into a one-line preview", async () => {
    setup();
    const onOpenThread = vi.fn();
    await using screen = await renderTimeline(
      [message(AGENT_MESSAGE, { createdBy: "agent", senderThreadId: SENDER_THREAD_ID })],
      { onOpenThread },
    );
    const row = screen.button(/^Agent/);
    expect(row.textContent).toContain("Review finished");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(screen.text()).not.toContain("drops the index");
    expect(screen.buttons("Open thread")).toHaveLength(0);

    await click(row);
    expect(screen.text()).toContain("The migration drops the index before backfilling it.");
    await click(screen.button("Open thread"));
    expect(onOpenThread).toHaveBeenCalledWith(SENDER_THREAD_ID);

    await click(screen.button(/^Agent/));
    expect(screen.text()).not.toContain("drops the index");
  });

  it("leaves messages sent by T3 Code as full bubbles", async () => {
    setup();
    await using screen = await renderTimeline([
      message(AGENT_MESSAGE, { createdBy: "agent", creationSource: "server" }),
    ]);
    expect(screen.buttons(/^Agent/)).toHaveLength(0);
    expect(screen.text()).toContain("drops the index");
  });

  it("reveals a find match inside a folded agent message", async () => {
    setup();
    const text = `${"Checked the next file.\n\n".repeat(16)}The migration drops the index.`;
    await using screen = await renderTimeline(
      [message(text, { createdBy: "agent", senderThreadId: SENDER_THREAD_ID })],
      {
        findExpanded: true,
        findQuery: "drops the index",
        activeFindMatch: { entryId: "entry-message-1", runId: null, occurrence: 0 },
      },
    );
    await vi.waitFor(() =>
      expect(screen.button(/^Agent/).getAttribute("aria-expanded")).toBe("true"),
    );
    const { range } = collectThreadFindRanges(screen.container, "drops the index")[0]!;
    const body = screen.container.querySelector("[data-user-message-body]")!;
    expect(range.getBoundingClientRect().height).toBeGreaterThan(0);
    expect(range.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      body.getBoundingClientRect().bottom,
    );
  });
});

describe("compact reasoning math", () => {
  it("keeps formulas while flattening compact reasoning previews", () => {
    const tree = parseMarkdownWithMath("## Reasoning\n\nUse **norm** $|x|$ and \\[x^2\\]");
    remarkThoughtPreview("Reasoning")(tree);
    expect(tree.children.map((node) => node.type)).toEqual([
      "text",
      "inlineMath",
      "text",
      "inlineMath",
    ]);
    expect(tree.children.map((node) => ("value" in node ? node.value : null))).toEqual([
      "Reasoning Use norm ",
      "|x|",
      " and ",
      "x^2",
    ]);
  });
});

describe("localized work groups", () => {
  it("updates a mounted group without losing expansion or changing command text", async () => {
    const { i18n } = await import("~/i18n");
    await using root = await renderElement(<div />);
    const container = root.container;
    const commands = ['printf "Keep command 原文"', "node scripts/raw-example.mjs"];
    try {
      await act(async () => {
        await i18n.changeLanguage("en");
        await root.rerender(
          <MessagesTimeline
            {...baseProps()}
            timelineEntries={commands.map((command, index) => ({
              id: `entry-localized-${index}`,
              kind: "work" as const,
              createdAt: CREATED_AT,
              entry: {
                id: `work-localized-${index}`,
                createdAt: CREATED_AT,
                label: command,
                tone: "tool" as const,
                itemType: "command_execution" as const,
                command,
                toolLifecycleStatus: "completed" as const,
              },
            }))}
          />,
        );
      });
      const group = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Ran 2 commands"]',
      )!;
      expect(group).not.toBeNull();
      expect(group.getAttribute("aria-expanded")).toBe("false");
      await act(() => group.click());
      expect(group.getAttribute("aria-expanded")).toBe("true");
      await expect.element(root.getByText(commands[0]!, { exact: true })).toBeVisible();
      await act(async () => {
        await i18n.changeLanguage("zh");
      });
      expect(container.querySelector('button[aria-label="运行了 2 条命令"]')).toBe(group);
      expect(group.getAttribute("aria-expanded")).toBe("true");
      await expect.element(root.getByText(commands[0]!, { exact: true })).toBeVisible();
      await expect.element(root.getByText(commands[1]!, { exact: true })).toBeVisible();
      await act(async () => {
        await i18n.changeLanguage("en");
      });
      expect(group.getAttribute("aria-label")).toBe("Ran 2 commands");
      expect(group.getAttribute("aria-expanded")).toBe("true");
      await act(() => group.click());
      expect(group.getAttribute("aria-expanded")).toBe("false");
    } finally {
      await act(async () => {
        await root.unmount();
        await i18n.changeLanguage("en");
      });
      container.remove();
      vi.unstubAllGlobals();
    }
  });
  it("retranslates a standalone T3 tool while preserving expanded data and returned failure", async () => {
    const { i18n } = await import("~/i18n");
    await using root = await renderElement(<div />);
    const container = root.container;
    const args = { cwd: "/tmp/原始项目", title: "Keep project title 原文" };
    const renderTool = (failed: boolean) =>
      root.rerender(
        <MessagesTimeline
          {...baseProps()}
          timelineEntries={[
            {
              id: "tool-localized",
              kind: "work",
              createdAt: CREATED_AT,
              entry: {
                id: "tool-localized",
                createdAt: CREATED_AT,
                label: "Custom provider title",
                tone: "tool",
                itemType: "dynamic_tool",
                toolLifecycleStatus: "completed",
                ...(failed ? { detail: "Original diagnostic 原文" } : {}),
                toolData: {
                  server: "t3-code",
                  tool: "t3_project_create",
                  input: args,
                  result: failed
                    ? { isError: true, message: "Original diagnostic 原文" }
                    : { id: "raw-project-id" },
                },
              },
            },
          ]}
        />,
      );
    try {
      await act(async () => {
        await i18n.changeLanguage("en");
        await renderTool(false);
      });
      const header = container.querySelector<HTMLElement>(
        '[role="button"][aria-label="Registered a project"]',
      )!;
      expect(header).not.toBeNull();
      await act(() => header.click());
      expect(header.getAttribute("aria-expanded")).toBe("true");
      expect(container.textContent).toContain("/tmp/原始项目");
      await act(async () => {
        await i18n.changeLanguage("zh");
      });
      expect(container.querySelector('[role="button"][aria-label="已注册项目"]')).toBe(header);
      expect(header.getAttribute("aria-expanded")).toBe("true");
      expect(container.textContent).toContain("Keep project title 原文");
      await act(() => renderTool(true));
      expect(header.getAttribute("aria-label")).toBe("注册项目失败，工具调用失败");
      expect(container.textContent).toContain("Original diagnostic 原文");
      await act(async () => {
        await i18n.changeLanguage("en");
      });
      expect(header.getAttribute("aria-label")).toBe(
        "Failed to register a project, tool call failed",
      );
      expect(header.getAttribute("aria-expanded")).toBe("true");
    } finally {
      await act(async () => {
        await root.unmount();
        await i18n.changeLanguage("en");
      });
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});

describe("latest run end feedback", () => {
  it.each([
    ["completed", "Turn ended"],
    ["failed", "Turn failed"],
    ["interrupted", "Turn stopped"],
    ["cancelled", "Turn stopped"],
  ] as const)("keeps %s feedback visible after the run settles", async (status, label) => {
    const props = baseProps();
    const entries = [
      message("The final reply", {
        role: "assistant",
        runId: RunId.make("end-feedback"),
        updatedAt: CREATED_AT,
      }),
    ];
    const run = {
      runId: RunId.make("end-feedback"),
      status: "running" as const,
      startedAt: CREATED_AT,
      completedAt: null,
    };
    await using screen = await renderElement(
      <MessagesTimeline
        {...props}
        timelineEntries={entries}
        latestRun={run}
        isWorking
        activeTurnInProgress
      />,
    );
    expect(screen.container.querySelector('[data-testid="latest-run-end-state"]')).toBeNull();
    const completedAt = "2026-03-17T19:15:42.000Z";
    await screen.rerender(
      <MessagesTimeline
        {...props}
        timelineEntries={entries}
        latestRun={{ ...run, status, completedAt }}
      />,
    );
    await expect.element(screen.getByText(label, { exact: true })).toBeVisible();
    const end = screen
      .getByText(label, { exact: true })
      .element()
      .closest<HTMLElement>('[data-testid="latest-run-end-state"]')!;
    expect(end.textContent).toContain(label);
    expect(end.querySelector("time")?.dateTime).toBe(completedAt);
    expect(getComputedStyle(end).opacity).toBe("1");
    await userEvent.hover(screen.getByText("The final reply"));
    expect(end.textContent).toContain(label);
    await screen.rerender(
      <MessagesTimeline
        {...props}
        timelineEntries={entries}
        latestRun={{ ...run, status, completedAt: null }}
      />,
    );
    expect(
      screen.container.querySelector('[data-testid="latest-run-end-state"]')?.textContent,
    ).toContain(label);
    expect(screen.container.querySelector('[data-testid="latest-run-end-state"] time')).toBeNull();
    await screen.rerender(
      <MessagesTimeline
        {...props}
        timelineEntries={entries}
        latestRun={{ ...run, status, completedAt }}
        runlessWorkActive
      />,
    );
    expect(screen.container.querySelector('[data-testid="latest-run-end-state"]')).toBeNull();
    await screen.rerender(
      <MessagesTimeline
        {...props}
        timelineEntries={entries}
        latestRun={{ ...run, status, completedAt }}
        completionHeld={backgroundWorkHoldsCompletion([{ kind: "monitor" }])}
        footer={<p>Waiting for monitor</p>}
      />,
    );
    expect(screen.container.querySelector('[data-testid="latest-run-end-state"]')).toBeNull();
    expect(screen.container.textContent).toContain("Waiting for monitor");
    await screen.rerender(
      <MessagesTimeline
        {...props}
        timelineEntries={entries}
        latestRun={{ ...run, status, completedAt }}
        completionHeld={backgroundWorkHoldsCompletion([{ kind: "command" }])}
      />,
    );
    expect(
      screen.container.querySelector('[data-testid="latest-run-end-state"]')?.textContent,
    ).toContain(label);
  });
});

it("keeps end feedback with the trailing assistant meta row", async () => {
  const runId = RunId.make("trailing-meta");
  await using screen = await renderTimeline(
    [
      message("Finished reply", { role: "assistant", runId }),
      work("tail-tool", {
        runId,
        label: "Run checks",
        tone: "tool",
        itemType: "command_execution",
        toolLifecycleStatus: "completed",
      }),
    ],
    { latestRun: { runId, status: "completed", startedAt: CREATED_AT, completedAt: CREATED_AT } },
  );
  await expect.element(screen.getByText("Turn ended", { exact: true })).toBeVisible();
  const meta = screen.container.querySelector<HTMLElement>('[data-testid="latest-run-end-state"]')!;
  expect(meta.querySelector('[aria-label="Copy message"]')).not.toBeNull();
  expect(meta.querySelectorAll("time")).toHaveLength(1);
  expect(screen.container.querySelectorAll('[data-testid="latest-run-end-state"]')).toHaveLength(1);
});

it("falls back after a run with no assistant reply without attaching to an older response", async () => {
  await using screen = await renderTimeline(
    [message("Old reply", { role: "assistant", runId: RunId.make("old-run") })],
    {
      latestRun: {
        runId: RunId.make("failed-before-reply"),
        status: "failed",
        startedAt: CREATED_AT,
        completedAt: CREATED_AT,
      },
    },
  );
  await expect.element(screen.getByText("Turn failed", { exact: true })).toBeVisible();
  const end = screen.container.querySelector<HTMLElement>('[data-testid="latest-run-end-state"]')!;
  expect(end.querySelector("button")).toBeNull();
  expect(end.querySelectorAll("time")).toHaveLength(1);
});

function v2Item(type: string, fields: Record<string, unknown>) {
  const id = (fields.id as string | undefined) ?? type;
  return {
    position: 0,
    visibility: "local",
    sourceThreadId: "thread-1",
    sourceItemId: id,
    item: {
      id,
      threadId: "thread-1",
      runId: "run-1",
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 0,
      status: "completed",
      title: null,
      startedAt: null,
      completedAt: null,
      updatedAt: {},
      type,
      ...fields,
    },
  } as never;
}

function work(id: string, entry: Record<string, unknown>): Entry {
  return {
    id,
    kind: "work",
    createdAt: CREATED_AT,
    entry: { id, createdAt: CREATED_AT, ...entry },
  } as Entry;
}
