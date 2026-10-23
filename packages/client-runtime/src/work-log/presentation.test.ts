import { T3_MCP_TOOL_NAMES } from "@t3tools/shared/t3McpToolPresentation";
import { summarizeToolGroup, toolGroupSummaryKind } from "./presentation.js";
import { createI18n } from "../i18n/createI18n.ts";
import { describe, expect, it } from "vite-plus/test";

import { ThreadId, TurnItemId, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  commandDetailRepeatsCommand,
  extractCommandOutputText,
  resolveWorkEntryToolPresentation,
  toolItemForDisplay,
  type WorkLogPresentationEntry,
  workEntryIndicatesToolFailure,
  workEntryDisplayIndicatesToolFailure,
  workEntryIndicatesToolSuccess,
} from "./presentation.js";

function commandItem(
  fields: Partial<Extract<OrchestrationV2TurnItem, { type: "command_execution" }>> = {},
): OrchestrationV2TurnItem {
  return {
    id: TurnItemId.make("command"),
    threadId: ThreadId.make("thread"),
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed",
    title: null,
    startedAt: null,
    completedAt: null,
    updatedAt: DateTime.makeUnsafe("2026-09-08T00:00:00.000Z"),
    type: "command_execution",
    input: 'rg "command not found"',
    exitCode: 0,
    ...fields,
  };
}

describe("workEntryIndicatesToolFailure", () => {
  const base = {
    id: "w1",
    createdAt: "2026-01-01T00:00:00.000Z",
    label: "Read",
  };

  it.each([
    [{ exitCode: 2 }, true],
    [{ output: "sh: missing-command: command not found" }, true],
    [{ output: `${"x".repeat(32_768)} command not found` }, false],
  ] as const)(
    "preserves command failure state after removing displayed output: %j",
    (fields, failed) => {
      const structuredPayload = commandItem(fields);
      const entry: WorkLogPresentationEntry = {
        ...base,
        tone: "tool",
        itemType: "command_execution",
        toolLifecycleStatus: "completed",
        structuredPayload,
      };
      expect(workEntryDisplayIndicatesToolFailure(entry)).toBe(failed);
      expect(workEntryIndicatesToolSuccess(entry)).toBe(!failed);
      expect(JSON.stringify(toolItemForDisplay(structuredPayload))).not.toContain('"output":');
    },
  );

  it("ignores failure phrases in reasoning text", () => {
    const entry: WorkLogPresentationEntry = {
      ...base,
      label: "Thinking",
      tone: "thinking",
      itemType: "reasoning",
      toolLifecycleStatus: "completed",
      detail: "That exit code 2 is just from listing the deleted directory, which is expected.",
    };
    expect(workEntryIndicatesToolFailure(entry)).toBe(false);
    expect(workEntryDisplayIndicatesToolFailure(entry)).toBe(false);
  });

  it("does not treat error text in a command as rendered failure", () => {
    const entry = {
      ...base,
      label: "Ran command",
      tone: "tool",
      toolLifecycleStatus: "completed",
      command: 'rg "file not found"',
      detail: "Found 3 matches",
    } satisfies WorkLogPresentationEntry;

    expect(workEntryDisplayIndicatesToolFailure(entry)).toBe(false);

    expect(workEntryIndicatesToolFailure(entry)).toBe(true);
    expect(workEntryDisplayIndicatesToolFailure({ ...entry, detail: "File not found" })).toBe(true);
  });

  it("treats successful tool rows as success candidates", () => {
    expect(
      workEntryIndicatesToolSuccess({
        ...base,
        tone: "tool",
        toolLifecycleStatus: "completed",
        detail: "ok",
      }),
    ).toBe(true);
    expect(
      workEntryIndicatesToolSuccess({
        ...base,
        tone: "tool",
        toolLifecycleStatus: "inProgress",
        detail: "…",
      }),
    ).toBe(false);
    expect(workEntryIndicatesToolSuccess({ ...base, tone: "thinking", detail: "…" })).toBe(false);
    expect(
      workEntryIndicatesToolSuccess({ ...base, tone: "tool", toolLifecycleStatus: "stopped" }),
    ).toBe(false);
    expect(
      workEntryIndicatesToolSuccess({ ...base, tone: "tool", toolLifecycleStatus: "idle" }),
    ).toBe(false);
  });

  it("does not run heuristics on non-tool info rows", () => {
    expect(
      workEntryIndicatesToolFailure({
        ...base,
        label: "Context compacted",
        tone: "info",
        detail: "File not found in conversation",
      }),
    ).toBe(false);
  });
});

