import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { createI18n } from "@t3tools/client-runtime/i18n";

import { getProviderSummary, getProviderVersionAdvisoryPresentation } from "./providerStatus";

const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated", label: "ChatGPT" },
  checkedAt: "2026-08-23T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};

describe("getProviderSummary", () => {
  it.each([
    [
      "Timed out while checking Codex app-server provider status.",
      "检查 Codex app-server 状态超时。",
    ],
    ["Codex is disabled in T3 Code settings.", "已在 T3 Code 设置中停用 Codex。"],
    [
      "Codex provider status has not been checked in this session yet.",
      "本次启动后尚未检查 Codex 状态。",
    ],
    [
      "Codex CLI is not authenticated. Run `codex login` and try again.",
      "Codex CLI 尚未登录。请运行 `codex login` 后重试。",
    ],
    [
      "Codex app-server provider probe failed: Keep 原始诊断 /tmp/raw-path.",
      "Codex app-server 状态检查失败：Keep 原始诊断 /tmp/raw-path.",
    ],
    ["Unknown provider error 原文", "Unknown provider error 原文"],
  ])("formats known status guidance and preserves diagnostics: %s", (message, chinese) => {
    const status = { ...provider, status: "error" as const, message };
    expect(getProviderSummary(status, createI18n({ lng: "zh" }).t).detail).toBe(chinese);
    expect(getProviderSummary(status, createI18n({ lng: "en" }).t).detail).toBe(message);
    expect(status.message).toBe(message);
  });

  it("reports ready providers with unknown authentication as available", () => {
    expect(getProviderSummary({ ...provider, auth: { status: "unknown" } })).toEqual({
      headline: "Available",
      detail: null,
    });
  });

  it.each([
    ["Claude is disabled in T3 Code settings.", "已在 T3 Code 设置中停用 Claude。"],
    [
      "Claude provider status has not been checked in this session yet.",
      "本次启动后尚未检查 Claude 状态。",
    ],
    [
      "Claude Agent CLI (`claude`) was not found on PATH.",
      "PATH 中未找到 Claude Agent CLI（`claude`）。",
    ],
    ["Failed to execute Claude Agent CLI health check.", "无法执行 Claude Agent CLI 健康检查。"],
    [
      "Claude Agent CLI is installed but failed to run. Timed out while running command.",
      "Claude Agent CLI 已安装，但运行命令时超时。",
    ],
    ["Claude Agent CLI is installed but failed to run.", "Claude Agent CLI 已安装，但无法运行。"],
    [
      "Could not verify Claude authentication status from initialization result.",
      "无法从初始化结果确认 Claude 的登录状态。",
    ],
    [
      "Claude Code is not authenticated. Run `claude auth login` and try again.",
      "Claude Code 尚未登录。请运行 `claude auth login` 后重试。",
    ],
    ["Checking Antigravity availability.", "正在检查 Antigravity 是否可用。"],
    ["Antigravity is disabled in T3 Code settings.", "已在 T3 Code 设置中停用 Antigravity。"],
    ["Sign in with Google to use Antigravity.", "请使用 Google 账号登录，以使用 Antigravity。"],
    [
      "Antigravity is installed. Google account access is not checked yet.",
      "Antigravity 已安装，尚未检查 Google 账号的访问权限。",
    ],
    ["Set up Codex to get started.", "请先设置 Codex。"],
    ["Sign in with ChatGPT to use Codex.", "请使用 ChatGPT 账号登录，以使用 Codex。"],
    [
      "Signed in with ChatGPT, but token sharing is disabled. Sign in again and enable token sharing, or use another provider.",
      "已使用 ChatGPT 账号登录，但未启用令牌共享。请重新登录并启用令牌共享，或使用其他智能体提供方。",
    ],
    [
      "Could not check Codex right now. Retry, or reconnect in provider settings.",
      "暂时无法检查 Codex。请重试，或在智能体提供方设置中重新连接。",
    ],
  ])(
    "translates application-owned provider guidance without changing English: %s",
    (message, chinese) => {
      const status = { ...provider, message };
      expect(getProviderSummary(status, createI18n({ lng: "zh" }).t).detail).toBe(chinese);
      expect(getProviderSummary(status, createI18n({ lng: "en" }).t).detail).toBe(message);
      expect(status.message).toBe(message);
    },
  );

  it("does not hide a provider error behind a previous authenticated state", () => {
    expect(
      getProviderSummary({
        ...provider,
        status: "error",
        message: "The provider process failed to start.",
      }),
    ).toEqual({
      headline: "Unavailable",
      detail: "The provider process failed to start.",
    });
  });

  it("does not hide a provider warning behind an authenticated state", () => {
    expect(
      getProviderSummary({
        ...provider,
        status: "warning",
        message: "The provider version is unsupported.",
      }),
    ).toEqual({
      headline: "Needs attention",
      detail: "The provider version is unsupported.",
    });
  });

  it("keeps authentication failures actionable when their provider status is error", () => {
    expect(
      getProviderSummary({
        ...provider,
        status: "error",
        auth: { status: "unauthenticated" },
        message: "Run codex login.",
      }),
    ).toEqual({
      headline: "Not authenticated",
      detail: "Run codex login.",
    });
  });

  it("treats a disabled provider status as disabled even before its enabled flag updates", () => {
    expect(getProviderSummary({ ...provider, status: "disabled" }).headline).toBe("Disabled");
  });
});

