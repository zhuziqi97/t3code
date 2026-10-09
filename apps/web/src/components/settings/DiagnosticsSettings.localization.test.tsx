// @vitest-environment jsdom
import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import {
  AuthDiagnosticsReadScope,
  EnvironmentId,
  type SessionGrantInput,
  type ServerTraceDiagnosticsResult,
  type ServerProcessDiagnosticsResult,
  type ServerProcessResourceHistoryResult,
} from "@t3tools/contracts";

const state = vi.hoisted(() => ({
  session: null as SessionGrantInput | null,
  trace: null as ServerTraceDiagnosticsResult | null,
  processes: null as ServerProcessDiagnosticsResult | null,
  history: null as ServerProcessResourceHistoryResult | null,
  maintain: true,
  operate: true,
  connected: true,
  sessionError: null as string | null,
  queryError: null as string | null,
  pending: false,
  subscriptions: vi.fn(),
  refresh: vi.fn(),
  confirm: vi.fn(),
  signal: vi.fn(),
  open: vi.fn(),
  copy: vi.fn(),
  toast: vi.fn(),
  squash: vi.fn(),
}));
vi.mock("./SettingsScopeContext", () => ({
  useSettingsScope: () => ({
    environment: state.connected
      ? {
          environmentId: EnvironmentId.make("raw-diagnostic-host"),
          connection: { phase: "connected" },
          serverConfig: {
            observability: { logsDirectoryPath: "/raw/logs/path" },
            availableEditors: [],
          },
        }
      : null,
  }),
}));
vi.mock("../../state/session", () => ({
  environmentSession: { sessionStateAtom: () => "session" },
  useEnvironmentScope: (_id: unknown, scope: string) =>
    scope === "environment:maintain" ? state.maintain : state.operate,
  readEnvironmentScope: (_id: unknown, scope: string) =>
    scope === "environment:maintain" ? state.maintain : state.operate,
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    traceDiagnostics: () => "trace",
    processDiagnostics: () => "processes",
    processResourceHistory: ({ input }: { input: { windowMs: number; bucketMs: number } }) =>
      `history:${input.windowMs}:${input.bucketMs}`,
    signalProcess: "controlled-signal",
  },
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: string | null) => {
    useEffect(() => {
      if (atom) state.subscriptions(atom);
    }, [atom]);
    return {
      data:
        atom === "session"
          ? state.session
          : atom === "trace"
            ? state.trace
            : atom === "processes"
              ? state.processes
              : atom?.startsWith("history:")
                ? state.history
                : null,
      error: atom === "session" ? state.sessionError : state.queryError,
      isPending: state.pending,
      refresh: () => state.refresh(atom),
    };
  },
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.signal }));
vi.mock("../../localApi", () => ({
  ensureLocalApi: () => ({ dialogs: { confirm: state.confirm } }),
}));
vi.mock("../../editorPreferences", () => ({ useOpenInPreferredEditor: () => state.open }));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  isAtomCommandInterrupted: () => false,
  squashAtomCommandFailure: () => state.squash(),
}));
vi.mock("../../hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => {
    const [isCopied, setCopied] = useState(false);
    return {
      isCopied,
      copyToClipboard: (text: string) => {
        state.copy(text);
        setCopied(true);
      },
    };
  },
}));
vi.mock("../ui/toast", () => ({ toastManager: { add: state.toast } }));
vi.mock("./ResourceTelemetryDiagnostics", () => ({ ResourceTelemetryDiagnostics: () => null }));
vi.mock("./settingsLayout", () => ({
  SettingsSection: ({
    title,
    children,
    headerAction,
  }: {
    title: ReactNode;
    children: ReactNode;
    headerAction: ReactNode;
  }) => (
    <section>
      <h3>{title}</h3>
      {headerAction}
      {children}
    </section>
  ),
  SettingsPageContainer: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  useRelativeTimeTick: () => {},
}));

import { changeLanguage } from "../../i18n";
import { DiagnosticsSettingsPanel } from "./DiagnosticsSettings";