describe("summarizeToolGroup", () => {
  const entry = (
    id: string,
    overrides: Partial<WorkLogPresentationEntry>,
  ): WorkLogPresentationEntry => ({
    id,
    createdAt: "2026-09-01T00:00:00Z",
    label: "Tool call",
    tone: "tool",
    ...overrides,
  });

  it("localizes groups while preserving source names, file deduplication and omitted counts", () => {
    const t = createI18n({ lng: "zh" }).t;
    const edit = entry("edit", {
      itemType: "file_change",
      changedFiles: ["src/raw.ts", "src/second.ts"],
    });
    expect(summarizeToolGroup([edit, { ...edit, id: "retry" }], t)).toEqual({
      summary: "修改了 2 个文件",
      hasFailure: false,
    });
    const source = {
      key: "integration",
      name: "Raw Integration 原文",
      kind: "integration" as const,
    };
    const entries = [
      entry("source", { toolSource: source }),
      entry("source-again", { toolSource: source }),
      entry("command", { itemType: "command_execution", command: "printf Raw" }),
      edit,
      entry("search", { itemType: "web_search" }),
      entry("thought", { itemType: "reasoning", tone: "thinking" }),
    ];
    expect(summarizeToolGroup(entries, t).summary).toBe(
      "使用了 Raw Integration 原文 集成，运行了 1 条命令，修改了 2 个文件，执行了 1 项其他操作",
    );
    expect(entries[2]?.command).toBe("printf Raw");
    expect(summarizeToolGroup([entries[5]!], t).summary).toBe("思考内容");
    expect(summarizeToolGroup([entries[5]!, { ...entries[5]!, id: "thought-2" }], t).summary).toBe(
      "思考内容（×2）",
    );
  });

  it("excludes reasoning from mixed tool counts and icons", () => {
    const thought = entry("thought", {
      itemType: "reasoning",
      tone: "thinking",
      detail: "Check the source",
    });
    const command = entry("command", { itemType: "command_execution", command: "vp test run" });
    expect(summarizeToolGroup([thought, command, { ...thought, id: "thought-2" }])).toEqual({
      summary: "Ran 1 command",
      hasFailure: false,
    });
    expect(toolGroupSummaryKind([thought, command])).toBe("command");
    expect(summarizeToolGroup([thought]).summary).toBe("Thought");
    expect(summarizeToolGroup([thought, { ...thought, id: "thought-2" }]).summary).toBe(
      "Thought (×2)",
    );
    expect(toolGroupSummaryKind([thought])).toBe("reasoning");
  });

  it("counts created threads alongside adjacent commands", () => {
    expect(
      summarizeToolGroup([
        entry("command", { itemType: "command_execution", command: "vp test run" }),
        entry("created", {
          itemType: "thread_created",

          label: "Created thread",
        }),
      ]).summary,
    ).toBe("Ran 1 command and created 1 thread");
  });

  it("deduplicates named sources ahead of ordinary actions", () => {
    const source = { key: "browser-use:chrome", name: "Chrome", kind: "integration" as const };
    expect(
      summarizeToolGroup([
        entry("open", { label: "Open page", toolSource: source }),
        entry("inspect", { label: "Inspect page", toolSource: source }),
        entry("command", {
          label: "Ran command",
          itemType: "command_execution",
          command: "git status",
        }),
      ]).summary,
    ).toBe("Used Chrome integration and ran 1 command");
  });

  it.each([
    [["Foo", "Foo"], "Used Foo integration and ran 1 command"],
    [["Foo", "Bar", "Foo"], "Used Foo and Bar integrations and ran 1 command"],
  ] as const)(
    "uses the displayed source names for integration plurality: %j",
    (names, expected) => {
      expect(
        summarizeToolGroup([
          ...names.map((name, index) =>
            entry(`integration-${index}`, {
              toolSource: { key: `integration-${index}`, name, kind: "integration" },
            }),
          ),
          entry("command", {
            itemType: "command_execution",
            command: "git status",
          }),
        ]).summary,
      ).toBe(expected);
    },
  );

  it("omits the integration suffix for special browser and computer sources", () => {
    expect(
      summarizeToolGroup([
        entry("inspect", {
          label: "Inspect page",
          toolSource: { key: "browser-use", name: "Browser", kind: "browser" },
        }),
        entry("click", {
          label: "Click",
          toolSource: { key: "computer-use", name: "Computer Use", kind: "computer" },
        }),
      ]).summary,
    ).toBe("Used Browser and Computer Use");
  });

  it("names Computer Use once when native-app and fallback sources share its label", () => {
    expect(
      summarizeToolGroup([
        entry("inspect-app", {
          label: "Inspect app",
          toolSource: {
            key: "native-app:com.t3tools.t3code",
            name: "Computer Use",
            kind: "computer",
          },
        }),
        entry("failed-sky", {
          label: "Restrict the breakpoint to Git actions",
          toolSource: { key: "computer-use", name: "Computer Use", kind: "computer" },
        }),
      ]).summary,
    ).toBe("Used Computer Use");
  });
});

