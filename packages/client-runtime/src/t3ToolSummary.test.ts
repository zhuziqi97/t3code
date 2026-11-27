import { compactT3McpToolOutput } from "@t3tools/shared/toolOutput";
import { describe, expect, it } from "vite-plus/test";

import { resolveChineseMessage } from "./i18n/gtCatalog.test-utils.ts";
import { summarizeT3ToolCalls as summarizeCalls, type T3ToolSummaryCall } from "./t3ToolSummary.ts";

function completed(input: unknown, output?: unknown): T3ToolSummaryCall {
  return { input, output, outcome: "completed" };
}

describe("summarizeT3ToolCalls", () => {
  const summarizeT3ToolCalls = summarizeCalls;

  it("preserves background wait update counts and failed or unfinished attempts", () => {
    const success = completed(
      { taskIds: ["monitor:raw"], waiting: true },
      { matched: ["monitor:raw"], unmatched: [] },
    );
    const failure = completed(
      { taskIds: ["command:raw"], waiting: true },
      { _tag: "OrchestratorMcpFailure", message: "Raw failure 原文" },
    );
    const unfinished: T3ToolSummaryCall = {
      input: { taskIds: ["pending:raw"], waiting: false },
      output: undefined,
      outcome: "unfinished",
    };
    expect(summarizeT3ToolCalls("background-wait", [success])).toEqual({
      label: "Updated background waits 1 time",
      failedCount: 0,
    });
    expect(
      summarizeT3ToolCalls("background-wait", [success, success, failure, unfinished]),
    ).toEqual({
      label: "Updated background waits 2 times",
      failedCount: 1,
    });
    expect(summarizeT3ToolCalls("background-wait", [unfinished])).toEqual({
      label: "Tried to update background waits 1 time",
      failedCount: 0,
    });
    expect(summarizeT3ToolCalls("background-wait", [failure])).toEqual({
      label: "Tried to update background waits 1 time",
      failedCount: 1,
    });
  });
  it("counts registered projects, repository destinations, and accepted thread launches", () => {
    expect(
      summarizeT3ToolCalls("project-create", [
        completed({}, { id: "project-1" }),
        completed({}, { id: "project-1" }),
        completed({}, { id: "project-2" }),
      ]).label,
    ).toBe("Registered 2 projects");
    expect(
      summarizeT3ToolCalls("project-clone", [
        completed({}, { cwd: "/tmp/first" }),
        completed({}, { cwd: "/tmp/second" }),
      ]).label,
    ).toBe("Cloned 2 repositories");
    expect(
      summarizeT3ToolCalls("thread-create", [
        completed({}, { threadId: "launched-thread", status: "preparing" }),
      ]).label,
    ).toBe("Created 1 thread");
  });

  it("reports review guides by outcome, and a call where none started as a failure", () => {
    const guides = (...outcomes: ReadonlyArray<string>) => ({
      guides: outcomes.map((outcome, index) => ({ number: index + 1, outcome })),
    });
    expect(
      summarizeT3ToolCalls("write-pr-guides", [
        completed({}, guides("started", "running", "failed")),
      ]),
    ).toEqual({ label: "Started 2 review guides, 1 failed", failedCount: 1 });
    const allFailed = summarizeT3ToolCalls("write-pr-guides", [
      completed({}, guides("failed", "failed")),
    ]);
    expect(allFailed.label).toBe("Could not start 2 review guides");
    expect(allFailed.failedCount).toBe(2);
  });

  it.each([
    ["queue-read", "Read 1 queued message"],
    ["queue-edit", "Edited 1 queued message"],
    ["queue-cancel", "Requested cancellation of 1 queued run"],
    ["queue-reorder", "Reordered 1 queued run"],
    ["queue-steer", "Requested steering with 1 queued message"],
  ] as const)("deduplicates the queued run target for %s", (action, label) => {
    expect(
      summarizeT3ToolCalls(action, [
        completed({ queuedRunId: "queued-1" }),
        completed({ queuedRunId: "queued-1" }),
        { input: { queuedRunId: "queued-2" }, output: undefined, outcome: "unfinished" },
      ]),
    ).toEqual({ label, failedCount: 0 });
  });

  it("counts answered requests rather than pretending every request contains one question", () => {
    expect(
      summarizeT3ToolCalls("question-respond", [
        completed({ requestId: "request-1", answers: { one: ["Yes"], two: ["No"] } }),
        completed({ requestId: "request-1" }),
        completed({ requestId: "request-2" }),
      ]).label,
    ).toBe("Answered 2 pending question requests");
  });

  it("counts attachments in distinct messages and falls back when attachment counts are missing", () => {
    const first = completed(
      { threadId: "thread-1", attachments: [{ id: "one" }, { id: "two" }] },
      { messageId: "message-1", threadId: "thread-1" },
    );
    const second = completed(
      { threadId: "thread-2", attachments: [{ id: "one" }] },
      { messageId: "message-2", threadId: "thread-2" },
    );
    expect(summarizeT3ToolCalls("attachment-send", [first, first, second])).toEqual({
      label: "Sent 3 attachments to 2 threads",
      failedCount: 0,
    });
    expect(
      summarizeT3ToolCalls("attachment-send", [first, completed({ threadId: "thread-1" })]).label,
    ).toBe("Sent attachments to 1 thread 2 times");
  });

  it("keeps repeated manual runs separate and describes asynchronous controls as requests", () => {
    expect(
      summarizeT3ToolCalls("schedule-run", [
        completed({ taskId: "schedule-1" }, { lastRunStatus: "running" }),
        completed({ taskId: "schedule-1" }, { lastRunStatus: "skipped" }),
      ]).label,
    ).toBe("Requested 2 scheduled task runs");
    expect(
      summarizeT3ToolCalls("thread-fork", [completed({}, { targetThreadId: "fork", sequence: 3 })])
        .label,
    ).toBe("Requested 1 thread fork");
    expect(
      summarizeT3ToolCalls("thread-merge", [
        completed({ targetThreadId: "parent" }, { sequence: 4 }),
      ]).label,
    ).toBe("Requested 1 context merge");
  });

  it.each([
    "WorktreeMcpFailure",
    "DeviceOperationError",
    "PreviewAutomationExecutionError",
    "PullRequestOperationError",
  ])("treats a returned %s as a failed call even if the provider says completed", (_tag) => {
    const output = [
      {
        type: "content",
        content: { type: "text", text: JSON.stringify({ _tag, message: "Unavailable" }) },
      },
    ];
    expect(summarizeT3ToolCalls("browser", [completed({}, output)])).toEqual({
      label: "Tried to use browser 1 time",
      failedCount: 1,
    });
  });
  it("counts messages and distinct destinations across delivery modes, deduplicating retries", () => {
    const calls = Array.from({ length: 5 }, (_, i) =>
      completed(
        { threadId: `thread-${i % 2}`, mode: ["auto", "queue", "steer", "restart"][i % 4] },
        { messageId: `message-${i}`, threadId: `thread-${i % 2}` },
      ),
    );
    expect(summarizeT3ToolCalls("thread-send", [...calls, calls[0]!])).toEqual({
      label: "Sent 5 messages to 2 threads",
      failedCount: 0,
    });
  });

  it("reads provider result envelopes without treating JSON in the message as result data", () => {
    const result = { messageId: "message-1", threadId: "actual-thread" };
    const json = JSON.stringify(result);
    const outputs = [
      result,
      { structuredContent: result },
      [{ type: "text", text: json }],
      { content: [{ text: { text: json } }], isError: false },
      json,
    ];
    const calls = outputs.map((output) =>
      completed(
        {
          toolName: "t3_thread_send",
          args: { threadId: "input-thread", message: '{"threadId":"fake"}' },
        },
        output,
      ),
    );
    expect(summarizeT3ToolCalls("thread-send", calls).label).toBe("Sent 1 message to 1 thread");
    expect(
      summarizeT3ToolCalls("thread-send", [
        completed({ toolName: "t3_thread_send", args: { threadId: "input-thread" } }),
        completed({ threadId: "input-thread" }),
      ]).label,
    ).toBe("Sent 2 messages to 1 thread");
  });

  it("counts the pull requests batch link and unlink calls changed", () => {
    const urls = ["https://github.com/o/r/pull/1", "https://github.com/o/r/pull/1", "not-a-pr"];
    const links = completed({ urls }, { linkedCount: 1 });
    expect(summarizeT3ToolCalls("link-pr", [links, completed({ number: 3 })]).label).toBe(
      "Linked 2 pull requests",
    );
    expect(summarizeT3ToolCalls("link-pr", [completed({ urls }, {})]).label).toBe(
      "Linked pull requests",
    );
    const batch = completed({ states: ["merged"] }, { unlinkedCount: 2 });
    expect(summarizeT3ToolCalls("unlink-pr", [batch, completed({ number: 3 })]).label).toBe(
      "Unlinked 3 pull requests",
    );
    const uncounted = completed({ states: ["merged"] }, { isError: false });
    expect(summarizeT3ToolCalls("unlink-pr", [uncounted]).label).toBe("Unlinked pull requests");
  });

  it("tells opened and merged pull requests from found ones and auto-merges", () => {
    const create = (created: boolean) => completed({ title: "t" }, { number: 1, created });
    expect(summarizeT3ToolCalls("create-pr", [create(true)]).label).toBe("Opened 1 pull request");
    expect(summarizeT3ToolCalls("create-pr", [create(false)]).label).toBe(
      "Found 1 open pull request",
    );
    expect(summarizeT3ToolCalls("create-pr", [create(true), create(false)]).label).toBe(
      "Opened 1 pull request, found 1 open",
    );
    const merge = (auto: boolean, state: string) => completed({ auto }, { number: 1, state });
    expect(summarizeT3ToolCalls("merge-pr", [merge(false, "merged")]).label).toBe(
      "Merged 1 pull request",
    );
    expect(summarizeT3ToolCalls("merge-pr", [merge(false, "open")]).label).toBe(
      "Queued 1 pull request to merge",
    );
    expect(summarizeT3ToolCalls("merge-pr", [merge(true, "open")]).label).toBe(
      "Queued 1 pull request to merge",
    );
    expect(
      summarizeT3ToolCalls("merge-pr", [merge(true, "merged"), merge(true, "open")]).label,
    ).toBe("Merged 1 pull request, queued 1");
    expect(summarizeT3ToolCalls("review-pr", [completed({ verdict: "approve" }, {})]).label).toBe(
      "Reviewed 1 pull request",
    );
  });

  it("counts the checks a CI rerun restarted, and the ones the host refused", () => {
    const rerun = (...outcomes: boolean[]) =>
      completed(
        {},
        { checks: outcomes.map((outcome, index) => ({ name: `c${index}`, rerun: outcome })) },
      );
    expect(summarizeT3ToolCalls("ci-rerun", [rerun(true, true)])).toEqual({
      label: "Re-ran 2 checks",
      failedCount: 0,
    });
    expect(summarizeT3ToolCalls("ci-rerun", [rerun(true, false)])).toEqual({
      label: "Re-ran 1 check, 1 refused",
      failedCount: 1,
    });
    expect(summarizeT3ToolCalls("ci-rerun", [rerun(false)])).toEqual({
      label: "Could not re-run 1 check",
      failedCount: 1,
    });
    expect(summarizeT3ToolCalls("ci-rerun", [rerun()]).label).toBe(
      "Found no failed checks to re-run",
    );
  });

  it("preserves pull request summary outcomes after MCP tool output compaction", () => {
    const createExisting = completed(
      { title: "t" },
      compactT3McpToolOutput("t3-code.pull_request_create", {
        number: 1,
        repository: "o/r",
        url: "https://github.com/o/r/pull/1",
        created: false,
      }),
    );
    expect(summarizeT3ToolCalls("create-pr", [createExisting]).label).toBe(
      "Found 1 open pull request",
    );

    const mergeQueued = completed(
      { auto: false },
      compactT3McpToolOutput("t3-code.pull_request_merge", { number: 1, state: "open" }),
    );
    const mergeLanded = completed(
      { auto: true },
      compactT3McpToolOutput("t3-code.pull_request_merge", { number: 2, state: "merged" }),
    );
    expect(summarizeT3ToolCalls("merge-pr", [mergeQueued]).label).toBe(
      "Queued 1 pull request to merge",
    );
    expect(summarizeT3ToolCalls("merge-pr", [mergeLanded]).label).toBe("Merged 1 pull request");

    const guidesMixed = completed(
      {},
      compactT3McpToolOutput("t3-code.write_pull_request_guides", {
        guides: [
          { number: 1, outcome: "started", detail: null },
          { number: 2, outcome: "failed", detail: "Guides disabled" },
        ],
      }),
    );
    expect(summarizeT3ToolCalls("write-pr-guides", [guidesMixed])).toEqual({
      label: "Started 1 review guide, 1 failed",
      failedCount: 1,
    });

    const rerunMixed = completed(
      {},
      compactT3McpToolOutput("t3-code.ci_rerun", {
        checks: [
          { name: "test", rerun: true, detail: null },
          { name: "external", rerun: false, detail: "Cannot rerun" },
        ],
      }),
    );
    const rerunEmpty = completed({}, compactT3McpToolOutput("t3-code.ci_rerun", { checks: [] }));
    expect(summarizeT3ToolCalls("ci-rerun", [rerunMixed])).toEqual({
      label: "Re-ran 1 check, 1 refused",
      failedCount: 1,
    });
    expect(summarizeT3ToolCalls("ci-rerun", [rerunEmpty]).label).toBe(
      "Found no failed checks to re-run",
    );
  });

  it("excludes failed and unfinished sends even if the provider reports completed", () => {
    const calls: T3ToolSummaryCall[] = [
      completed({ threadId: "success" }, { messageId: "ok", threadId: "success" }),
      completed(
        { threadId: "failed" },
        { isError: true, structuredContent: { threadId: "failed" } },
      ),
      completed({ threadId: "failed" }, [
        { type: "text", text: JSON.stringify({ _tag: "OrchestratorMcpFailure" }) },
      ]),
      { input: { threadId: "cancelled" }, output: undefined, outcome: "unfinished" },
    ];
    expect(summarizeT3ToolCalls("thread-send", calls)).toEqual({
      label: "Sent 1 message to 1 thread",
      failedCount: 2,
    });
    expect(summarizeT3ToolCalls("thread-send", [calls[1]!])).toEqual({
      label: "Tried to send 1 message to 1 thread",
      failedCount: 1,
    });
  });

  it("does not confuse a child's failure or wait timeout with failure of the orchestration call", () => {
    const failedChild = { taskId: "task-1", status: "failed", summary: "command not found" };
    expect(
      summarizeT3ToolCalls("delegate", [completed({}, failedChild), completed({}, failedChild)]),
    ).toEqual({
      label: "Delegated 1 task",
      failedCount: 0,
    });
    expect(
      summarizeT3ToolCalls(
        "task-status",
        Array.from({ length: 4 }, () => completed({ taskId: "task-1" }, failedChild)),
      ).label,
    ).toBe("Checked task status 4 times");
    expect(
      summarizeT3ToolCalls("thread-wait", [
        completed({ threadId: "thread-1" }, { threadId: "thread-1", timedOut: true }),
      ]),
    ).toEqual({
      label: "Waited on 1 thread",
      failedCount: 0,
    });
  });
});