const now = DateTime.makeUnsafe("2026-10-10T00:00:00Z");
const traceId = "raw-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ-long-trace-id";
const longMessage = "raw native failure\n" + "provider-command --raw-option ".repeat(9);
let root: Root;
let container: HTMLDivElement;
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
  HTMLElement.prototype.getAnimations = () => [];
  await changeLanguage("en");
  state.session = { authenticated: true, scopes: [AuthDiagnosticsReadScope] };
  state.sessionError = null;
  state.queryError = null;
  state.pending = false;
  state.maintain = true;
  state.operate = true;
  state.connected = true;
  for (const mock of [
    state.subscriptions,
    state.refresh,
    state.confirm,
    state.signal,
    state.open,
    state.copy,
    state.toast,
  ])
    mock.mockReset();
  state.squash.mockReturnValue(new Error("raw controlled failure: EACCES"));
  state.confirm.mockResolvedValue(true);
  state.signal.mockResolvedValue({
    _tag: "Success",
    value: { signaled: true, message: Option.none() },
  });
  state.open.mockResolvedValue({ _tag: "Success" });
  state.processes = {
    serverPid: 100,
    readAt: now,
    processCount: 2,
    totalRssBytes: 4096,
    totalCpuPercent: 2,
    processes: [
      {
        pid: 200,
        startTimeMs: 12345,
        ppid: 100,
        pgid: Option.none(),
        status: "R",
        cpuPercent: 1,
        rssBytes: 2048,
        elapsed: "01:00",
        command: "/raw/codex --raw",
        depth: 0,
        childPids: [201],
      },
      {
        pid: 201,
        startTimeMs: 23456,
        ppid: 200,
        pgid: Option.none(),
        status: "S",
        cpuPercent: 1,
        rssBytes: 2048,
        elapsed: "00:30",
        command: "/raw/child --keep-raw",
        depth: 1,
        childPids: [],
      },
    ],
    error: Option.none(),
  };
  state.history = {
    readAt: now,
    windowMs: 900000,
    bucketMs: 60000,
    sampleIntervalMs: 1000,
    retainedSampleCount: 1,
    totalCpuSecondsApprox: 1,
    buckets: [],
    topProcesses: [],
    error: Option.none(),
  };
  state.trace = {
    traceFilePath: "/raw/trace.jsonl",
    scannedFilePaths: ["/raw/trace.jsonl"],
    readAt: now,
    recordCount: 5,
    parseErrorCount: 1,
    firstSpanAt: Option.some(now),
    lastSpanAt: Option.some(now),
    failureCount: 1,
    interruptionCount: 0,
    slowSpanThresholdMs: 1000,
    slowSpanCount: 1,
    logLevelCounts: { ERROR: 1 },
    topSpansByCount: [
      {
        name: "raw.span.name",
        count: 5,
        failureCount: 1,
        totalDurationMs: 2000,
        averageDurationMs: 400,
        maxDurationMs: 1500,
      },
    ],
    slowestSpans: [
      { name: "raw.slow.span", durationMs: 1500, endedAt: now, traceId, spanId: "raw-span-id" },
    ],
    commonFailures: [],
    latestFailures: [
      {
        name: "raw.failure.span",
        cause: longMessage,
        durationMs: 1500,
        endedAt: now,
        traceId,
        spanId: "raw-failure-span",
      },
    ],
    latestWarningAndErrorLogs: [
      {
        spanName: "raw.log.span",
        level: "ERROR",
        message: longMessage,
        seenAt: now,
        traceId,
        spanId: "raw-log-span",
      },
    ],
    partialFailure: Option.some(true),
    error: Option.some({ kind: "trace-file-read-failed", message: "raw file diagnostic: ENOENT" }),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLanguage("en");
  delete (HTMLElement.prototype as Partial<HTMLElement>).getAnimations;
  vi.unstubAllGlobals();
});
const render = async () => act(async () => root.render(<DiagnosticsSettingsPanel />));
const language = async (value: "en" | "zh") => act(async () => changeLanguage(value));
function buttons(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].filter(
    (node) => (node.getAttribute("aria-label") ?? node.textContent?.trim()) === label,
  );
}
function button(label: string) {
  const node = buttons(label)[0];
  expect(node).toBeDefined();
  return node!;
}
const click = async (label: string) => act(async () => button(label).click());
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

it("keeps expanded diagnostics, collapsed process rows, selected periods and raw trace ids through language changes", async () => {
  await render();
  await click("Show full error");
  const expanded = button("Show less");
  await click("Collapse codex");
  expect(buttons("Send SIGINT")).toHaveLength(1);
  await click("30m");
  expect(state.subscriptions.mock.calls.map((call) => call[0])).toContain("history:1800000:120000");
  const subscriptions = state.subscriptions.mock.calls.length;
  await language("zh");
  expect(button("收起")).toBe(expanded);
  expect(expanded.getAttribute("aria-expanded")).toBe("true");
  expect(button("展开 codex")).toBeDefined();
  expect(buttons("发送 SIGINT")).toHaveLength(1);
  expect(button("30 分钟").getAttribute("aria-pressed")).toBe("true");
  expect(state.subscriptions).toHaveBeenCalledTimes(subscriptions);
  expect(state.refresh).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain(longMessage);
  expect(document.body.textContent).toContain("raw.log.span");
  expect(document.body.textContent).toContain("ERROR");
  expect(document.body.textContent).toContain("诊断结果可能不完整。raw file diagnostic: ENOENT");
  await click("复制追踪 ID");
  expect(state.copy).toHaveBeenCalledExactlyOnceWith(traceId);
  expect(button("已复制追踪 ID")).toBeDefined();
  await click("显示完整消息");
  expect(buttons("收起")).toHaveLength(2);
  await language("en");
  expect(buttons("Show less")).toHaveLength(2);
  expect(state.copy).toHaveBeenCalledOnce();
});

