import { searchableSetting } from "./settingsSearch";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  makeProviderSettingsSchema,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import { UNKNOWN_SOURCE_CONTROL_CLIENT } from "@t3tools/client-runtime/source-control-clients";
import * as Schema from "effect/Schema";

import {
  filterAvailableSettingsSearchItems,
  getSettingsSearchTargetScope,
  getThreadAutoSettlementSearchAvailability,
  isSettingsSearchScopeAvailable,
  movedSettingsPath,
  searchSettings,
  SETTINGS_SEARCH_ITEMS,
  sourceControlHostSearchItems,
  sourceControlHostSettingsSearchId,
  type SettingsSearchItem,
} from "./settingsSearch";

import { changeLanguage } from "../../i18n";

afterEach(async () => {
  await changeLanguage("en");
});

const ITEMS: ReadonlyArray<SettingsSearchItem> = [
  {
    id: "word-wrap",
    title: "Word wrap",
    to: "/settings/general",
    searchTerms: ["long lines in code previews"],
  },
  {
    id: "network-access",
    title: "Network access",
    to: "/settings/access",
    searchTerms: ["remote pairing backend"],
  },
  {
    id: "providers",
    title: "Providers",
    to: "/settings/providers",
    searchTerms: ["claude codex agents"],
  },
  {
    id: "provider-updates",
    title: "Update checks",
    to: "/settings/general",
  },
  {
    id: "automatic-updates",
    title: "Automatic updates",
    to: "/settings/general",
  },
];

