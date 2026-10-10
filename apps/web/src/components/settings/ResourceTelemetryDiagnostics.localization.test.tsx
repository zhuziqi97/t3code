// @vitest-environment jsdom
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import {
  EnvironmentId,
  type ResourceTelemetrySnapshot,
  type ResourceTelemetryProcess,
  type ResourceTelemetryHistory,
  type ResourceTelemetryHistoryInput,
} from "@t3tools/contracts";

const state = vi.hoisted(() => ({
  data: null as ResourceTelemetrySnapshot | null,
  history: null as ResourceTelemetryHistory | null,
  error: null as string | null,
  maintain: true,
  subscriptions: vi.fn(),
  refresh: vi.fn(),
  refreshHistory: vi.fn(),
  retry: vi.fn(),
  signal: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("../../lib/resourceTelemetryState", () => ({
  useResourceTelemetry: (environmentId: string) => {
    useEffect(() => {
      state.subscriptions("telemetry", environmentId);
    }, [environmentId]);
    return {
      data: state.data,
      error: state.error,
      isPending: false,
      refresh: state.refresh,
      retry: state.retry,
    };
  },
  useResourceTelemetryHistory: (input: ResourceTelemetryHistoryInput, environmentId: string) => {
    useEffect(() => {
      state.subscriptions("history", environmentId, input);
    }, [environmentId, input.windowMs, input.bucketMs]);
    return { data: state.history, error: null, isPending: false, refresh: state.refreshHistory };
  },
}));
vi.mock("../../state/session", () => ({
  useEnvironmentScope: () => state.maintain,
  readEnvironmentScope: () => state.maintain,
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: { signalProcess: "controlled-signal" },
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.signal }));
vi.mock("../../localApi", () => ({
  ensureLocalApi: () => ({ dialogs: { confirm: state.confirm } }),
}));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  isAtomCommandInterrupted: () => false,
  squashAtomCommandFailure: () => new Error("raw native signal failure"),
}));
vi.mock("../ui/toast", () => ({ toastManager: { add: state.toast } }));
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
  useRelativeTimeTick: () => {},
}));