it("preserves pending log opening and re-translates a retained own fallback without reopening", async () => {
  const open = deferred<{ _tag: "Failure" }>();
  state.open.mockReturnValue(open.promise);
  await render();
  await click("Open logs folder");
  await language("zh");
  expect(button("打开日志文件夹").disabled).toBe(true);
  expect(state.open).toHaveBeenCalledExactlyOnceWith("/raw/logs/path");
  await act(async () => open.resolve({ _tag: "Failure" }));
  expect(document.body.textContent).toContain("raw controlled failure: EACCES");
  expect(button("打开日志文件夹").disabled).toBe(false);
  await language("en");
  expect(state.open).toHaveBeenCalledOnce();
  state.squash.mockReturnValue("non-Error rejection");
  state.open.mockResolvedValue({ _tag: "Failure" });
  await click("Open logs folder");
  expect(document.body.textContent).toContain("Unable to open logs folder.");
  await language("zh");
  expect(document.body.textContent).toContain("无法打开日志文件夹。");
  expect(state.open).toHaveBeenCalledTimes(2);
});

it("cancels confirmation without signaling and preserves native identity when confirming after a language change", async () => {
  const first = deferred<boolean>();
  state.confirm.mockReturnValueOnce(first.promise);
  await render();
  await click("Send SIGKILL");
  expect(state.confirm).toHaveBeenCalledExactlyOnceWith(
    "Send SIGKILL to process 200? This cannot be handled by the process.",
    { variant: "destructive" },
  );
  await language("zh");
  expect(button("发送 SIGKILL").disabled).toBe(true);
  expect(state.confirm).toHaveBeenCalledOnce();
  await act(async () => first.resolve(false));
  expect(state.signal).not.toHaveBeenCalled();
  await click("发送 SIGKILL");
  expect(state.confirm).toHaveBeenLastCalledWith(
    "向进程 200 发送 SIGKILL？该信号无法被进程捕获或处理。",
    { variant: "destructive" },
  );
  expect(state.signal).toHaveBeenCalledExactlyOnceWith({
    environmentId: "raw-diagnostic-host",
    input: { pid: 200, startTimeMs: 12345, signal: "SIGKILL" },
  });
  expect(state.refresh).toHaveBeenCalledExactlyOnceWith("processes");
});

it("keeps the permission check after confirmation and does not send when access is revoked", async () => {
  const confirmation = deferred<boolean>();
  state.confirm.mockReturnValue(confirmation.promise);
  await render();
  await click("Send SIGKILL");
  state.maintain = false;
  await language("zh");
  await act(async () => confirmation.resolve(true));
  expect(state.signal).not.toHaveBeenCalled();
  expect(button("发送 SIGINT").disabled).toBe(true);
});

it("reports an asynchronous native failure in the completion language without repeating the signal", async () => {
  const signal = deferred<{ _tag: "Failure" }>();
  state.signal.mockReturnValue(signal.promise);
  await render();
  await click("Send SIGINT");
  await language("zh");
  expect(state.signal).toHaveBeenCalledExactlyOnceWith({
    environmentId: "raw-diagnostic-host",
    input: { pid: 200, startTimeMs: 12345, signal: "SIGINT" },
  });
  await act(async () => signal.resolve({ _tag: "Failure" }));
  expect(state.toast).toHaveBeenCalledExactlyOnceWith({
    type: "error",
    title: "无法发送 SIGINT",
    description: "raw controlled failure: EACCES",
  });
  expect(state.refresh).not.toHaveBeenCalled();
});

it("translates access denial and pending/empty states without requesting protected diagnostics", async () => {
  state.session = { authenticated: true, scopes: [] };
  await render();
  await language("zh");
  expect(document.body.textContent).toContain("此连接没有诊断和用量访问权限。");
  expect(state.subscriptions).toHaveBeenCalledExactlyOnceWith("session");
  state.session = null;
  await render();
  expect(document.body.textContent).toContain("正在检查诊断访问权限…");
  state.connected = false;
  await render();
  expect(document.body.textContent).toContain("连接执行环境以查看诊断。");
  expect(state.signal).not.toHaveBeenCalled();
});
