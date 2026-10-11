import { createI18n } from "../i18n/index.ts";
import { EnvironmentAuthInvalidError, EnvironmentId } from "@t3tools/contracts";
import { RelayEnvironmentLinkLimitExceededError } from "@t3tools/contracts/relay";
import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";

import {
  BearerConnectionProfile,
  type ConnectionCatalogEntry,
  type ConnectionRoute,
} from "./catalog.ts";
import {
  BearerConnectionTarget,
  ConnectionBlockedError,
  ConnectionTransientError,
  RelayConnectionTarget,
  type SupervisorConnectionState,
} from "./model.ts";
import {
  connectionCatalogDisplayUrl,
  environmentMcpUrl,
  connectionStatusText,
  connectionStatusTitle,
  formatConnectionErrorMessage,
  presentEnvironmentConnection,
  presentConnectionState,
} from "./presentation.ts";
import {
  RemoteEnvironmentAuthFetchError,
  RemoteEnvironmentAuthTimeoutError,
  RemoteEnvironmentAuthUndeclaredStatusError,
} from "../rpc/http.ts";
import {
  mapManagedRelayError,
  mapRemoteDpopEnvironmentError,
  mapRemoteEnvironmentError,
} from "./errors.ts";
import {
  ManagedRelayRequestFailedError,
  ManagedRelayRequestTimeoutError,
} from "../relay/managedRelay.ts";
import { relayProtectedErrorMessage } from "../relay/errorPresentation.ts";
import { NETWORK_BLOCKING_HINT } from "../errors/network.ts";

const TARGET = new BearerConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Remote environment",
  connectionId: "connection-1",
});

const ENTRY: ConnectionCatalogEntry = {
  target: TARGET,
  profile: Option.some(
    new BearerConnectionProfile({
      connectionId: TARGET.connectionId,
      environmentId: TARGET.environmentId,
      label: TARGET.label,
      httpBaseUrl: "https://environment.example.test",
      wsBaseUrl: "wss://environment.example.test",
    }),
  ),
  enabled: true,
};

function supervisorState(overrides: Partial<SupervisorConnectionState>): SupervisorConnectionState {
  return {
    desired: true,
    network: "online",
    phase: "connecting",
    stage: "preparing",
    attempt: 1,
    generation: 0,
    lastFailure: null,
    retryAt: null,
    ...overrides,
  };
}