import { changeLanguage } from "../../i18n";
import { ResourceTelemetryDiagnostics } from "./ResourceTelemetryDiagnostics";
const environmentId = EnvironmentId.make("raw-telemetry-host");
const now = DateTime.makeUnsafe("2026-10-10T00:00:00Z");
function process(
  pid: number,
  category: ResourceTelemetryProcess["category"],
  name: string,
  ppid: number,
  childPids: number[],
  depth: number,
): ResourceTelemetryProcess {
  return {
    identity: { pid, startTimeMs: pid * 100 },
    ppid,
    childPids,
    depth,
    name,
    command: `/raw/${name} --keep-raw`,
    status: "R",
    category,
    cpuPercent: 2,
    cpuTimeMs: 5000,
    residentBytes: 2048,
    peakResidentBytes: 4096,
    virtualBytes: 8192,
    ioReadBytes: 2048,
    ioWriteBytes: 1024,
    ioReadBytesPerSecond: 500,
    ioWriteBytesPerSecond: 100,
    ioSemantics: "storage",
    runTimeMs: 60000,
    firstSeenAt: now,
    lastSeenAt: now,
  };
}
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
  for (const mock of [
    state.subscriptions,
    state.refresh,
    state.refreshHistory,
    state.retry,
    state.signal,
    state.confirm,
    state.toast,
  ])
    mock.mockReset();
  state.error = null;
  state.maintain = true;
  state.confirm.mockResolvedValue(true);
  state.signal.mockResolvedValue({
    _tag: "Success",
    value: { signaled: true, message: Option.none() },
  });
  const aggregate = {
    processCount: 1,
    currentCpuPercent: 2,
    cpuTimeMs: 5000,
    currentRssBytes: 2048,
    peakRssBytes: 4096,
    ioReadBytes: 2048,
    ioWriteBytes: 1024,
    ioReadBytesPerSecond: 500,
    ioWriteBytesPerSecond: 100,
    processStarts: 1,
    processExits: 0,
  };
  const health = {
    native: {
      status: "degraded" as const,
      lastSampleAt: Option.some(now),
      lastError: Option.some("raw native counter error"),
    },
    desktop: {
      status: "unavailable" as const,
      lastSampleAt: Option.none(),
      lastError: Option.some("desktop telemetry is unavailable in 'web' mode"),
    },
    sidecarVersion: Option.some("raw-sidecar-v1"),
    sidecarPid: Option.some(99),
    restartCount: 2,
    collectionDurationMicros: 500,
    scannedProcessCount: 5,
    retainedProcessCount: 4,
    inaccessibleProcessCount: 1,
  };
  state.data = {
    readAt: now,
    sampleIntervalMs: 1500,
    processes: [
      process(100, "server", "raw-server", 1, [200], 0),
      process(200, "provider-root", "raw-provider", 100, [201], 1),
      process(201, "server-child", "raw-child", 200, [], 2),
      process(300, "electron-main", "raw-desktop", 1, [], 0),
    ],
    groups: {
      allT3: { ...aggregate, processCount: 4 },
      backend: { ...aggregate, processCount: 2 },
      monitor: aggregate,
      electron: aggregate,
    },
    power: {
      source: "electron-main",
      idle: "false",
      idleSeconds: 2,
      locked: "false",
      suspended: false,
      onBattery: "true",
      lowPowerMode: "unknown",
      thermalState: "serious",
      stale: false,
      updatedAt: now,
    },
    speedLimitPercent: Option.some(75),
    attribution: {
      readAt: now,
      entries: [
        {
          component: "Raw.Component",
          operation: "raw.operation",
          logicalReadBytes: 100,
          logicalWriteBytes: 200,
          count: 2,
          durationMs: 500,
        },
      ],
    },
    health,
  };
  state.history = {
    readAt: now,
    windowMs: 900000,
    bucketMs: 30000,
    sampleIntervalMs: 1500,
    retainedSampleCount: 2,
    buckets: [
      {
        startedAt: now,
        endedAt: now,
        avgCpuPercent: 2,
        maxCpuPercent: 3,
        maxRssBytes: 4096,
        ioReadBytes: 2048,
        ioWriteBytes: 1024,
        maxProcessCount: 4,
      },
    ],
    topProcesses: [],
    health,
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
const render = async () =>
  act(async () => root.render(<ResourceTelemetryDiagnostics environmentId={environmentId} />));
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

it("translates monitor and host states while preserving collapsed identities, selected windows and raw counters", async () => {
  await render();
  expect(document.body.textContent).toContain("1 process");
  expect(document.body.textContent).toContain("2 processes");
  await click("Collapse raw-provider");
  expect(buttons("Send SIGINT")).toHaveLength(1);
  await click("30m");
  const subscriptions = state.subscriptions.mock.calls.length;
  await language("zh");
  expect(button("30 分钟").getAttribute("aria-pressed")).toBe("true");
  expect(button("展开 raw-provider")).toBeDefined();
  expect(buttons("发送 SIGINT")).toHaveLength(1);
  expect(state.subscriptions).toHaveBeenCalledTimes(subscriptions);
  expect(state.subscriptions).toHaveBeenLastCalledWith("history", "raw-telemetry-host", {
    windowMs: 1800000,
    bucketMs: 60000,
  });
  expect(state.refresh).not.toHaveBeenCalled();
  expect(state.refreshHistory).not.toHaveBeenCalled();
  for (const text of [
    "每 1.5 秒 采样一次",
    "部分异常",
    "仅桌面端",
    "电池",
    "未锁定",
    "温度状态：过热",
    "已保留 4/5",
    "1 个进程",
    "2 个进程",
    "Raw.Component",
    "raw.operation",
    "raw-sidecar-v1",
    "raw native counter error",
  ])
    expect(document.body.textContent).toContain(text);
  await click("刷新资源历史");
  expect(state.refreshHistory).toHaveBeenCalledOnce();
  await language("en");
  expect(button("Expand raw-provider")).toBeDefined();
  expect(state.refreshHistory).toHaveBeenCalledOnce();
});

it.each([
  [
    "Resource monitor binary was not found for linux/x64.",
    "未找到适用于 linux/x64 的资源监控程序。",
  ],
  ["Resource monitoring is unsupported on freebsd/arm64.", "freebsd/arm64 不支持资源监控。"],
  [
    "Resource monitor binary at '/tmp/原始路径/monitor' is not executable.",
    "资源监控程序“/tmp/原始路径/monitor”不可执行。",
  ],
])(
  "retranslates the current monitor failure %s while retaining its raw identity",
  async (message, translated) => {
    state.data = {
      ...state.data!,
      health: {
        ...state.data!.health,
        native: {
          ...state.data!.health.native,
          status: "unavailable",
          lastError: Option.some(message),
        },
      },
    };
    await render();
    expect(document.body.textContent).toContain(message);
    const subscriptions = state.subscriptions.mock.calls.length;
    await language("zh");
    expect(document.body.textContent).toContain(translated);
    expect(state.subscriptions).toHaveBeenCalledTimes(subscriptions);
    expect(state.refresh).not.toHaveBeenCalled();
    await language("en");
    expect(document.body.textContent).toContain(message);
  },
);

it("keeps a single pending retry and reports a known access failure in the completion language", async () => {
  const retry = deferred<ResourceTelemetrySnapshot>();
  state.retry.mockReturnValue(retry.promise);
  await render();
  await click("Retry monitor");
  await language("zh");
  expect(button("重试监控").disabled).toBe(true);
  expect(state.retry).toHaveBeenCalledOnce();
  await act(async () =>
    retry.reject(new Error("This connection cannot restart the resource monitor.")),
  );
  expect(state.toast).toHaveBeenCalledExactlyOnceWith({
    type: "error",
    title: "无法重启资源监控",
    description: "此连接无权重启资源监控。",
  });
  expect(button("重试监控").disabled).toBe(false);
  state.maintain = false;
  await render();
  await click("重试监控");
  expect(state.retry).toHaveBeenCalledOnce();
});

it("cancels a translated signal confirmation and then submits the native process identity once", async () => {
  const confirmation = deferred<boolean>();
  state.confirm.mockReturnValueOnce(confirmation.promise);
  await render();
  await click("Send SIGKILL");
  await language("zh");
  expect(state.confirm).toHaveBeenCalledOnce();
  expect(button("发送 SIGKILL").disabled).toBe(true);
  await act(async () => confirmation.resolve(false));
  expect(state.signal).not.toHaveBeenCalled();
  const signal = deferred<{
    _tag: "Success";
    value: { signaled: boolean; message: Option.Option<string> };
  }>();
  state.signal.mockReturnValue(signal.promise);
  await click("发送 SIGINT");
  expect(state.signal).toHaveBeenCalledExactlyOnceWith({
    environmentId: "raw-telemetry-host",
    input: { pid: 200, startTimeMs: 20000, signal: "SIGINT" },
  });
  await language("en");
  expect(state.signal).toHaveBeenCalledOnce();
  await act(async () =>
    signal.resolve({
      _tag: "Success",
      value: { signaled: false, message: Option.some("raw native process rejected the signal") },
    }),
  );
  expect(state.toast).toHaveBeenCalledExactlyOnceWith({
    type: "error",
    title: "Could not send SIGINT",
    description: "raw native process rejected the signal",
  });
  expect(button("Send SIGINT").disabled).toBe(false);
});

it("preserves the post-confirmation permission gate and accurately shows missing desktop host signals", async () => {
  state.data = {
    ...state.data!,
    power: {
      ...state.data!.power,
      idle: "unknown",
      locked: "unknown",
      onBattery: "unknown",
      thermalState: "unknown",
    },
  };
  const confirmation = deferred<boolean>();
  state.confirm.mockReturnValue(confirmation.promise);
  await render();
  await click("Send SIGKILL");
  state.maintain = false;
  await language("zh");
  expect(document.body.textContent).toContain("未连接桌面主机状态");
  expect(document.body.textContent).toContain("此浏览器会话中的进程遥测仍正常运行");
  await act(async () => confirmation.resolve(true));
  expect(state.signal).not.toHaveBeenCalled();
  expect(button("发送 SIGINT").disabled).toBe(true);
});