describe("searchSettings", () => {
  it("finds PR thread retention in Chinese and keeps its destination across languages", async () => {
    await changeLanguage("zh");
    expect(searchSettings("保留有 PR 的会话")[0]).toMatchObject({
      id: "keep-threads-with-pull-requests",
      title: "保留有 PR 的会话",
      to: "/settings/threads",
      targetId: "auto-settle-inactive-threads",
    });
    await changeLanguage("en");
    expect(searchSettings("Keep threads with a PR")[0]).toMatchObject({
      id: "keep-threads-with-pull-requests",
      title: "Keep threads with a PR",
      to: "/settings/threads",
      targetId: "auto-settle-inactive-threads",
    });
  });

  it("finds the existing connection entries for relay installation and server update in Chinese", async () => {
    await changeLanguage("zh");
    expect(searchSettings("安装中继").map((item) => item.id)).not.toContain("t3-connect");
    expect(searchSettings("服务端更新").map((item) => item.id)).toContain("remote-environments");
    expect(searchSettings("重新启动命令").map((item) => item.id)).toContain(
      "connections-environment",
    );
  });
  it.each(["OTel", "OTLP", "telemetry export", "Grafana"])(
    "finds environment telemetry settings for %s",
    (query) => {
      expect(searchSettings(query)).toContainEqual(
        expect.objectContaining({
          id: "telemetry-export",
          to: "/settings/diagnostics",
          targetId: "telemetry-export",
          scope: "environment",
        }),
      );
    },
  );
  it.each(["send shortcut", "multiline", "new line"])("finds Send shortcut for %s", (query) => {
    expect(searchSettings(query).map((item) => item.id)).toContain("send-shortcut");
  });

  it("matches titles, sections, and remembered setting details", async () => {
    expect(searchSettings("word", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
    expect(searchSettings("network", ITEMS).map((item) => item.id)).toEqual(["network-access"]);
    expect(searchSettings("sharing", ITEMS).map((item) => item.id)).toEqual(["network-access"]);
    expect(searchSettings("claude", ITEMS).map((item) => item.id)).toEqual(["providers"]);
    expect(searchSettings("long lines", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
    await changeLanguage("zh");
    expect(searchSettings("诊断").map((item) => item.id)).toContain("telemetry-export");
  });

  it("matches normalized title substrings", () => {
    expect(searchSettings("  WORD   WRAP  ", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
    expect(searchSettings("glass").map((item) => item.id)).toEqual(["setting-glass-opacity"]);
    expect(searchSettings("panel animations").map((item) => item.id)).toEqual(["panel-animations"]);
    expect(searchSettings("thè\u{1ab0}mes")[0]?.id).toBe("theme");
    const localeLowerCase = vi.spyOn(String.prototype, "toLocaleLowerCase").mockReturnValue("gıt");
    try {
      expect(searchSettings("GIT")[0]?.id).toBe("git-fetch-interval");
      expect(localeLowerCase).not.toHaveBeenCalled();
    } finally {
      localeLowerCase.mockRestore();
    }
    expect(searchSettings("xyzzy")).toEqual([]);
  });

  it("matches query words across fields and ranks the strongest result first", () => {
    expect(searchSettings("pairing remote", ITEMS).map((item) => item.id)).toEqual([
      "network-access",
    ]);
    expect(
      searchSettings("remote pairing")
        .slice(0, 2)
        .map((item) => item.id),
    ).toEqual(["network-access", "connections-environment"]);
  });

  it("finds settings that used to be reachable only through their section", () => {
    expect(searchSettings("pull request template")[0]?.id).toBe("follow-change-request-templates");
    expect(searchSettings("git security keys")[0]?.id).toBe("git-fetch-interval");
    expect(searchSettings("push notifications")[0]?.id).toBe("publish-agent-activity");
    expect(searchSettings("battery saver")[0]?.id).toBe("background-activity");
    expect(searchSettings("binary path")[0]?.id).toBe("providers");
    expect(searchSettings("Antigravity")[0]?.id).toBe("providers");
    expect(searchSettings("Google sign in")[0]?.id).toBe("providers");
    expect(searchSettings("authorized clients")[0]?.id).toBe("connections-environment");
    expect(searchSettings("administrative access")[0]?.id).toBe("connections-environment");
  });

  it("lists thread confirmations in panel order", () => {
    expect(searchSettings("confirmation").map((item) => item.id)).toEqual([
      "unpin-confirmation",
      "archive-confirmation",
      "delete-confirmation",
    ]);
  });

  it.each([
    "usage providers",
    "CLIProxyAPI",
    "CLI proxy hub",
    "management key",
    "用量来源",
    "管理密钥",
    "添加服务",
  ])("finds usage-provider management by %s", (query) => {
    expect(searchSettings(query)[0]).toMatchObject({
      id: "usage-providers",
      to: "/settings/providers",
    });
  });

  it.each([
    ["Git 工作树位置", "storage-worktrees-location"],
    ["闲置工作树", "storage-worktrees"],
    ["轮转日志", "storage-artifacts"],
  ])("finds the storage setting for %s", async (query, id) => {
    await changeLanguage("zh");
    expect(searchSettings(query)[0]).toMatchObject({
      id,
      to: id === "storage-artifacts" ? "/settings/maintenance" : "/settings/worktrees",
    });
  });

  it("returns no results for an empty query", () => {
    expect(searchSettings("   ", ITEMS)).toEqual([]);
  });

  it("hides desktop-only settings from browser search", () => {
    expect(SETTINGS_SEARCH_ITEMS.some((item) => item.id === "quit-confirmation")).toBe(true);
    expect(searchSettings("hold to quit")).toEqual([]);
    expect(searchSettings("wsl")).toEqual([]);
    expect(searchSettings("update track")).toEqual([]);
  });

  it("hides settings whose controls are unavailable", () => {
    const available = filterAvailableSettingsSearchItems({
      hasCloudPublicConfig: false,
      hasEnvironment: false,
      hasProviderSettingsEnvironment: false,
      hasMacProviderSettingsEnvironment: false,
      canManageLocalBackend: false,
      isWslSettingsRowVisible: false,
      hasThreadAutoSettlement: false,
    });

    const gatedIds = new Set<string>([
      "follow-change-request-templates",
      "git-fetch-interval",
      "network-access",
      "publish-agent-activity",
      "provider-health-check-interval",
      "cursor-keychain-usage",
      "source-control-writer-model",
      "review-guide-model",
      "review-guide-instructions",
      "source-control-writing-style",
      "t3-connect",
      "hold-webhooks-while-offline",
      "tailscale-https",
      "wsl-backend",
      "auto-settle-inactive-threads",
      "auto-settle-merged-threads",
      "days-before-auto-settle",
      "keep-threads-with-pull-requests",
      "linked-environments",
    ]);
    expect(available.map((item) => item.id).filter((id) => gatedIds.has(id))).toEqual([]);
  });

  it("offers Cursor Keychain settings only when a macOS provider environment is available", () => {
    const availability = {
      hasCloudPublicConfig: false,
      hasEnvironment: true,
      hasProviderSettingsEnvironment: true,
      hasMacProviderSettingsEnvironment: false,
      canManageLocalBackend: false,
      isWslSettingsRowVisible: false,
      hasThreadAutoSettlement: false,
    };
    const itemIds = (macAvailable: boolean) =>
      filterAvailableSettingsSearchItems({
        ...availability,
        hasMacProviderSettingsEnvironment: macAvailable,
      }).map((item) => item.id);
    expect(itemIds(false)).not.toContain("cursor-keychain-usage");
    expect(itemIds(true)).toContain("cursor-keychain-usage");
  });

  it("keeps the local toggle searchable without offering hidden host publishing controls", () => {
    const availability = {
      hasCloudPublicConfig: true,
      hasEnvironment: true,
      hasProviderSettingsEnvironment: true,
      hasMacProviderSettingsEnvironment: false,
      canManageLocalBackend: false,
      isWslSettingsRowVisible: false,
      hasThreadAutoSettlement: false,
    };
    const remoteOnly = filterAvailableSettingsSearchItems({
      ...availability,
      localEnvironmentDisabled: true,
    }).map((item) => item.id);
    expect(remoteOnly).toContain("local-environment");
    expect(remoteOnly).not.toContain("t3-connect");
    expect(remoteOnly).not.toContain("publish-agent-activity");
    expect(remoteOnly).not.toContain("wsl-backend");
    const browser = filterAvailableSettingsSearchItems(availability).map((item) => item.id);
    expect(browser).toContain("t3-connect");
    expect(
      searchSettings("T3 Connect", filterAvailableSettingsSearchItems(availability)),
    ).not.toContainEqual(
      expect.objectContaining({ id: "t3-connect", targetId: "connections-environment" }),
    );
    expect(browser).toContain("publish-agent-activity");
  });

  it("offers webhook holding only while the managed tunnel is on, like its row", () => {
    const availability = {
      hasCloudPublicConfig: true,
      hasEnvironment: true,
      hasProviderSettingsEnvironment: true,
      hasMacProviderSettingsEnvironment: false,
      canManageLocalBackend: true,
      isWslSettingsRowVisible: false,
      hasThreadAutoSettlement: false,
    };
    const itemIds = (managedTunnelActive: boolean) =>
      filterAvailableSettingsSearchItems({ ...availability, managedTunnelActive }).map(
        (item) => item.id,
      );
    expect(itemIds(false)).not.toContain("hold-webhooks-while-offline");
    expect(itemIds(true)).toContain("hold-webhooks-while-offline");
  });

  it("shows automatic settlement settings when the server supports them", () => {
    const available = filterAvailableSettingsSearchItems({
      hasCloudPublicConfig: false,
      hasEnvironment: false,
      hasProviderSettingsEnvironment: false,
      hasMacProviderSettingsEnvironment: false,
      canManageLocalBackend: false,
      isWslSettingsRowVisible: false,
      hasThreadAutoSettlement: true,
    });

    expect(searchSettings("auto-settle", available).map((item) => item.id)).toEqual([
      "auto-settle-inactive-threads",
      "auto-settle-merged-threads",
      "days-before-auto-settle",
      "keep-threads-with-pull-requests",
    ]);
  });

  it("finds linked environments on a remote host without local maintenance access", () => {
    const availability = {
      hasCloudPublicConfig: false,
      hasEnvironment: true,
      hasProviderSettingsEnvironment: true,
      hasMacProviderSettingsEnvironment: false,
      canManageLocalBackend: false,
      localEnvironmentDisabled: true,
      isWslSettingsRowVisible: false,
      hasThreadAutoSettlement: false,
    };
    const results = (hasPeerLinkHost: boolean) =>
      searchSettings(
        "linked environments",
        filterAvailableSettingsSearchItems({ ...availability, hasPeerLinkHost }),
      );
    expect(results(false).map((item) => item.id)).not.toContain("linked-environments");
    expect(results(true)).toContainEqual(
      expect.objectContaining({
        id: "linked-environments",
        to: "/settings/connections",
        targetId: "linked-environments",
      }),
    );
  });

  it("finds keybinding commands by label, command id, and default key", () => {
    expect(searchSettings("toggle sidebar")[0]?.id).toBe("keybinding-sidebar.toggle");
    expect(searchSettings("sidebar.toggle")[0]?.id).toBe("keybinding-sidebar.toggle");
    expect(searchSettings("mod+b")[0]?.id).toBe("keybinding-sidebar.toggle");
    expect(searchSettings("copy link")[0]).toMatchObject({
      id: "keybinding-thread.copyReference",
      to: "/settings/keybindings",
    });
  });

  it("sends commands without a default binding to the section", () => {
    expect(searchSettings("thread.stop")[0]).toMatchObject({
      id: "keybinding-thread.stop",
      targetId: "keybindings",
    });
    expect(searchSettings("sidebar.toggle")[0]?.targetId).toBeUndefined();
  });

  it("keeps catalog result ids unique", () => {
    const ids = SETTINGS_SEARCH_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("settings search targets", () => {
  it("requires an environment for the resolved telemetry export destination", () => {
    const result = searchSettings("OpenTelemetry export").find(
      (item) => item.id === "telemetry-export",
    )!;
    const target = getSettingsSearchTargetScope(result.targetId ?? result.id)!;
    expect(isSettingsSearchScopeAvailable(target.scope, "all")).toBe(false);
    expect(isSettingsSearchScopeAvailable(target.scope, "project")).toBe(false);
    expect(isSettingsSearchScopeAvailable(target.scope, "environment")).toBe(true);
  });

  it("keeps environment-wide settings out of project scopes", () => {
    const updates = getSettingsSearchTargetScope("provider-update-checks")!;
    expect(updates.scope).toBe("environment-defaults");
    expect(isSettingsSearchScopeAvailable(updates.scope, "environment")).toBe(true);
    expect(isSettingsSearchScopeAvailable(updates.scope, "all")).toBe(true);
    expect(isSettingsSearchScopeAvailable(updates.scope, "project")).toBe(false);
    const streaming = getSettingsSearchTargetScope("response-streaming")!;
    expect(streaming.scope).toBe("project-defaults");
    expect(isSettingsSearchScopeAvailable(streaming.scope, "project")).toBe(true);
    for (const id of ["legacy-plan-mode", "legacy-context-window-indicator", "boring-sidebar"]) {
      expect(getSettingsSearchTargetScope(id)!.scope).toBeNull();
    }
  });
});

describe("auto-settlement search availability", () => {
  function environment(id: string, { connected = true, loaded = true } = {}) {
    return {
      environmentId: EnvironmentId.make(id),
      connection: { phase: connected ? ("connected" as const) : ("offline" as const) },
      serverConfig: loaded ? { environment: { capabilities: {} } } : null,
    };
  }

  const capable = environment("capable");
  const offline = environment("offline", { connected: false });
  const loading = environment("loading", { loaded: false });
  const environments = [capable, offline, loading];

  it("keeps results discoverable when one connected environment supports them", () => {
    const availability = getThreadAutoSettlementSearchAvailability(environments);
    expect(availability.eligibleEnvironmentIds).toEqual([capable.environmentId]);
    const items = filterAvailableSettingsSearchItems({
      hasCloudPublicConfig: false,
      hasEnvironment: true,
      hasProviderSettingsEnvironment: true,
      hasMacProviderSettingsEnvironment: false,
      canManageLocalBackend: false,
      isWslSettingsRowVisible: false,
      hasThreadAutoSettlement: availability.eligibleEnvironmentIds.length > 0,
    });
    expect(searchSettings("auto-settle", items).map((item) => item.id)).toEqual([
      "auto-settle-inactive-threads",
      "auto-settle-merged-threads",
      "days-before-auto-settle",
      "keep-threads-with-pull-requests",
    ]);
  });

  it.each([offline, loading])(
    "does not render the target on $environmentId or silently fall back",
    (selected) => {
      expect(
        getThreadAutoSettlementSearchAvailability(environments, {
          kind: "environment",
          environmentIds: [selected.environmentId],
        }),
      ).toEqual({ eligibleEnvironmentIds: [capable.environmentId], isTargetAvailable: false });
    },
  );

  it("ignores offline and unloaded targets when all connected targets support the setting", () => {
    const selected = [capable, offline, loading];
    expect(
      getThreadAutoSettlementSearchAvailability(selected, {
        kind: "all",
        environmentIds: selected.map((entry) => entry.environmentId),
      }).isTargetAvailable,
    ).toBe(true);
  });
});

it("finds Chinese settings with the same destination after a language switch", async () => {
  const before = searchSettings("send shortcut").find((item) => item.id === "send-shortcut")!;
  const destination = { id: before.id, to: before.to, targetId: before.targetId };
  await changeLanguage("zh");
  const after = searchSettings("发送快捷键")[0]!;
  expect(after.title).toBe("发送快捷键");
  expect({ id: after.id, to: after.to, targetId: after.targetId }).toEqual(destination);
  expect(searchSettings("send shortcut").map((item) => item.id)).toContain("send-shortcut");
  expect(searchSettings("中文").map((item) => item.id)).toContain("language");
  expect(searchSettings("子模块")[0]?.id).toBe("worktree-submodules");
  expect(searchableSetting("default-model").title).toBe("默认模型");
  await changeLanguage("en");
  expect(searchableSetting("default-model").title).toBe("Default model");
});

it("finds connection settings by Chinese actions and keeps their original destinations", async () => {
  await changeLanguage("zh");
  for (const [query, id] of [
    ["配对", "remote-environments"],
    ["局域网", "network-access"],
    ["已授权", "connections-environment"],
    ["暂存", "hold-webhooks-while-offline"],
    ["负载", "load-balancing"],
  ]) {
    const result = searchSettings(query!).find((item) => item.id === id);
    expect(result, query).toMatchObject({
      id,
      to: ["remote-environments", "load-balancing"].includes(id!)
        ? "/settings/connections"
        : "/settings/access",
    });
  }
});

it("finds provider setup and background checks by their Chinese actions", async () => {
  await changeLanguage("zh");
  for (const [query, id] of [
    ["身份验证", "providers"],
    ["安装", "providers"],
    ["环境变量", "providers"],
    ["强调色", "providers"],
    ["本地命令", "providers"],
    ["状态检查", "provider-health-check-interval"],
  ]) {
    expect(
      searchSettings(query!).find((item) => item.id === id),
      query,
    ).toMatchObject({
      id,
      to: "/settings/providers",
    });
  }
});

it("finds source control writing and branch naming by Chinese terms without changing destinations", async () => {
  await changeLanguage("zh");
  for (const [query, id] of [
    ["固定前缀", "worktree-branch-naming"],
    ["约定式提交", "source-control-writing-style"],
    ["变更请求模板", "follow-change-request-templates"],
    ["书签命名", "source-control-writer-model"],
  ]) {
    expect(
      searchSettings(query!).find((item) => item.id === id),
      query,
    ).toMatchObject({
      id,
      to: id === "worktree-branch-naming" ? "/settings/worktrees" : "/settings/source-control",
      environmentOnly: true,
    });
  }
  expect(searchableSetting("worktree-branch-naming").title).toBe("Git 工作树分支命名");
  expect(searchSettings("conventional commits").map((item) => item.id)).toContain(
    "source-control-writing-style",
  );
});

it("finds hosting credentials by Chinese terms while keeping environment-only destinations", async () => {
  await changeLanguage("zh");
  for (const [query, id] of [
    ["当前账户", "source-control-host-github"],
    ["Atlassian 账户邮箱", "source-control-host-bitbucket"],
  ]) {
    expect(
      searchSettings(query!).find((item) => item.id === id),
      query,
    ).toMatchObject({
      id,
      to: id === "worktree-branch-naming" ? "/settings/worktrees" : "/settings/source-control",
      environmentOnly: true,
      scope: "environment-defaults",
    });
  }
});

it("finds tool discovery and automatic fetching by Chinese terms", async () => {
  await changeLanguage("zh");
  expect(searchSettings("工具发现").find((item) => item.id === "source-control")).toMatchObject({
    title: "版本控制",
    to: "/settings/source-control",
    scope: "environment-defaults",
  });
  expect(searchSettings("自动获取").find((item) => item.id === "git-fetch-interval")).toMatchObject(
    {
      to: "/settings/maintenance",
      environmentOnly: true,
      scope: "environment-defaults",
    },
  );
});

it("finds appearance and typography controls by Chinese terms with their existing targets", async () => {
  await changeLanguage("zh");
  expect(searchSettings("跟随系统外观")[0]).toMatchObject({
    id: "color-scheme",
    title: "颜色模式",
    to: "/settings/appearance",
    targetId: "appearance",
  });
  expect(searchSettings("color scheme")[0]?.id).toBe("color-scheme");
  expect(searchSettings("社区主题")[0]).toMatchObject({
    id: "theme",
    to: "/settings/appearance",
    targetId: "appearance",
  });
  for (const [query, id] of [
    ["玻璃效果", "setting-glass-opacity"],
    ["版本标签", "environment-identification"],
    ["蓝橙", "diff-color-scheme"],
    ["全宽", "chat-width"],
    ["动画时长", "panel-animations"],
    ["等宽字体", "code-font"],
    ["提示词字体", "prompt-font"],
    ["自动换行", "word-wrap"],
  ]) {
    expect(
      searchSettings(query!).find((item) => item.id === id),
      query,
    ).toMatchObject({
      id,
      to: id === "diff-color-scheme" ? "/settings/diffs" : "/settings/appearance",
    });
  }
  expect(searchSettings("主题").find((item) => item.id === "theme")).toMatchObject({
    targetId: "appearance",
  });
  expect(
    searchSettings("环境标识").find((item) => item.id === "environment-identification"),
  ).toMatchObject({ targetId: "appearance-interface" });
});

it("retranslates command results and keeps bilingual and native searches at the same destinations", async () => {
  await changeLanguage("zh");
  for (const query of ["复制链接", "copy link", "thread.copyReference"]) {
    expect(searchSettings(query)).toContainEqual(
      expect.objectContaining({
        id: "keybinding-thread.copyReference",
        title: "Pull Request：复制链接或会话 ID",
        to: "/settings/keybindings",
      }),
    );
  }
  expect(searchableSetting("keybindings").title).toBe("快捷键");
  const item = SETTINGS_SEARCH_ITEMS.find((item) => item.id === "keybinding-thread.copyReference")!;
  await changeLanguage("en");
  expect(item.title).toBe("Pull Request: Copy Link or Thread ID");
  expect(searchSettings("复制链接")).toContainEqual(item);
  expect(searchSettings("快捷键").map((item) => item.id)).toContain("keybindings");
});

it("finds browser integration settings in either language without changing their routes", async () => {
  await changeLanguage("zh");
  const queries = [
    ["浏览器配置", "browser-profiles", "浏览器配置"],
    ["默认浏览器视口", "browser-default-viewport", "默认浏览器视口"],
    ["录制 帧率", "browser-recording-frame-rate", "浏览器录制帧率"],
    ["链接 打开位置", "browser-link-target", "链接打开位置"],
  ];
  for (const [query, id, title] of queries) {
    expect(searchSettings(query!)).toContainEqual(
      expect.objectContaining({ id, title, to: "/settings/browser" }),
    );
  }
  await changeLanguage("en");
  expect(searchSettings("默认浏览器视口")).toContainEqual(
    expect.objectContaining({
      id: "browser-default-viewport",
      title: "Default browser viewport",
      to: "/settings/browser",
    }),
  );
  expect(searchSettings("default browser viewport")).toContainEqual(
    expect.objectContaining({ id: "browser-default-viewport" }),
  );
});

it("finds device integration destinations using either language and keeps scope and target ids", async () => {
  await changeLanguage("zh");
  for (const [query, id, title] of [
    ["设备主机", "device-sources", "设备来源"],
    ["智能体设备访问", "agent-device-access", "智能体设备访问"],
    ["设备中心", "device-hub", "使用设备"],
    ["模拟器支持", "device-platform-support", "本地模拟器"],
  ]) {
    expect(searchSettings(query!)).toContainEqual(
      expect.objectContaining({ id, title, to: "/settings/devices" }),
    );
    expect(SETTINGS_SEARCH_ITEMS.find((item) => item.id === id)?.title).toBe(title);
  }
  await changeLanguage("en");
  expect(searchSettings("设备中心")).toContainEqual(
    expect.objectContaining({ id: "device-hub", title: "Use devices", targetId: "devices" }),
  );
  expect(searchSettings("SSH identity key")).toContainEqual(
    expect.objectContaining({ id: "device-sources" }),
  );
});

it("finds snapshot settings using Chinese and English without changing destinations", async () => {
  await changeLanguage("zh");
  for (const [query, id, title] of [
    ["窗口快照", "snap-shot-enabled", "SnapShots"],
    ["包含应用文字", "snap-shot-accessibility", "包含应用文字"],
    ["快照快捷键", "snap-shot-shortcut", "快照快捷键"],
    ["快照声音", "snap-shot-sound", "快照声音"],
    ["快照闪光", "snap-shot-flash", "快照闪光"],
    ["快照动画", "snap-shot-animations", "快照动画"],
  ])
    expect(searchSettings(query!)).toContainEqual(
      expect.objectContaining({ id, title, to: "/settings/snap-shot" }),
    );
  await changeLanguage("en");
  expect(searchSettings("快照快捷键")).toContainEqual(
    expect.objectContaining({
      id: "snap-shot-shortcut",
      title: "Capture shortcut",
      targetId: "snap-shot-enabled",
    }),
  );
  expect(searchSettings("Capture shortcut")).toContainEqual(
    expect.objectContaining({ id: "snap-shot-shortcut" }),
  );
});

it("finds diagnostic flows by Chinese names in either language without changing the settings entry", async () => {
  for (const language of ["zh", "en"] as const) {
    await changeLanguage(language);
    for (const query of [
      "进程树",
      "资源历史",
      "追踪",
      "日志",
      "采集状态",
      "资源遥测",
      "温度",
      "诊断访问权限",
    ]) {
      const result = searchSettings(query).find((item) => item.id === "diagnostics");
      expect(result?.to).toBe("/settings/maintenance");
      expect(result?.id).toBe("diagnostics");
    }
  }
});

it("retranslates the providers group and keeps Chinese and English searches at its original route", async () => {
  await changeLanguage("zh");
  expect(searchableSetting("providers").title).toBe("智能体提供方");
  expect(SETTINGS_SEARCH_ITEMS.find((item) => item.id === "providers")?.title).toBe("智能体提供方");
  for (const query of ["智能体提供方", "Providers"]) {
    expect(searchSettings(query)).toContainEqual(
      expect.objectContaining({
        id: "providers",
        title: "智能体提供方",
        to: "/settings/providers",
      }),
    );
  }
  await changeLanguage("en");
  expect(searchableSetting("providers").title).toBe("Providers");
  expect(searchSettings("智能体提供方")).toContainEqual(
    expect.objectContaining({ id: "providers", title: "Providers", to: "/settings/providers" }),
  );
});

describe("source control host search items", () => {
  const definition = {
    ...UNKNOWN_SOURCE_CONTROL_CLIENT,
    kind: SourceControlProviderKind.make("example"),
    label: "Example",
    searchKeywords: ["sample"],
    settings: makeProviderSettingsSchema({ apiToken: Schema.String }),
  };

  it("lists a host by its label, its keywords, and its settings fields", () => {
    const items = sourceControlHostSearchItems([UNKNOWN_SOURCE_CONTROL_CLIENT, definition]);
    expect(items.map((item) => item.title)).toEqual(["Example credentials"]);
    expect(searchSettings("sample apitoken", items).map((item) => item.id)).toEqual([
      sourceControlHostSettingsSearchId("example"),
    ]);
  });

  it("lists a host with credentials by its accounts, token and CLI", () => {
    const items = sourceControlHostSearchItems([
      {
        ...definition,
        credentials: {
          cliName: "ex",
          cliLabel: "Example CLI",
          loginCommand: "ex login",
          tokenEnvVar: "EX_TOKEN",
          tokenAccess: "access",
          newTokenUrl: (host) => `https://${host}/tokens`,
        },
      },
    ]);
    expect(items.map((item) => item.title)).toEqual(["Example accounts and token"]);
    expect(searchSettings("ex switch accounts", items)).toHaveLength(1);
  });

  it("finds the built-in hosts by their own words", () => {
    expect(searchSettings("codeberg").map((item) => item.id)).toContain("source-control");
    expect(searchSettings("ghes").map((item) => item.id)).toContain(
      sourceControlHostSettingsSearchId("github"),
    );
  });
});

describe("movedSettingsPath", () => {
  it("sends old links to the page their row moved to", () => {
    expect(movedSettingsPath("/settings/general", "text-generation-model")).toBe(
      "/settings/threads",
    );
    expect(movedSettingsPath("/settings/connections", "authorized-clients")).toBe(
      "/settings/access",
    );
    expect(movedSettingsPath("/settings/source-control", "worktree-branch-naming")).toBe(
      "/settings/worktrees",
    );
    expect(movedSettingsPath("/settings/appearance", "diff-color-scheme")).toBe("/settings/diffs");
    expect(movedSettingsPath("/settings/connections", "network-access")).toBe("/settings/access");
    expect(movedSettingsPath("/settings/storage", "storage-worktrees")).toBe("/settings/worktrees");
    expect(movedSettingsPath("/settings/storage", "")).toBe("/settings/maintenance");
    expect(movedSettingsPath("/settings/integrations", "devices")).toBe("/settings/devices");
    expect(movedSettingsPath("/settings/beta", "")).toBe("/settings/labs");
  });

  it("leaves current pages alone", () => {
    expect(movedSettingsPath("/settings/general", "time-format")).toBeNull();
    expect(movedSettingsPath("/settings/projects", "project-defaults")).toBeNull();
    expect(movedSettingsPath("/settings/connections", "remote-environments")).toBeNull();
    expect(movedSettingsPath("/settings/appearance", "theme")).toBeNull();
  });
});