describe("connection presentation", () => {
  it("labels a blocked protocol as unsupported", () => {
    const connection = presentConnectionState(
      supervisorState({
        phase: "blocked",
        lastFailure: new ConnectionBlockedError({
          reason: "unsupported",
          detail: "Update your app.",
        }),
      }),
    );
    expect(connection.phase).toBe("unsupported");
    expect(connection.error).toBe("Update your app.");
    expect(connectionStatusText(connection)).toBe("Client not supported");
  });

  it("preserves profile display information without exposing credentials", () => {
    expect(connectionCatalogDisplayUrl(ENTRY)).toBe("https://environment.example.test");
  });

  it("copies the MCP address of the route this device is connected over", () => {
    const route = (connectionId: string, httpBaseUrl: string): ConnectionRoute => {
      const target = new BearerConnectionTarget({ ...TARGET, connectionId });
      return {
        target,
        profile: Option.some(
          new BearerConnectionProfile({
            connectionId,
            environmentId: TARGET.environmentId,
            label: TARGET.label,
            httpBaseUrl,
            wsBaseUrl: httpBaseUrl.replace(/^http/, "ws"),
          }),
        ),
      };
    };
    const lan = route("lan", "http://192.168.4.53:3773/");
    const tailnet = route("tailnet", "http://100.115.1.44:3773/");
    const serve = route("serve", "https://machine.tailnet.ts.net/");
    const entry: ConnectionCatalogEntry = {
      ...ENTRY,
      target: lan.target,
      profile: lan.profile,
      alternateRoutes: [tailnet, serve],
    };

    expect(environmentMcpUrl({ entry, connectedTarget: tailnet.target })).toBe(
      "http://100.115.1.44:3773/mcp",
    );
    // Not connected: the preferred route, plain http or not.
    expect(environmentMcpUrl({ entry })).toBe("http://192.168.4.53:3773/mcp");
  });

  it("passes over routes without an address of their own", () => {
    const relay = new RelayConnectionTarget({
      environmentId: TARGET.environmentId,
      label: TARGET.label,
    });
    const entry: ConnectionCatalogEntry = {
      ...ENTRY,
      target: relay,
      profile: Option.none(),
      alternateRoutes: [{ target: ENTRY.target, profile: ENTRY.profile }],
    };

    // Relay discovery has not reported the tunnel address yet.
    expect(environmentMcpUrl({ entry, connectedTarget: relay })).toBe(
      "https://environment.example.test/mcp",
    );
    expect(
      environmentMcpUrl({
        entry,
        connectedTarget: relay,
        relayHttpBaseUrl: "https://tunnel.example.test",
      }),
    ).toBe("https://tunnel.example.test/mcp");
  });

  it("distinguishes initial connection, reconnect, and retry errors", () => {
    expect(presentConnectionState(supervisorState({ phase: "connecting", attempt: 1 }))).toEqual({
      phase: "connecting",
      error: null,
      traceId: null,
    });
    expect(
      presentConnectionState(
        supervisorState({
          phase: "connecting",
          attempt: 2,
          lastFailure: new ConnectionTransientError({
            reason: "transport",
            detail: "Socket closed.",
            traceId: "trace-previous",
          }),
        }),
      ),
    ).toEqual({
      phase: "reconnecting",
      error: "Socket closed.",
      traceId: "trace-previous",
    });
    expect(
      presentConnectionState(
        supervisorState({
          phase: "backoff",
          attempt: 2,
          retryAt: 1,
          lastFailure: new ConnectionTransientError({
            reason: "transport",
            detail: "Disconnected.",
            traceId: "trace-1",
          }),
        }),
      ),
    ).toEqual({
      phase: "reconnecting",
      error: "Disconnected.",
      traceId: "trace-1",
    });
  });

  it("preserves the latest failure while the next attempt is active", () => {
    expect(
      presentEnvironmentConnection(
        supervisorState({
          phase: "connecting",
          stage: "opening",
          attempt: 2,
          lastFailure: new ConnectionTransientError({
            reason: "transport",
            detail: "Relay connection timed out.",
            traceId: "trace-retry",
          }),
        }),
      ),
    ).toEqual({
      phase: "reconnecting",
      error: "Relay connection timed out.",
      traceId: "trace-retry",
    });
  });

  it("combines reconnect progress with the latest failure", () => {
    const connection = {
      phase: "reconnecting",
      error: "Relay request timed out.",
      traceId: "trace-retry",
    } as const;
    expect(connectionStatusText(connection)).toBe(
      "Failed to connect. Reconnecting... Reason: Relay request timed out.",
    );
    expect(connectionStatusTitle(connection)).toBe("Failed to connect. Reconnecting...");
  });

  it("presents the supervisor's offline state without consulting shell state", () => {
    expect(
      presentEnvironmentConnection(
        supervisorState({
          network: "offline",
          phase: "offline",
          stage: null,
        }),
      ),
    ).toEqual({
      phase: "offline",
      error: null,
      traceId: null,
    });
  });

  it("presents a connected supervisor snapshot as connected", () => {
    expect(
      presentEnvironmentConnection(
        supervisorState({
          phase: "connected",
          stage: null,
          generation: 1,
        }),
      ),
    ).toEqual({
      phase: "connected",
      error: null,
      traceId: null,
    });
  });

  it("preserves an explicitly available environment while offline", () => {
    expect(
      presentEnvironmentConnection(
        supervisorState({
          desired: false,
          network: "offline",
          phase: "available",
          stage: null,
          attempt: 0,
        }),
      ),
    ).toEqual({
      phase: "available",
      error: null,
      traceId: null,
    });
  });
});