describe("Chinese T3 summaries", () => {
  const t = resolveChineseMessage;

  it.each([
    [1, "已更新后台等待 1 次"],
    [2, "已更新后台等待 2 次"],
  ] as const)("localizes %s background wait update calls", (count, label) => {
    const calls = Array.from({ length: count }, (_, index) =>
      completed(
        { taskIds: ["monitor:原文"], waiting: index === 0 },
        { matched: ["monitor:原文"], unmatched: [] },
      ),
    );
    expect(summarizeCalls("background-wait", calls, t)).toEqual({ label, failedCount: 0 });
  });
  it("deduplicates successful effects while retaining failed-call status", () => {
    const success = completed({ threadId: "first" }, { messageId: "sent", threadId: "first" });
    const failure = completed({ threadId: "other" }, { isError: true });
    expect(summarizeCalls("thread-send", [success, success, failure], t)).toEqual({
      label: "已向 1 个会话发送 1 条消息",
      failedCount: 1,
    });
    expect(summarizeCalls("thread-send", [failure], t)).toEqual({
      label: "尝试向 1 个会话发送 1 条消息",
      failedCount: 1,
    });
    expect(
      summarizeCalls("thread-send", [completed(undefined, "Raw diagnostic 原文")], t).label,
    ).toBe("已发送 1 条消息");
  });
  it("distinguishes confirmed launches from requests and excludes rollbacks", () => {
    expect(
      summarizeCalls(
        "thread-create",
        [
          completed(
            {},
            {
              threads: [
                { threadId: "created", status: "running" },
                { threadId: "rolled-back", status: "rolled_back" },
              ],
            },
          ),
          completed({}, { threadId: "created" }),
        ],
        t,
      ).label,
    ).toBe("已创建 1 个会话");
    expect(summarizeCalls("thread-create", [completed({})], t).label).toBe("已请求创建会话 1 次");
  });
  it("keeps asynchronous cancellation and deletion as requests", () => {
    expect(summarizeCalls("thread-interrupt", [completed({ threadId: "thread" })], t).label).toBe(
      "已请求中断 1 个会话",
    );
    expect(
      summarizeCalls(
        "schedule-delete",
        [completed({ scheduledTaskId: "task" }, { deleted: false })],
        t,
      ).label,
    ).toBe("已请求删除 1 个定时任务");
    expect(
      summarizeCalls(
        "schedule-run",
        [completed({ taskId: "task" }), completed({ taskId: "task" })],
        t,
      ).label,
    ).toBe("已请求 2 次定时任务运行");
  });
  it("counts attachments per distinct message and retains the missing-count fallback", () => {
    const first = completed(
      { threadId: "thread", attachments: [{ id: "a" }, { id: "b" }] },
      { messageId: "message" },
    );
    expect(summarizeCalls("attachment-send", [first, first], t).label).toBe(
      "已向 1 个会话发送 2 个附件",
    );
    expect(
      summarizeCalls("attachment-send", [first, completed({ threadId: "thread" })], t).label,
    ).toBe("已向 1 个会话发送附件 2 次");
  });
  it("counts repeated queries and answered requests rather than contained questions", () => {
    expect(
      summarizeCalls(
        "task-status",
        [completed({ taskId: "task" }), completed({ taskId: "task" })],
        t,
      ).label,
    ).toBe("已检查任务状态 2 次");
    expect(
      summarizeCalls(
        "question-respond",
        [completed({ requestId: "request", answers: { a: ["Yes"], b: ["No"] } })],
        t,
      ).label,
    ).toBe("已回答 1 个待回答的问题请求");
  });
});