it("does not suggest copying a command that installs an incompatible latest version", () => {
  const advisory = {
    status: "behind_latest" as const,
    currentVersion: "1.0.0",
    latestVersion: "2.0.0",
    updateCommand: "npm install -g fixture@latest",
    canUpdate: true,
    checkedAt: provider.checkedAt,
    message: null,
  };
  const compatibility = {
    status: "supported" as const,
    latestVersionStatus: "broken" as const,
    message: null,
    recommendedRange: null,
    recommendedVersion: null,
  };
  expect(getProviderVersionAdvisoryPresentation(advisory, compatibility)).toBeNull();
  expect(
    getProviderVersionAdvisoryPresentation(advisory, { ...compatibility, status: "broken" }, false),
  ).toBeNull();
  expect(
    getProviderVersionAdvisoryPresentation(advisory, {
      ...compatibility,
      latestVersionStatus: "supported",
    }),
  ).not.toBeNull();
});

it("shows compatibility in the version popover even when the installed version is current", () => {
  const advisory = {
    status: "current" as const,
    currentVersion: "2.0.0",
    latestVersion: "2.0.0",
    updateCommand: "npm install -g fixture@latest",
    canUpdate: true,
    checkedAt: provider.checkedAt,
    message: null,
  };
  const compatibility = {
    status: "broken" as const,
    latestVersionStatus: "broken" as const,
    message: "This version drops turns. Use 1.9.0.",
    recommendedRange: null,
    recommendedVersion: "1.9.0",
  };
  expect(getProviderVersionAdvisoryPresentation(advisory, compatibility)).toEqual({
    title: "Known broken version",
    detail: compatibility.message,
    updateCommand: null,
    emphasis: "strong",
    targetVersion: "1.9.0",
  });
  expect(
    getProviderVersionAdvisoryPresentation(undefined, {
      ...compatibility,
      status: "graceful",
      recommendedVersion: null,
      recommendedRange: ">=2.1.0",
      message: null,
    }),
  ).toEqual({
    title: "Limited support",
    detail: "Use >=2.1.0 for full support.",
    updateCommand: null,
    emphasis: "normal",
    targetVersion: null,
  });
});

describe("provider status copy", () => {
  it("surfaces an ACP-advertised authentication method", () => {
    const provider = {
      enabled: true,
      installed: true,
      status: "error",
      auth: { status: "unauthenticated", type: "agent", label: "Company login" },
      message: "Complete this authentication method on the server.",
    } as ServerProvider;

    expect(getProviderSummary(provider)).toEqual({
      headline: "Not authenticated · Company login",
      detail: "Complete this authentication method on the server.",
    });
  });
});