it("translates connection status while keeping the original error reason and source-language default", () => {
  const t = createI18n({ lng: "zh" }).t;
  const connection = {
    phase: "reconnecting" as const,
    error: "ECONNREFUSED host.example:3773",
    traceId: "trace-1",
  };
  expect(connectionStatusText(connection, t)).toBe(
    "连接失败，正在重新连接…原因：ECONNREFUSED host.example:3773",
  );
  expect(connectionStatusTitle(connection, t)).toBe("连接失败，正在重新连接…");
  expect(connectionStatusText(connection)).toBe(
    "Failed to connect. Reconnecting... Reason: ECONNREFUSED host.example:3773",
  );
  expect(connection).toEqual({
    phase: "reconnecting",
    error: "ECONNREFUSED host.example:3773",
    traceId: "trace-1",
  });
});

it("translates HTTP connection failures at presentation time while preserving their source diagnostics", () => {
  const i18n = createI18n({ lng: "zh" });
  const url = "http://127.0.0.1:16171/.well-known/t3/environment?raw=A%26B";
  const diagnostic = `HttpClientError: Transport error (GET ${url})\n原文 & <keep>`;
  const failures = [
    new RemoteEnvironmentAuthFetchError({
      message: `Failed to fetch remote environment endpoint ${url} (${diagnostic}).`,
      cause: new Error(diagnostic),
    }),
    new RemoteEnvironmentAuthTimeoutError(url, 10000),
    new RemoteEnvironmentAuthUndeclaredStatusError(url, 503),
  ];
  const translated = failures.map((failure) =>
    formatConnectionErrorMessage(mapRemoteEnvironmentError(failure).message, i18n.t),
  );
  expect(translated).toEqual([
    `无法获取远程执行环境端点 ${url}（${diagnostic}）。`,
    `远程执行环境端点 ${url} 在 10000 毫秒后超时。`,
    `远程执行环境端点 ${url} 返回了未声明的状态码 503。`,
  ]);
  for (const failure of failures) {
    expect(formatConnectionErrorMessage(failure.message)).toBe(failure.message);
    expect(formatConnectionErrorMessage(failure.message, createI18n({ lng: "en" }).t)).toBe(
      failure.message,
    );
  }
});

it("translates known authentication failures and machine mismatch labels, leaving unknown errors alone", () => {
  const t = createI18n({ lng: "zh" }).t;
  expect(
    connectionStatusText(
      { phase: "error", error: "The environment credential is invalid.", traceId: "trace-raw" },
      t,
    ),
  ).toBe("连接失败。原因：执行环境凭据无效。");
  const label = "QA (原文), host & <keep>";
  expect(
    formatConnectionErrorMessage(
      `That address reaches ${label}, a different machine. Add it as its own environment instead.`,
      t,
    ),
  ).toBe(`该地址指向另一台机器 ${label}。请将其添加为单独的执行环境。`);
  const unknown = "Unknown network diagnostic 原文 & <keep>";
  expect(formatConnectionErrorMessage(unknown, t)).toBe(unknown);
});

it("localizes real relay failures and their network hints without changing the failure or trace", () => {
  const failed = new ManagedRelayRequestFailedError({
    action: "list relay-managed environments",
    transportFailed: true,
    cause: new TypeError("Network 原文 /tmp/404"),
    traceId: "trace-raw",
  });
  const timeout = new ManagedRelayRequestTimeoutError({
    activity: "Relay environment listing",
    timeoutMs: 10000,
    traceId: null,
  });
  const t = createI18n({ lng: "zh" }).t;
  const hint = "DNS 或防火墙可能阻止了 T3 Connect。请尝试其他网络，例如手机热点。";
  expect(formatConnectionErrorMessage(mapManagedRelayError(failed).message, t)).toBe(
    `无法获取中继托管的执行环境列表。 ${hint}`,
  );
  expect(formatConnectionErrorMessage(mapManagedRelayError(timeout).message, t)).toBe(
    `获取中继托管的执行环境列表时超时。 ${hint}`,
  );
  expect(mapManagedRelayError(failed).traceId).toBe("trace-raw");
  expect(failed.message).toBe(
    `Could not list relay-managed environments. ${NETWORK_BLOCKING_HINT}`,
  );
  expect(formatConnectionErrorMessage(failed.message)).toBe(failed.message);
  expect(formatConnectionErrorMessage(failed.message, createI18n({ lng: "en" }).t)).toBe(
    failed.message,
  );
});