describe("resolveWorkEntryToolPresentation", () => {
  it("presents and summarizes every T3 tool using the same structured identity", () => {
    for (const tool of T3_MCP_TOOL_NAMES) {
      const entry: WorkLogPresentationEntry = {
        id: tool,
        createdAt: "2026-09-19T00:00:00.000Z",
        tone: "tool",
        label: "Custom provider title",
        toolData: { server: "t3-code", tool },
        toolLifecycleStatus: "completed",
        itemType: "dynamic_tool",
        toolSource: { key: "t3-code", name: "T3 Code", kind: "integration" },
      };
      const presentation = resolveWorkEntryToolPresentation(entry);
      expect(presentation, tool).not.toBeNull();
      expect(presentation?.displayName, tool).not.toContain(tool);
      for (const toolLifecycleStatus of [
        "inProgress",
        "completed",
        "failed",
        "declined",
        "stopped",
      ] as const) {
        const current = { ...entry, toolLifecycleStatus };
        expect(
          resolveWorkEntryToolPresentation(current, undefined, createI18n({ lng: "en" }).t),
          `${tool}: ${toolLifecycleStatus}`,
        ).toEqual(resolveWorkEntryToolPresentation(current));
        const chinese = resolveWorkEntryToolPresentation(
          current,
          undefined,
          createI18n({ lng: "zh" }).t,
        );
        expect(chinese?.displayName, `${tool}: ${toolLifecycleStatus}`).toMatch(/[\u4e00-\u9fff]/);
        expect(chinese?.displayName, `${tool}: ${toolLifecycleStatus}`).not.toMatch(
          /chat\.tools\.|\{\{/,
        );
        expect(chinese?.icon).toBe(presentation?.icon);
      }
      const summary = summarizeToolGroup([entry]);
      expect(summary.summary, tool).not.toMatch(/Used (?:1 tool|T3 Code integration)/);
      expect(summary.hasFailure, tool).toBe(false);
      expect(summarizeToolGroup([entry], createI18n({ lng: "en" }).t), tool).toEqual(summary);
      const translated = summarizeToolGroup([entry], createI18n({ lng: "zh" }).t);
      expect(translated.summary, tool).toMatch(/[\u4e00-\u9fff]/);
      expect(translated.summary, tool).not.toMatch(/chat\.tools\.|\{\{/);
      const failed = { ...entry, toolLifecycleStatus: "failed" as const };
      expect(resolveWorkEntryToolPresentation(failed)?.displayName, tool).toMatch(/^Failed to /);
      expect(summarizeToolGroup([failed]).hasFailure, tool).toBe(true);
      expect(summarizeToolGroup([failed]).summary, tool).toMatch(
        /^(?:Tried to |Requested thread creation)/,
      );
    }
  });

  it.each([
    ["task_cancel", "已请求取消委派任务"],
    ["delete_scheduled_task", "已请求删除定时任务"],
    ["run_scheduled_task_now", "已请求运行定时任务"],
    ["t3_thread_interrupt", "已请求中断 T3 会话"],
    ["t3_thread_fork", "已请求派生当前会话"],
    ["t3_project_create", "已注册项目"],
  ])("keeps Chinese %s labels faithful to requested versus completed operations", (tool, label) => {
    expect(
      resolveWorkEntryToolPresentation(
        {
          label: "Custom title",
          toolData: { server: "t3-code", tool },
          toolLifecycleStatus: "completed",
        },
        undefined,
        createI18n({ lng: "zh" }).t,
      )?.displayName,
    ).toBe(label);
  });

  it("preserves raw PR numbers and failure envelopes in translated labels", () => {
    const t = createI18n({ lng: "zh" }).t;
    const entry = {
      label: "Custom provider title",
      toolLifecycleStatus: "completed" as const,
      toolData: {
        server: "t3-code",
        tool: "link_pull_request",
        arguments: { url: "https://github.com/acme/web/pull/42" },
      },
    };
    expect(resolveWorkEntryToolPresentation(entry, undefined, t)).toMatchObject({
      displayName: "已关联PR #42",
      icon: "pull-request",
      action: "link-pr",
    });
    expect(
      resolveWorkEntryToolPresentation(
        { ...entry, toolData: { ...entry.toolData, result: { isError: true } } },
        undefined,
        t,
      )?.displayName,
    ).toBe("关联PR #42失败");
    expect(entry.toolData.arguments.url).toBe("https://github.com/acme/web/pull/42");
    expect(
      resolveWorkEntryToolPresentation(
        {
          label: "Raw Integration 原文",
          toolData: { server: "another-server", tool: "link_pull_request" },
        },
        undefined,
        t,
      ),
    ).toBeNull();
  });

  it.each([
    ["t3_project_list", "Listing projects", "Listed projects"],
    ["t3_project_clone", "Cloning a repository", "Cloned a repository"],
    ["t3_project_create", "Registering a project", "Registered a project"],
    ["t3_thread_launch", "Launching a project thread", "Launched a project thread"],
    ["t3_queue_edit", "Editing a queued message", "Edited a queued message"],
    ["t3_pending_request_respond", "Answering pending questions", "Answered pending questions"],
    ["t3_thread_configure", "Setting thread model", "Set thread model"],
    ["t3_thread_fork", "Forking this thread", "Requested a fork of this thread"],
    ["t3_thread_send_attachments", "Sending attachments", "Sent attachments"],
    ["run_scheduled_task_now", "Running a scheduled task", "Requested a run of a scheduled task"],
    ["t3_workflow_stop", "Stopping a workflow", "Requested a stop for a workflow"],
  ])("labels %s through its lifecycle", (tool, running, completed) => {
    expect(resolveWorkEntryToolPresentation({ label: `T3-code.${tool}` })?.displayName).toBe(
      running,
    );
    expect(
      resolveWorkEntryToolPresentation({
        label: `T3-code.${tool}`,
        toolLifecycleStatus: "completed",
      })?.displayName,
    ).toBe(completed);
  });

  it("distinguishes an interrupted unwatch from a completed unwatch", () => {
    const entry = { label: "T3-code.unwatch_pull_request" };
    expect(
      (["inProgress", "stopped", "completed"] as const).map(
        (toolLifecycleStatus) =>
          resolveWorkEntryToolPresentation({ ...entry, toolLifecycleStatus })?.displayName,
      ),
    ).toEqual([
      "Unwatching a pull request",
      "Stopped unwatching a pull request",
      "Stopped watching a pull request",
    ]);
  });

  it("describes starting review-guide writing in rows and groups without outcomes", () => {
    const entry = {
      id: "guides",
      createdAt: "2026-10-07T00:00:00.000Z",
      tone: "tool",
      label: "T3-code.write_pull_request_guides",
      toolLifecycleStatus: "completed",
    } satisfies WorkLogPresentationEntry;
    expect({
      row: resolveWorkEntryToolPresentation(entry)?.displayName,
      single: summarizeToolGroup([entry]).summary,
      repeated: summarizeToolGroup([entry, { ...entry, id: "guides-2" }]).summary,
    }).toEqual({
      row: "Started writing review guides",
      single: "Started writing review guides",
      repeated: "Started writing review guides 2 times",
    });
  });

  it("describes delegated-task cancellation as an ongoing action then a request", () => {
    const entry = { label: "T3-code.task_cancel" };
    expect(
      (["inProgress", "completed"] as const).map(
        (toolLifecycleStatus) =>
          resolveWorkEntryToolPresentation({ ...entry, toolLifecycleStatus })?.displayName,
      ),
    ).toEqual(["Canceling a delegated task", "Requested cancellation of a delegated task"]);
  });

  it("summarizes workflow stop targets separately from their parent thread", () => {
    const entry = {
      id: "workflow-stop",
      createdAt: "2026-10-07T00:00:00.000Z",
      tone: "tool",
      label: "Custom title",
      itemType: "dynamic_tool",
      toolLifecycleStatus: "completed",
      toolData: {
        server: "t3-code",
        tool: "t3_workflow_stop",
        arguments: { threadId: "parent", subagentId: "workflow-1" },
        result: {},
      },
    } satisfies WorkLogPresentationEntry;
    expect(
      summarizeToolGroup([
        entry,
        entry,
        {
          ...entry,
          toolData: {
            ...entry.toolData,
            arguments: { threadId: "parent", subagentId: "workflow-2" },
          },
        },
        {
          ...entry,
          toolData: {
            ...entry.toolData,
            tool: "t3_thread_interrupt",
            arguments: { threadId: "parent" },
          },
        },
      ]),
    ).toEqual({
      summary: "Requested stops for 2 workflows and requested interrupts for 1 thread",
      hasFailure: false,
    });
  });

  it("summarizes project tools from MCP arguments and results without claiming failed effects", () => {
    const entry: WorkLogPresentationEntry = {
      id: "clone",
      createdAt: "2026-09-19T00:00:00.000Z",
      tone: "tool",
      label: "Custom title",
      itemType: "dynamic_tool",
      toolLifecycleStatus: "completed",
      toolData: {
        server: "t3-code",
        tool: "t3_project_clone",
        arguments: { url: "https://github.com/acme/repo" },
        result: { cwd: "/tmp/repo" },
      },
    };
    const list = { ...entry, toolData: { server: "t3-code", tool: "t3_project_list" } };
    expect(summarizeToolGroup([list, entry])).toEqual({
      summary: "Listed projects 1 time and cloned 1 repository",
      hasFailure: false,
    });
    const failed = {
      ...entry,
      toolData: { toolName: "T3-code.t3_project_clone", rawOutput: { isError: true } },
    };
    expect(summarizeToolGroup([entry, failed])).toEqual({
      summary: "Cloned 1 repository",
      hasFailure: true,
    });
  });

  it("does not summarize a foreign structured identity as T3 work", () => {
    const entry: WorkLogPresentationEntry = {
      id: "foreign",
      createdAt: "2026-09-19T00:00:00.000Z",
      tone: "tool",
      label: "t3_project_clone",
      toolLifecycleStatus: "completed",
      toolData: { server: "another-server", tool: "t3_project_clone" },
    };
    expect(summarizeToolGroup([entry]).summary).toBe("Used 1 tool");
  });

  it("shows returned MCP errors as failures even in the live activity row", () => {
    const entry: WorkLogPresentationEntry = {
      id: "clone",
      createdAt: "2026-09-19T00:00:00.000Z",
      tone: "tool",
      label: "T3-code.t3_project_clone",
      toolLifecycleStatus: "inProgress",
      itemType: "dynamic_tool",
      toolData: { output: { isError: true } },
    };
    expect(resolveWorkEntryToolPresentation(entry)?.displayName).toBe(
      "Failed to clone a repository",
    );
    expect(workEntryDisplayIndicatesToolFailure(entry)).toBe(true);
    expect(workEntryIndicatesToolSuccess(entry)).toBe(false);
    const childFailure = {
      ...entry,
      label: "T3-code.task_status",
      toolLifecycleStatus: "completed" as const,
      toolData: { output: { taskId: "child", status: "failed", summary: "command not found" } },
    };
    expect(workEntryDisplayIndicatesToolFailure(childFailure)).toBe(false);
    expect(workEntryIndicatesToolSuccess(childFailure)).toBe(true);
  });
  it.each([
    "mcp__t3-code__preview_click",
    "mcp__t3_code__preview_click",
    "mcp__t3code__preview_click",
    "T3-code.preview_click",
    "t3-code · preview_click completed",
    "t3_code/preview_click",
    "preview_click",
  ])("recognizes browser tool names across providers: %s", (label) => {
    expect(resolveWorkEntryToolPresentation({ label })).toEqual({
      displayName: "Clicking in the preview browser",
      icon: "browser",
    });
  });

  it("uses structured MCP identity when the provider supplies a custom title", () => {
    expect(
      resolveWorkEntryToolPresentation({
        label: "Tool call complete",
        toolTitle: "Inspect the current page",
        toolData: { server: "t3-code", tool: "preview_snapshot", result: { title: "Example" } },
      }),
    ).toEqual({ displayName: "Taking a snapshot of the preview page", icon: "browser" });
  });

  it("uses the summary's state only when the provider omitted a lifecycle status", () => {
    const entry = { label: "T3-code.preview_click" };
    expect(resolveWorkEntryToolPresentation(entry, "inProgress")?.displayName).toBe(
      "Clicking in the preview browser",
    );
    expect(resolveWorkEntryToolPresentation(entry, "completed")?.displayName).toBe(
      "Clicked in the preview browser",
    );
    expect(
      resolveWorkEntryToolPresentation({ ...entry, toolLifecycleStatus: "completed" }, "inProgress")
        ?.displayName,
    ).toBe("Clicked in the preview browser");
    expect(
      resolveWorkEntryToolPresentation({ ...entry, toolLifecycleStatus: "failed" }, "completed")
        ?.displayName,
    ).toBe("Failed to click in the preview browser");
  });

  it("does not brand unknown tools or another server's matching tool name", () => {
    for (const label of [
      "mcp__github__preview_click",
      "t3-code.unknown_tool",
      "t3-code.toString",
      "Search files",
    ]) {
      expect(resolveWorkEntryToolPresentation({ label })).toBeNull();
    }
    expect(
      resolveWorkEntryToolPresentation({
        label: "preview_click",
        toolData: { server: "another-server", tool: "preview_click" },
      }),
    ).toBeNull();
  });
});

describe("command work-log details", () => {
  it("extracts Claude result blocks and projected output", () => {
    expect(
      extractCommandOutputText({
        result: {
          content: [
            { type: "text", text: "first" },
            { type: "text", text: "second" },
          ],
        },
      }),
    ).toBe("first\nsecond");
    expect(extractCommandOutputText({ rawOutput: { content: "projected summary" } })).toBe(
      "projected summary",
    );
  });

  it("treats an ingestion-truncated echo of a long command as a repeat", () => {
    const command = `git add -A && git commit -m "${"x".repeat(200)}"`;
    const truncated = `Bash: ${command}`.slice(0, 177) + "...";
    expect(
      commandDetailRepeatsCommand({
        detail: truncated,
        command,
        rawCommand: null,
        toolName: "Bash",
        data: { toolName: "Bash", command },
      }),
    ).toBe(true);
    expect(
      commandDetailRepeatsCommand({
        detail: "Bash: printf hello...",
        command: "printf goodbye",
        rawCommand: null,
        toolName: "Bash",
        data: { toolName: "Bash", command: "printf goodbye" },
      }),
    ).toBe(false);
  });

  it("treats ACP command echoes as synthetic even without a tool kind", () => {
    expect(
      commandDetailRepeatsCommand({
        detail: "pnpm test",
        command: "pnpm test",
        rawCommand: null,
        toolName: undefined,
        data: { toolCallId: "tool-1", command: "pnpm test" },
      }),
    ).toBe(true);
    expect(
      commandDetailRepeatsCommand({
        detail: "pnpm test",
        command: "pnpm test",
        rawCommand: null,
        toolName: undefined,
        data: { command: "pnpm test" },
      }),
    ).toBe(false);
  });
});