it("translates relay HTTP guidance and keeps the endpoint and multiline diagnostic verbatim", () => {
  const url = "https://relay.example.test/.well-known/t3/environment?raw=A%26B";
  const diagnostic = "GET failed\nNetwork /tmp/原文 <keep>";
  const failure = mapRemoteEnvironmentError(
    new RemoteEnvironmentAuthFetchError({
      message: `Failed to fetch remote environment endpoint ${url} (${diagnostic}).`,
      cause: new Error(diagnostic),
    }),
    "relay",
  );
  expect(formatConnectionErrorMessage(failure.message, createI18n({ lng: "zh" }).t)).toBe(
    `无法获取远程执行环境端点 ${url}（${diagnostic}）。 DNS 或防火墙可能阻止了 T3 Connect。请尝试其他网络，例如手机热点。`,
  );
  expect(formatConnectionErrorMessage(failure.message, createI18n({ lng: "en" }).t)).toBe(
    failure.message,
  );
});

it.each([
  ["time_window", "提示：请确认两台设备都已启用自动设置日期和时间，然后重试。"],
  ["key_mismatch", "提示：请重试。如果问题持续存在，请复制追踪 ID。"],
  [
    undefined,
    "提示：请重试。如果仍然失败，可能是设备时间不一致；请确认两台设备都已启用自动设置日期和时间。",
  ],
] as const)("keeps the DPoP category and current guidance for %s", (reason, hint) => {
  const error = new EnvironmentAuthInvalidError({
    code: "auth_invalid",
    reason: "invalid_credential",
    ...(reason === undefined ? {} : { dpopFailureReason: reason }),
    traceId: "trace-clock-raw",
  });
  const failure = mapRemoteDpopEnvironmentError(error);
  expect(formatConnectionErrorMessage(failure.message, createI18n({ lng: "zh" }).t)).toBe(
    `执行环境凭据无效。 ${hint}`,
  );
  expect(failure.reason).toBe("authentication");
  expect(failure.traceId).toBe("trace-clock-raw");
  expect(formatConnectionErrorMessage(failure.message, createI18n({ lng: "en" }).t)).toBe(
    failure.message,
  );
});

it("keeps tunnel counts and gives a singular English limit without changing relay messages", () => {
  const error = new RelayEnvironmentLinkLimitExceededError({
    code: "environment_link_limit_exceeded",
    maxTunnels: 1,
    traceId: "trace-limit-raw",
  });
  const message = relayProtectedErrorMessage(error);
  expect(formatConnectionErrorMessage(message, createI18n({ lng: "en" }).t)).toBe(
    "Relay refused the link: this account already has its maximum of 1 managed tunnel. Unlink an environment to free one up.",
  );
  expect(formatConnectionErrorMessage(message, createI18n({ lng: "zh" }).t)).toBe(
    "中继拒绝了关联：此账号已达到 1 条托管隧道的上限。请解除一个执行环境的关联，以释放名额。",
  );
  expect(formatConnectionErrorMessage(message)).toBe(message);
});

it("keeps SSH diagnostics, environment labels and unknown failures intact", () => {
  const t = createI18n({ lng: "zh" }).t;
  const label = "工作电脑 / Raw host";
  const diagnostic = "Error: ssh /tmp/原文\nPermission denied (publickey)";
  expect(
    formatConnectionErrorMessage(`Could not prepare the SSH environment: ${diagnostic}`, t),
  ).toBe(`无法准备 SSH 执行环境：${diagnostic}`);
  expect(
    formatConnectionErrorMessage(
      `This client requires a newer server. Update T3 Code on ${label} to connect.`,
      t,
    ),
  ).toBe(`当前客户端需要更新版本的服务端。请更新 ${label} 上的 T3 Code，再连接。`);
  expect(formatConnectionErrorMessage(diagnostic, t)).toBe(diagnostic);
});
