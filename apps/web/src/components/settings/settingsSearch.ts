import type { TFunction } from "i18next";
import { i18n } from "../../i18n";
import { isElectron } from "~/env";
import { isMacPlatform, isWindowsPlatform, normalizeSearchText } from "~/lib/utils";
import { STATIC_KEYBINDING_COMMANDS, type KeybindingCommand } from "@t3tools/contracts";
import type { EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { DEFAULT_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { commandLabel } from "./KeybindingsSettings.logic";
import {
  validateSettingsScopeSearch,
  type ResolvedSettingsScope,
  type SettingsScopeSearch,
} from "./settingsScope";

export type SettingsPath =
  | "/settings/projects"
  | "/settings/general"
  | "/settings/appearance"
  | "/settings/keybindings"
  | "/settings/snap-shot"
  | "/settings/providers"
  | "/settings/integrations"
  | "/settings/scheduled-tasks"
  | "/settings/source-control"
  | "/settings/storage"
  | "/settings/connections"
  | "/settings/archived";

/**
 * Where a setting can be edited. Device-local rows have no scope: they render
 * at every selection. `project-defaults` rows accept project overrides, so
 * they are reachable from any server-backed selection.
 */
export type SettingsSearchScope =
  | "environment"
  | "environment-defaults"
  | "project-defaults"
  | "project"
  | "checkout"
  | "connections";

export interface SettingsSearchItem {
  readonly id: string;
  readonly title: string;
  readonly to: SettingsPath;
  readonly targetId?: string;
  /** Descriptions, option labels, and aliases people may remember instead of the title. */
  readonly searchTerms?: ReadonlyArray<string>;
  readonly scope?: SettingsSearchScope;
  // Its row only renders in the desktop app, so a browser result would land on
  // an anchor that isn't there.
  readonly desktopOnly?: boolean;
  readonly macOnly?: boolean;
  // Its row only renders on Windows desktop, so other desktop platforms must
  // not expose a result that points to a missing anchor.
  readonly windowsOnly?: boolean;
  readonly cloudOnly?: boolean;
  readonly environmentOnly?: boolean;
  readonly providerSettingsOnly?: boolean;
  readonly macProviderSettingsOnly?: boolean;
  readonly localBackendManagementOnly?: boolean;
  readonly localEnvironmentOnly?: boolean;
  readonly wslAvailableOnly?: boolean;
  // Its row only renders while this environment's T3 Connect managed tunnel is on.
  readonly managedTunnelOnly?: boolean;
  /**
   * Sorts after every other match. Keybinding commands mirror rows on other
   * surfaces, so "model" must still lead with Default model, not Model Picker.
   */
  readonly secondary?: boolean;
  readonly requiresThreadAutoSettlement?: boolean;
}

export interface SettingsSearchAvailability {
  readonly localEnvironmentDisabled?: boolean;
  readonly hasCloudPublicConfig: boolean;
  readonly hasEnvironment: boolean;
  readonly hasProviderSettingsEnvironment: boolean;
  readonly hasMacProviderSettingsEnvironment: boolean;
  readonly canManageLocalBackend: boolean;
  readonly isWslSettingsRowVisible: boolean;
  readonly hasThreadAutoSettlement: boolean;
  readonly managedTunnelActive?: boolean;
}

/**
 * Section labels in sidebar order. The sidebar nav and the search-result
 * subtitles both render from this record, so each label exists once.
 */
export const SETTINGS_SECTION_LABELS: Readonly<Record<SettingsPath, string>> = {
  get "/settings/projects"() {
    return i18n.t("settings.sections.projects");
  },
  get "/settings/general"() {
    return i18n.t("settings.sections.general");
  },
  get "/settings/appearance"() {
    return i18n.t("settings.sections.appearance");
  },
  get "/settings/keybindings"() {
    return i18n.t("settings.sections.keybindings");
  },
  get "/settings/snap-shot"() {
    return i18n.t("settings.sections.snap-shot");
  },
  get "/settings/providers"() {
    return i18n.t("settings.sections.providers");
  },
  get "/settings/integrations"() {
    return i18n.t("settings.sections.integrations");
  },
  get "/settings/scheduled-tasks"() {
    return i18n.t("settings.sections.scheduled-tasks");
  },
  get "/settings/source-control"() {
    return i18n.t("settings.sections.source-control");
  },
  get "/settings/storage"() {
    return i18n.t("settings.sections.storage");
  },
  get "/settings/connections"() {
    return i18n.t("settings.sections.connections");
  },
  get "/settings/archived"() {
    return i18n.t("settings.sections.archived");
  },
};

/** Anchor id of the first row bound to `command` on the Keybindings page. */
export function keybindingSearchAnchorId<Command extends KeybindingCommand>(command: Command) {
  return `keybinding-${command}` as const;
}

/**
 * One result per built-in command, alphabetical by label. The anchor is
 * the command's first row; default keys are searchable so "mod+b" lands on
 * Sidebar: Toggle. A command with no default binding may have no row, so it
 * points at the section instead.
 */
const KEYBINDING_SEARCH_ITEMS = STATIC_KEYBINDING_COMMANDS.toSorted((left, right) =>
  commandLabel(left, i18n.getFixedT("en")).localeCompare(commandLabel(right, i18n.getFixedT("en"))),
).map((command) => {
  const defaultKeys = DEFAULT_KEYBINDINGS.filter((binding) => binding.command === command).map(
    (binding) => binding.key,
  );
  return {
    id: keybindingSearchAnchorId(command),
    get title() {
      return commandLabel(command, i18n.t);
    },
    to: "/settings/keybindings" as const,
    searchTerms: [
      command,
      commandLabel(command, i18n.getFixedT("en")),
      commandLabel(command, i18n.getFixedT("zh")),
      ...defaultKeys,
    ],
    secondary: true,
    ...(defaultKeys.length === 0 ? { targetId: "keybindings" } : {}),
  };
});

/**
 * Searchable settings and stable destinations, in result order. Rows with a
 * dedicated anchor render their id and title via `searchableSetting`; items
 * that may not be mounted point at their nearest stable section instead.
 */
export const SETTINGS_SEARCH_ITEMS = [
  {
    id: "storage-worktrees",
    get title() {
      return i18n.t("settings.search.storage-worktrees.title");
    },
    to: "/settings/storage",
    scope: "project-defaults",
    searchTerms: [
      "disk storage delete deleted archived threads old inactive merged unchanged worktrees retention days project inherit off custom",
      "Git 工作树清理 删除会话 闲置 已合并 无新提交 保留天数 继承 自定义 闲置工作树 合并工作树",
    ],
  },
  {
    id: "storage-worktrees-location",
    get title() {
      return i18n.t("settings.search.storage-worktrees-location.title");
    },
    to: "/settings/storage",
    scope: "environment-defaults",
    searchTerms: [
      "worktree location folder directory path drive external disk",
      "Git 工作树位置 目录 磁盘 存放路径",
    ],
  },
  {
    id: "storage-artifacts",
    get title() {
      return i18n.t("settings.search.storage-artifacts.title");
    },
    to: "/settings/storage",
    scope: "environment-defaults",
    searchTerms: [
      "disk storage browser screenshots captures rotated logs cleanup retention",
      "产物 日志 浏览器采集 浏览器产物 截图 录屏 轮转日志 清理 保留天数",
    ],
  },
  {
    id: "project-defaults",
    get title() {
      return i18n.t("settings.search.project-defaults.title");
    },
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: [
      "Project defaults and overrides 项目默认值与覆盖设置",
      "model workspace environments projects inheritance checkout",
    ],
  },
  {
    id: "project-overview",
    title: "Project overview",
    to: "/settings/projects",
    searchTerms: ["name icon emoji image checkout remove delete"],
  },
  {
    id: "default-model",
    get title() {
      return i18n.t("settings.search.default-model.title");
    },
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: ["Default model 默认模型", "new thread project provider reasoning effort"],
  },
  {
    id: "default-permissions",
    get title() {
      return i18n.t("settings.search.default-permissions.title");
    },
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: [
      "Permissions 权限",
      "new thread default runtime mode supervised approvals auto accept edits full access",
    ],
  },
  {
    id: "color-scheme",
    get title() {
      return i18n.t("settings.search.color-scheme.title");
    },
    to: "/settings/appearance",
    searchTerms: [
      "color scheme appearance light dark system mode",
      "颜色模式 浅色 深色 跟随系统外观",
    ],
    // The scheme tiles sit at the top of the Appearance section.
    targetId: "appearance",
  },
  {
    id: "theme",
    get title() {
      return i18n.t("settings.search.theme.title");
    },
    to: "/settings/appearance",
    searchTerms: [
      "appearance colors palette custom import Open VSX community search install",
      "主题 外观 颜色 配色 自定义 导入 社区主题 搜索主题 安装主题 JSON 文件",
    ],
    // Theme cards live directly under the scheme tiles; the section is the
    // stable scroll destination for both.
    targetId: "appearance",
  },
  {
    // Prefixed because the slider control already owns the `appearance-contrast` id.
    id: "setting-appearance-contrast",
    get title() {
      return i18n.t("settings.search.setting-appearance-contrast.title");
    },
    to: "/settings/appearance",
    searchTerms: ["colors borders interface", "对比度 颜色 边框 界面"],
  },
  {
    // Prefixed because the slider control already owns the `glass-opacity` id.
    id: "setting-glass-opacity",
    get title() {
      return i18n.t("settings.search.setting-glass-opacity.title");
    },
    to: "/settings/appearance",
    searchTerms: [
      "transparent transparency solid menus dialogs composer",
      "玻璃效果 不透明度 透明度 菜单 对话框 输入框",
    ],
  },
  {
    id: "diff-color-scheme",
    get title() {
      return i18n.t("settings.search.diff-color-scheme.title");
    },
    to: "/settings/appearance",
    searchTerms: [
      "red green blue orange additions deletions changes counts palette colorblind",
      "差异颜色 红绿 蓝橙 新增 删除 变更计数 色盲",
    ],
  },
  {
    id: "chat-width",
    get title() {
      return i18n.t("settings.search.chat-width.title");
    },
    to: "/settings/appearance",
    searchTerms: [
      "wide full width column layout messages composer monitor",
      "聊天宽度 适中 全宽 大屏幕 消息 输入框",
    ],
  },
  {
    id: "panel-animations",
    get title() {
      return i18n.t("settings.search.panel-animations.title");
    },
    to: "/settings/appearance",
    searchTerms: ["面板动画 展开 收起 动效 动画时长 毫秒"],
  },
  {
    id: "environment-identification",
    get title() {
      return i18n.t("settings.search.environment-identification.title");
    },
    to: "/settings/appearance",
    searchTerms: [
      "dev nightly artwork pill label hide none",
      "环境标识 开发版 Nightly 图形标识 版本标签 不显示",
    ],
    // The setting is stage-dependent, so its parent section is the stable destination.
    targetId: "appearance-interface",
  },
  {
    id: "interface-font",
    get title() {
      return i18n.t("settings.search.interface-font.title");
    },
    to: "/settings/appearance",
    searchTerms: ["typography family size system sans", "界面字体 字体家族 字号 系统字体"],
  },
  {
    id: "prompt-font",
    get title() {
      return i18n.t("settings.search.prompt-font.title");
    },
    to: "/settings/appearance",
    searchTerms: ["typography family size composer input", "提示词字体 输入框字体 字号 等宽"],
  },
  {
    id: "code-font",
    get title() {
      return i18n.t("settings.search.code-font.title");
    },
    to: "/settings/appearance",
    searchTerms: [
      "typography family size monospace code blocks diffs file previews",
      "代码字体 等宽字体 字号 差异 文件预览",
    ],
  },
  {
    id: "terminal-font",
    get title() {
      return i18n.t("settings.search.terminal-font.title");
    },
    to: "/settings/appearance",
    searchTerms: ["typography family size monospace output", "终端字体 等宽字体 字号 输出"],
  },
  {
    id: "font-smoothing",
    get title() {
      return i18n.t("settings.search.font-smoothing.title");
    },
    to: "/settings/appearance",
    searchTerms: [
      "typography text grayscale anti aliasing macos thin",
      "字体平滑 灰度 抗锯齿 macOS 纤细",
    ],
    macOnly: true,
  },
  {
    id: "word-wrap",
    get title() {
      return i18n.t("settings.search.word-wrap.title");
    },
    to: "/settings/appearance",
    searchTerms: [
      "long lines code blocks tables diffs file previews",
      "自动换行 长行 代码 表格 差异 文件预览",
    ],
  },
  {
    id: "composer-context",
    get title() {
      return i18n.t("settings.search.composer-context.title");
    },
    to: "/settings/appearance",
    searchTerms: ["输入框上下文 分支 Git 工作树 控件 保留"],
  },
  {
    id: "project-grouping",
    get title() {
      return i18n.t("settings.search.project-grouping.title");
    },
    to: "/settings/general",
    searchTerms: [
      "Project grouping 项目分组",
      "combine matching repositories environments sidebar",
    ],
  },
  {
    id: "project-order",
    get title() {
      return i18n.t("settings.search.project-order.title");
    },
    to: "/settings/general",
    searchTerms: ["Project order 项目顺序", "sort projects sidebar manual created recent"],
  },
  {
    id: "snooze-limited-threads",
    get title() {
      return i18n.t("settings.search.snooze-limited-threads.title");
    },
    to: "/settings/general",
    searchTerms: [
      "Snooze limited threads 暂缓受用量限制的会话",
      "usage quota rate limit reset wake recover continue",
    ],
  },
  {
    id: "auto-resume-limited-threads",
    get title() {
      return i18n.t("settings.search.auto-resume-limited-threads.title");
    },
    to: "/settings/general",
    searchTerms: [
      "Auto-resume limited threads 额度重置后自动继续会话",
      "usage quota rate limit reset recover continue",
    ],
  },
  {
    id: "working-shelf",
    get title() {
      return i18n.t("settings.search.working-shelf.title");
    },
    to: "/settings/general",
    searchTerms: [
      "Working section (beta) “进行中”分区（测试版）",
      "hide fold running monitoring threads inbox sidebar shelf",
    ],
  },
  {
    id: "auto-settle-inactive-threads",
    get title() {
      return i18n.t("settings.search.auto-settle-inactive-threads.title");
    },
    to: "/settings/general",
    searchTerms: [
      "Auto-settle inactive threads 自动完成不活跃会话",
      "sidebar inactivity days no activity automatically",
    ],
    requiresThreadAutoSettlement: true,
    scope: "project-defaults",
  },
  {
    id: "auto-settle-merged-threads",
    get title() {
      return i18n.t("settings.search.auto-settle-merged-threads.title");
    },
    to: "/settings/general",
    searchTerms: [
      "Auto-settle merged threads 合并后自动完成会话",
      "pull request merge closed automatically sidebar",
    ],
    requiresThreadAutoSettlement: true,
    scope: "project-defaults",
  },
  {
    id: "days-before-auto-settle",
    get title() {
      return i18n.t("settings.search.days-before-auto-settle.title");
    },
    to: "/settings/general",
    targetId: "auto-settle-inactive-threads",
    searchTerms: [
      "Days of inactivity before auto-settle 自动完成前的无活动天数",
      "thread timeout activity sidebar",
    ],
    requiresThreadAutoSettlement: true,
    scope: "project-defaults",
  },
  {
    id: "thread-notifications",
    get title() {
      return i18n.t("settings.search.thread-notifications.title");
    },
    to: "/settings/general",
    searchTerms: [
      "Thread notifications 会话通知",
      "notification sound alert completion input approval desktop",
    ],
  },
  {
    id: "in-app-notifications",
    get title() {
      return i18n.t("settings.search.in-app-notifications.title");
    },
    to: "/settings/general",
    searchTerms: [
      "In-app notifications 应用内通知",
      "notification toast popup completion input approval failure",
    ],
  },
  {
    id: "time-format",
    get title() {
      return i18n.t("settings.search.time-format.title");
    },
    to: "/settings/general",
    searchTerms: [
      "Time format 时间格式",
      "timestamp clock locale system browser os 12 hour 24 hour",
    ],
  },
  {
    id: "language",
    get title() {
      return i18n.t("settings.search.language.title");
    },
    to: "/settings/general",
    // Includes the native names so someone searching in their own language
    // finds the row before it is translated.
    searchTerms: ["Language 语言", "language locale translation english chinese 语言 中文"],
  },
  {
    id: "response-streaming",
    get title() {
      return i18n.t("settings.search.response-streaming.title");
    },
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: [
      "Response streaming 响应显示方式",
      "output token paragraph buffered wait turn legacy",
    ],
  },
  {
    id: "hide-whitespace-changes",
    get title() {
      return i18n.t("settings.search.hide-whitespace-changes.title");
    },
    to: "/settings/general",
    searchTerms: ["Hide whitespace changes 隐藏空白字符变化", "diff ignore spaces edits default"],
  },
  {
    id: "default-diff-file-state",
    get title() {
      return i18n.t("settings.search.default-diff-file-state.title");
    },
    to: "/settings/general",
    searchTerms: [
      "Default diff file state 差异文件默认状态",
      "collapsed expanded collapse expand files pull request pr code tab",
    ],
  },
  {
    id: "diff-layout",
    get title() {
      return i18n.t("settings.search.diff-layout.title");
    },
    to: "/settings/general",
    searchTerms: ["Diff layout 差异布局", "stacked split side by side unified inline view"],
  },
  {
    id: "proactive-panels",
    get title() {
      return i18n.t("settings.search.proactive-panels.title");
    },
    to: "/settings/general",
    searchTerms: [
      "Proactive panels 自动打开相关面板",
      "automatically open diff pull request pr right panel agent completion",
    ],
  },
  {
    id: "skills-in-slash-menu",
    get title() {
      return i18n.t("settings.search.skills-in-slash-menu.title");
    },
    to: "/settings/general",
    searchTerms: [
      "Show skills in slash menu 在斜杠菜单中显示技能",
      "command menu dollar $ slash /",
    ],
  },
  {
    id: "composer-rich-text",
    get title() {
      return i18n.t("settings.search.composer-rich-text.title");
    },
    to: "/settings/general",
    searchTerms: [
      "Rich text composer 富文本输入框",
      "composer rich text tiptap bold italic markdown styled wysiwyg",
    ],
  },
  {
    id: "composer-collapse",
    get title() {
      return i18n.t("settings.search.composer-collapse.title");
    },
    to: "/settings/general",
    searchTerms: [
      "Collapse composer on scroll 滚动时收起输入框",
      "composer rest resting scroll wheel conversation timeline shrink minimize",
    ],
  },
  {
    id: "send-shortcut",
    get title() {
      return i18n.t("settings.search.send-shortcut.title");
    },
    to: "/settings/general",
    searchTerms: [
      "Send shortcut 发送快捷键",
      "enter return command ctrl multiline prompt new line composer",
    ],
  },
  {
    id: "follow-up-behavior",
    get title() {
      return i18n.t("settings.search.follow-up-behavior.title");
    },
    to: "/settings/general",
    searchTerms: [
      "Follow-up behavior 后续消息处理方式",
      "queue steer running turn send default behavior composer",
    ],
  },
  {
    id: "desktop-updates",
    get title() {
      return i18n.t("update.search.title");
    },
    to: "/settings/general",
    desktopOnly: true,
    searchTerms: [
      "Desktop updates check for updates update track stable nightly releases download install restart",
      "桌面更新 应用更新 检查更新 更新渠道 稳定版 每日构建版 下载 安装 重启",
    ],
  },
  {
    id: "provider-update-checks",
    get title() {
      return i18n.t("settings.search.provider-update-checks.title");
    },
    to: "/settings/general",
    searchTerms: [
      "Provider update checks 智能体提供方版本检查",
      "installed cli versions newer available codex claude cursor grok opencode",
    ],
    scope: "environment-defaults",
  },
  {
    id: "continue-threads-after-server-update",
    get title() {
      return i18n.t("settings.search.continue-threads-after-server-update.title");
    },
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: [
      "Continue threads after restarts 重启后继续会话",
      "resume running active interrupted work restart reboot machine crash desktop update automatically",
    ],
  },
  {
    id: "background-activity",
    get title() {
      return i18n.t("settings.search.background-activity.title");
    },
    to: "/settings/general",
    scope: "environment-defaults",
    searchTerms: [
      "Background activity 后台活动",
      "balanced performance battery saver advanced git fetch provider health refresh host power monitor idle policy",
    ],
  },
  {
    id: "new-threads",
    get title() {
      return i18n.t("settings.search.new-threads.title");
    },
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: ["New threads 新会话", "default workspace mode draft local worktree"],
  },
  {
    id: "worktree-submodules",
    get title() {
      return i18n.t("settings.search.worktree-submodules.title");
    },
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: [
      "Submodules 子模块",
      "git submodule init recursive top-level none worktree t3.json",
    ],
  },
  {
    id: "start-from-origin",
    get title() {
      return i18n.t("settings.search.start-from-origin.title");
    },
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: [
      "Start from origin 从 origin 创建",
      "new worktrees latest matching remote branch local",
    ],
  },
  {
    id: "add-project-starts-in",
    get title() {
      return i18n.t("settings.search.add-project-starts-in.title");
    },
    to: "/settings/general",
    scope: "environment-defaults",
    searchTerms: [
      "Add project starts in 添加项目的起始目录",
      "base directory folder browser path home",
    ],
  },
  {
    id: "unpin-confirmation",
    get title() {
      return i18n.t("settings.search.unpin-confirmation.title");
    },
    to: "/settings/general",
    searchTerms: ["Unpin confirmation 取消置顶确认", "ask before thread pinned section"],
  },
  {
    id: "archive-confirmation",
    get title() {
      return i18n.t("settings.search.archive-confirmation.title");
    },
    to: "/settings/general",
    searchTerms: ["Archive confirmation 归档确认", "ask before thread second click inline action"],
  },
  {
    id: "delete-confirmation",
    get title() {
      return i18n.t("settings.search.delete-confirmation.title");
    },
    to: "/settings/general",
    searchTerms: ["Delete confirmation 删除确认", "ask before thread chat history"],
  },
  {
    id: "quit-confirmation",
    get title() {
      return i18n.t("settings.search.quit-confirmation.title");
    },
    to: "/settings/general",
    searchTerms: [
      "Quit shortcut 退出快捷键",
      "confirmation desktop app exit direct hold double click press twice",
    ],
    desktopOnly: true,
  },
  {
    id: "text-generation-model",
    get title() {
      return i18n.t("settings.search.text-generation-model.title");
    },
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: [
      "Text generation model 文本生成模型",
      "generated thread titles source control content default provider",
    ],
  },
  {
    id: "cli-command",
    get title() {
      return i18n.t("settings.search.cli-command.title");
    },
    to: "/settings/general",
    searchTerms: ["t3 command t3 命令", "cli terminal shell path install command line"],
    desktopOnly: true,
  },
  {
    id: "privacy-policy",
    get title() {
      return i18n.t("settings.search.privacy-policy.title");
    },
    to: "/settings/general",
    searchTerms: [
      "Privacy policy 隐私政策",
      "telemetry analytics usage data tracking legal opt out",
    ],
  },
  {
    id: "diagnostics",
    get title() {
      return i18n.t("settings.search.diagnostics.title");
    },
    to: "/settings/general",
    searchTerms: [
      "Diagnostics 诊断",
      "logs traces processes resource history failures spans cpu memory",
      "日志 追踪 进程树 资源历史 失败 跨度 CPU 内存 诊断访问权限",
      "资源监控 资源遥测 主机状态 采集状态 温度 电源 读取吞吐量 写入吞吐量",
    ],
  },
  {
    id: "open-source-licenses",
    get title() {
      return i18n.t("settings.search.open-source-licenses.title");
    },
    searchTerms: ["Open source licenses 开源许可证"],
    to: "/settings/general",
  },
  {
    id: "legacy-plan-mode",
    get title() {
      return i18n.t("settings.search.legacy-plan-mode.title");
    },
    to: "/settings/general",
    searchTerms: ["Plan mode (legacy) 计划模式（旧版）", "build plan composer old"],
  },
  {
    id: "legacy-context-window-indicator",
    get title() {
      return i18n.t("settings.search.legacy-context-window-indicator.title");
    },
    to: "/settings/general",
    searchTerms: [
      "Context window indicator (legacy) 上下文窗口指示器（旧版）",
      "composer meter usage tokens circle old",
    ],
  },
  {
    id: "legacy-sidebar",
    get title() {
      return i18n.t("settings.search.legacy-sidebar.title");
    },
    to: "/settings/general",
    searchTerms: ["Sidebar (legacy) 侧边栏（旧版）", "project thread tree old flat list"],
  },
  {
    id: "keybindings",
    get title() {
      return i18n.t("settings.search.keybindings.title");
    },
    to: "/settings/keybindings",
    searchTerms: [
      "Keybindings 快捷键 键盘 按键 动作 默认 自定义 项目",
      "keyboard shortcuts hotkeys commands bindings json",
    ],
  },
  ...KEYBINDING_SEARCH_ITEMS,
  {
    id: "snap-shot-enabled",
    get title() {
      return i18n.t("settings.sections.snap-shot");
    },
    searchTerms: [
      "SnapShots SnapShots",
      "窗口快照 截图 截屏 窗口捕获",
      "window capture screenshot",
    ],
    to: "/settings/snap-shot",
  },
  {
    id: "snap-shot-accessibility",
    get title() {
      return i18n.t("snapshots.search.text");
    },
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
    searchTerms: [
      "Include app text 包含应用文字",
      "应用文字 文本 辅助功能 控件 隐私",
      "capture accessibility data text UI structure elements privacy omit agent context",
    ],
  },
  {
    id: "snap-shot-shortcut",
    get title() {
      return i18n.t("snapshots.search.shortcut");
    },
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
    searchTerms: ["Capture shortcut 快照快捷键", "快照快捷键 快捷键 按键 录制"],
  },
  {
    id: "snap-shot-sound",
    get title() {
      return i18n.t("snapshots.search.sound");
    },
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
    searchTerms: ["Capture sound 快照声音", "快照声音 音效 风声 快门声 静音"],
  },
  {
    id: "snap-shot-flash",
    get title() {
      return i18n.t("snapshots.search.flash");
    },
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
    searchTerms: ["Capture flash 快照闪光", "快照闪光 闪烁 提示"],
  },
  {
    id: "snap-shot-animations",
    get title() {
      return i18n.t("snapshots.search.animations");
    },
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
    searchTerms: ["Capture animations 快照动画", "快照动画 草稿"],
  },
  {
    id: "providers",
    get title() {
      return i18n.t("settings.sections.providers");
    },
    to: "/settings/providers",
    searchTerms: [
      "Providers 智能体提供方 agents cli codex claude cursor grok opencode antigravity google sign in sign out install subscription instances authentication api key models configuration binary path config directory endpoint arguments environment variables display name accent color custom favorite hidden auto compact",
      "智能体 提供方 安装 更新 登录 退出 身份验证 实例 模型 环境变量 配置",
      "ACP 注册表 本地命令 实例 ID 强调色 颜色 参数 可执行文件 原生会话 导入",
    ],
  },
  {
    id: "usage-providers",
    get title() {
      return i18n.t("settings.search.usage-providers.title");
    },
    to: "/settings/providers",
    searchTerms: [
      "usage sources CLIProxyAPI CLI proxy hub quota subscription limits management key add remove",
      "用量来源 用量服务 服务地址 管理密钥 额度 配额 添加服务 移除服务",
    ],
    providerSettingsOnly: true,
  },
  {
    id: "cursor-keychain-usage",
    get title() {
      return i18n.t("settings.search.cursor-keychain-usage.title");
    },
    to: "/settings/providers",
    searchTerms: ["cursor macOS keychain usage tokens cost limits permission"],
    providerSettingsOnly: true,
    macProviderSettingsOnly: true,
  },
  {
    id: "provider-health-check-interval",
    title: "Health check interval",
    to: "/settings/providers",
    searchTerms: [
      "refresh availability versions auth state models background probes seconds off",
      "刷新 状态检查 间隔 后台 版本 秒 停用",
    ],
    providerSettingsOnly: true,
  },
  {
    id: "agent-browser-access",
    get title() {
      return i18n.t("defaults.browser.title");
    },
    to: "/settings/integrations",
    scope: "project-defaults",
    searchTerms: [
      "Agent browser access 智能体浏览器访问 浏览器权限 项目覆盖",
      "allow disable enable open drive preview tools sessions project override",
    ],
  },
  {
    id: "device-hosts",
    get title() {
      return i18n.t("device.hosts.title");
    },
    to: "/settings/integrations",
    searchTerms: [
      "Device hosts 设备主机",
      "设备主机 远程主机 SSH 连接 身份文件 密钥 端口",
      "ssh remote simulator emulator ios android mac mini identity key connection",
    ],
  },
  {
    id: "agent-device-access",
    get title() {
      return i18n.t("device.agent.access");
    },
    to: "/settings/integrations",
    targetId: "devices",
    searchTerms: [
      "Agent device access 智能体设备访问",
      "智能体设备访问 权限 控制 设备工具",
      "allow simulator emulator ios android drive tools sessions",
    ],
  },
  {
    id: "device-hub",
    get title() {
      return i18n.t("device.hub.title");
    },
    to: "/settings/integrations",
    targetId: "devices",
    searchTerms: [
      "Device hub 设备中心",
      "设备中心 模拟器 安装 启动",
      "simulator emulator ios android install start",
    ],
  },
  {
    id: "device-platform-support",
    get title() {
      return i18n.t("device.platform.title");
    },
    to: "/settings/integrations",
    targetId: "devices",
    searchTerms: [
      "Simulator support 模拟器支持",
      "模拟器支持 运行时 安卓 苹果",
      "xcode android studio sdk avd runtime",
    ],
  },
  {
    id: "browser-profiles",
    get title() {
      return i18n.t("settings.search.browser-profiles.title");
    },
    to: "/settings/integrations",
    targetId: "browser",
    searchTerms: [
      "Browser profiles 浏览器配置",
      "profiles cookies logins incognito import clear remove 浏览器配置 Cookie 登录 无痕 导入 清除 移除",
    ],
  },
  {
    id: "browser-default-profile",
    get title() {
      return i18n.t("settings.search.browser-default-profile.title");
    },
    to: "/settings/integrations",
    targetId: "browser-profiles",
    searchTerms: [
      "Default browser profile 默认浏览器配置",
      "default browser profile 默认浏览器配置",
    ],
  },
  {
    id: "browser-default-viewport",
    get title() {
      return i18n.t("settings.search.browser-default-viewport.title");
    },
    to: "/settings/integrations",
    searchTerms: [
      "Default browser viewport 默认浏览器视口",
      "preview size width height device desktop mobile rotate 视口 尺寸 宽度 高度 设备 旋转 横向 纵向",
    ],
  },
  {
    id: "browser-default-zoom",
    get title() {
      return i18n.t("settings.search.browser-default-zoom.title");
    },
    to: "/settings/integrations",
    searchTerms: [
      "Default browser zoom 默认浏览器缩放",
      "preview page scale tabs percent 浏览器 页面 缩放 比例",
    ],
  },
  {
    id: "browser-default-appearance",
    get title() {
      return i18n.t("settings.search.browser-default-appearance.title");
    },
    to: "/settings/integrations",
    searchTerms: [
      "Default browser appearance 默认浏览器外观",
      "preview color scheme light dark system os 浏览器 外观 配色 浅色 深色 跟随系统",
    ],
  },
  {
    id: "browser-recording-frame-rate",
    get title() {
      return i18n.t("settings.search.browser-recording-frame-rate.title");
    },
    to: "/settings/integrations",
    searchTerms: [
      "Browser recording frame rate 浏览器录制帧率",
      "recording frame rate fps browser preview 录制 帧率",
    ],
  },
  {
    id: "browser-recording-key-presses",
    get title() {
      return i18n.t("settings.search.browser-recording-key-presses.title");
    },
    to: "/settings/integrations",
    searchTerms: [
      "Show key presses in recordings 在录制中显示按键",
      "browser preview keyboard shortcuts keystrokes overlay capture 浏览器 录制 按键 快捷键",
    ],
  },
  {
    id: "browser-recording-mouse-presses",
    get title() {
      return i18n.t("settings.search.browser-recording-mouse-presses.title");
    },
    to: "/settings/integrations",
    searchTerms: [
      "Show mouse presses in recordings 在录制中显示鼠标点击",
      "browser preview clicks buttons drag overlay capture 浏览器 录制 鼠标 点击 拖动",
    ],
  },
  {
    id: "browser-link-target",
    get title() {
      return i18n.t("settings.search.browser-link-target.title");
    },
    to: "/settings/integrations",
    searchTerms: [
      "Open links in 链接打开位置",
      "links default browser in-app browser external open 链接 打开位置 默认浏览器 应用内浏览器",
    ],
  },
  {
    id: "browser-auto-show-floating-preview",
    get title() {
      return i18n.t("settings.search.browser-auto-show-floating-preview.title");
    },
    to: "/settings/integrations",
    searchTerms: [
      "Auto-show floating preview 自动显示悬浮预览",
      "agent opens browser device simulator pop into view hide 智能体 浏览器 设备 悬浮预览 自动显示",
    ],
  },
  {
    id: "automatic-pull",
    title: "Automatically pull",
    to: "/settings/source-control",
    scope: "project-defaults",
    searchTerms: ["auto pull default branch current checkout fast forward upstream"],
  },
  {
    id: "remove-agent-credits-on-merge",
    get title() {
      return i18n.t("settings.search.remove-agent-credits-on-merge.title");
    },
    to: "/settings/source-control",
    scope: "project-defaults",
    searchTerms: [
      "Remove agent credits when merging 合并时移除智能体署名",
      "pull request github squash co-authored-by attribution claude codex generated",
    ],
  },
  {
    id: "pull-request-merge-method",
    get title() {
      return i18n.t("settings.search.pull-request-merge-method.title");
    },
    to: "/settings/source-control",
    scope: "project-defaults",
    searchTerms: [
      "Default merge method 默认合并方式",
      "pull request merge squash rebase last selected",
    ],
  },
  {
    id: "source-control",
    get title() {
      return i18n.t("settings.search.source-control.title");
    },
    to: "/settings/source-control",
    scope: "environment-defaults",
    searchTerms: [
      "version control git github gitlab forgejo gitea tea codeberg bitbucket azure devops hosting integrations credentials scan server environment",
      "版本控制 代码托管 托管平台 工具发现 安装 凭据 服务器环境 扫描",
    ],
  },
  {
    id: "git-fetch-interval",
    get title() {
      return i18n.t("settings.search.git-fetch-interval.title");
    },
    to: "/settings/source-control",
    searchTerms: [
      "Git fetch interval Git fetch 间隔",
      "automatic remote branch refresh background credentials security keys seconds off",
      "自动获取 后台刷新 远程分支 获取间隔 秒",
    ],
    environmentOnly: true,
    scope: "environment-defaults",
  },
  {
    id: "worktree-branch-naming",
    get title() {
      return i18n.t("settings.search.worktree-branch-naming.title");
    },
    to: "/settings/source-control",
    searchTerms: [
      "static semantic prefix custom prompt instructions feat fix refactor chore",
      "Git 工作树分支命名 固定前缀 语义前缀 分支前缀 命名指令",
    ],
    environmentOnly: true,
    scope: "project-defaults",
  },
  {
    id: "github-accounts",
    get title() {
      return i18n.t("settings.search.github-accounts.title");
    },
    to: "/settings/source-control",
    searchTerms: [
      "github gh account login user host enterprise ghes switch multiple accounts disable sign in token personal access token pat api key credential",
      "GitHub 账户 令牌 登录 主机 凭据 当前账户 企业版",
    ],
    environmentOnly: true,
    scope: "environment-defaults",
  },
  {
    id: "bitbucket-credentials",
    get title() {
      return i18n.t("settings.search.bitbucket-credentials.title");
    },
    to: "/settings/source-control",
    searchTerms: [
      "bitbucket atlassian access token api token email credentials sign in",
      "Bitbucket 凭据 访问令牌 API 令牌 Atlassian 账户邮箱 登录",
    ],
    environmentOnly: true,
    scope: "environment-defaults",
  },
  {
    id: "source-control-writing-style",
    get title() {
      return i18n.t("settings.search.source-control-writing-style.title");
    },
    to: "/settings/source-control",
    searchTerms: [
      "repository conventions conventional commits custom instructions change descriptions request titles",
      "版本控制写作风格 仓库惯例 约定式提交 自定义指令 变更说明",
    ],
    environmentOnly: true,
  },
  {
    id: "follow-change-request-templates",
    get title() {
      return i18n.t("settings.search.follow-change-request-templates.title");
    },
    to: "/settings/source-control",
    searchTerms: [
      "repository pr pull request description structure",
      "遵循变更请求模板 拉取请求模板 PR 模板",
    ],
    environmentOnly: true,
  },
  {
    id: "source-control-writer-model",
    get title() {
      return i18n.t("settings.search.source-control-writer-model.title");
    },
    to: "/settings/source-control",
    searchTerms: [
      "override generated commit change request pr titles descriptions branch bookmark",
      "版本控制写作模型 提交说明 书签命名 分支命名模型",
    ],
    environmentOnly: true,
    scope: "project-defaults",
  },
  {
    id: "project-actions",
    title: "Actions",
    to: "/settings/projects",
    searchTerms: ["commands scripts setup run dev server checkout worktree t3.json import"],
  },
  {
    id: "environment-icon",
    title: "Environment icon",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: [
      "machine glyph sidebar mac mini studio laptop desktop server cloud vm",
      "机器 图标 标识",
    ],
  },
  {
    id: "local-environment",
    title: "Local environment",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: [
      "turn off on disable enable local server agents remote only restart",
      "本机 智能体 开关 服务器 重启",
    ],
    desktopOnly: true,
  },
  {
    id: "network-access",
    title: "Network access",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: [
      "expose backend remote pairing local machine interfaces host restart",
      "远程 配对 局域网 地址 网络",
    ],
    localBackendManagementOnly: true,
  },
  {
    id: "tailscale-https",
    title: "Tailscale HTTPS",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: ["serve magicdns endpoint remote secure network", "隧道 网络 远程 安全"],
    desktopOnly: true,
    localBackendManagementOnly: true,
  },
  {
    id: "wsl-backend",
    title: "WSL backend",
    to: "/settings/connections",
    searchTerms: [
      "windows subsystem linux distro second server projects stop windows backend restart",
      "发行版 子系统 后端 重启",
    ],
    desktopOnly: true,
    windowsOnly: true,
    localBackendManagementOnly: true,
    wslAvailableOnly: true,
  },
  {
    id: "t3-connect",
    localEnvironmentOnly: true,
    title: "T3 Connect",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: ["managed tunnel cloud other devices remote", "隧道 远程 云端 其他设备"],
    desktopOnly: true,
    cloudOnly: true,
  },
  {
    id: "hold-webhooks-while-offline",
    localEnvironmentOnly: true,
    title: "Hold webhooks while offline",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: ["webhook automations offline queue mailbox t3 connect", "离线 队列 自动化 暂存"],
    cloudOnly: true,
    managedTunnelOnly: true,
  },
  {
    id: "publish-agent-activity",
    localEnvironmentOnly: true,
    title: "Publish agent activity",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: [
      "mobile push notifications live activities cloud tunnel",
      "移动 通知 推送 实时活动",
    ],
    cloudOnly: true,
  },
  {
    id: "connections-environment",
    title: "This machine",
    to: "/settings/connections",
    searchTerms: [
      "connections server backend local remote access administrative permissions scope pairing links qr code authorized clients sessions revoke endpoint",
      "本机 权限 已授权 客户端 配对 凭据 撤销",
    ],
  },
  {
    id: "remote-environments",
    title: "Environments",
    to: "/settings/connections",
    searchTerms: [
      "add pair backend host code ssh config agent tunnel saved t3 connect",
      "远程 设备 连接 主机 配对 SSH 路由",
    ],
  },
  {
    id: "load-balancing",
    title: "Load balancing",
    to: "/settings/connections",
    searchTerms: [
      "automatic machine environment resources cpu memory capacity preference weight shared projects",
      "分配 负载 多设备 CPU 内存",
    ],
  },
  {
    id: "github-routing",
    title: "GitHub sharing",
    to: "/settings/connections",
    searchTerms: [
      "pull request trusted environments shared credentials permissions read actions",
      "共享 权限 拉取请求 信任",
    ],
  },
  {
    id: "archive",
    title: "Archived threads",
    to: "/settings/archived",
    searchTerms: ["restore reopen deleted history projects"],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;

export type SettingsSearchItemId = (typeof SETTINGS_SEARCH_ITEMS)[number]["id"];

const SEARCH_ITEMS_BY_ID = new Map(SETTINGS_SEARCH_ITEMS.map((item) => [item.id, item] as const));

const SETTINGS_CATEGORY_SCOPES: Readonly<Record<SettingsPath, SettingsSearchScope | null>> = {
  "/settings/projects": "project",
  "/settings/general": null,
  "/settings/appearance": null,
  "/settings/snap-shot": null,
  // Keybindings fan out to the selection; Providers shows the representative
  // environment at any selection. Neither needs a particular scope to render.
  "/settings/keybindings": null,
  "/settings/providers": null,
  "/settings/integrations": null,
  "/settings/source-control": "environment-defaults",
  "/settings/storage": "project-defaults",
  "/settings/connections": "connections",
  "/settings/scheduled-tasks": null,
  "/settings/archived": "project-defaults",
};

/** Search keeps the selected target. A missing row can explain its owning scope instead. */
export function getSettingsSearchTargetScope(targetId: string) {
  const items: readonly SettingsSearchItem[] = SETTINGS_SEARCH_ITEMS;
  const item =
    items.find((candidate) => candidate.id === targetId) ??
    items.find((candidate) => candidate.targetId === targetId);
  return item
    ? {
        title: item.title,
        scope: item.scope ?? SETTINGS_CATEGORY_SCOPES[item.to],
        ...(item.requiresThreadAutoSettlement ? { requiresThreadAutoSettlement: true } : {}),
      }
    : null;
}

interface AutoSettlementSearchEnvironment {
  readonly environmentId: EnvironmentId;
  readonly connection: { readonly phase: EnvironmentConnectionPhase };
  readonly serverConfig: {
    readonly environment: {
      readonly capabilities: { readonly threadAutoSettlement?: boolean };
    };
  } | null;
}

/** Discovery needs one capable environment; the selected page needs every connected target to support it. */
export function getThreadAutoSettlementSearchAvailability(
  environments: readonly AutoSettlementSearchEnvironment[],
  scope?: Pick<ResolvedSettingsScope, "kind" | "environmentIds">,
) {
  const connected = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" && environment.serverConfig !== null,
  );
  const eligibleEnvironmentIds = connected
    .filter(
      (environment) =>
        environment.serverConfig?.environment.capabilities.threadAutoSettlement === true,
    )
    .map((environment) => environment.environmentId);
  const selected = connected.filter((environment) =>
    scope?.environmentIds.includes(environment.environmentId),
  );
  return {
    eligibleEnvironmentIds,
    isTargetAvailable:
      scope !== undefined &&
      scope.kind !== "unavailable" &&
      selected.length > 0 &&
      selected.every((environment) => eligibleEnvironmentIds.includes(environment.environmentId)),
  };
}

export function isSettingsSearchScopeAvailable(
  requiredScope: SettingsSearchScope | null,
  scopeKind: ResolvedSettingsScope["kind"],
): boolean {
  switch (requiredScope) {
    case null:
    case "connections":
      return true;
    case "environment":
    case "checkout":
      return requiredScope === scopeKind;
    case "project":
      return scopeKind === "project" || scopeKind === "checkout";
    case "environment-defaults":
      return scopeKind === "environment" || scopeKind === "all";
    case "project-defaults":
      return (
        scopeKind === "environment" ||
        scopeKind === "all" ||
        scopeKind === "project" ||
        scopeKind === "checkout"
      );
  }
}

function settingsScopeKindFromSearch(search: SettingsScopeSearch): ResolvedSettingsScope["kind"] {
  const target = validateSettingsScopeSearch({ ...search });
  if (target.checkout && !target.project) return "unavailable";
  if (target.project) return target.checkout ? "checkout" : "project";
  return target.machine ? "environment" : "all";
}

export function isSettingsOverviewVisible(search: SettingsScopeSearch): boolean {
  const kind = settingsScopeKindFromSearch(search);
  return kind === "project" || kind === "checkout";
}

/**
 * `id` and `title` props for the element a search item anchors to. Panels
 * spread (or pick from) this instead of restating the strings, so the catalog
 * and the rendered settings cannot drift apart.
 */
export function settingsSectionLabel(to: SettingsPath, translate: TFunction = i18n.t): string {
  return translate(`settings.sections.${to.slice("/settings/".length)}`);
}

export function settingsSearchItemTitle(
  item: SettingsSearchItem,
  translate: TFunction = i18n.t,
): string {
  return translate(`settings.search.${item.id}.title`, { defaultValue: item.title });
}

export function searchableSetting(
  id: SettingsSearchItemId,
  translate: TFunction = i18n.t,
): {
  readonly id: string;
  readonly title: string;
} {
  const item = SEARCH_ITEMS_BY_ID.get(id)!;
  return { id: item.id, title: settingsSearchItemTitle(item, translate) };
}

export function filterAvailableSettingsSearchItems(
  availability: SettingsSearchAvailability,
): ReadonlyArray<SettingsSearchItem> {
  const items: ReadonlyArray<SettingsSearchItem> = SETTINGS_SEARCH_ITEMS;
  return items.filter(
    (item) =>
      (!item.cloudOnly || availability.hasCloudPublicConfig) &&
      (!item.environmentOnly || availability.hasEnvironment) &&
      (!item.providerSettingsOnly || availability.hasProviderSettingsEnvironment) &&
      (!item.macProviderSettingsOnly || availability.hasMacProviderSettingsEnvironment) &&
      (!item.localBackendManagementOnly || availability.canManageLocalBackend) &&
      (!item.localEnvironmentOnly || !availability.localEnvironmentDisabled) &&
      (!item.wslAvailableOnly || availability.isWslSettingsRowVisible) &&
      (!item.requiresThreadAutoSettlement || availability.hasThreadAutoSettlement) &&
      (!item.managedTunnelOnly || availability.managedTunnelActive === true),
  );
}

export function searchSettings(
  query: string,
  items: ReadonlyArray<SettingsSearchItem> = SETTINGS_SEARCH_ITEMS,
  translate: TFunction = i18n.t,
): ReadonlyArray<SettingsSearchItem> {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) return [];
  const queryTokens = normalizedQuery.split(" ");
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;

  return items
    .flatMap((item, index) => {
      if (!isElectron && item.desktopOnly === true) return [];
      if (item.macOnly && !isMacPlatform(platform)) return [];
      if (item.windowsOnly && !isWindowsPlatform(platform)) return [];

      const title = normalizeSearchText(settingsSearchItemTitle(item, translate));
      const fields = [
        title,
        normalizeSearchText(settingsSectionLabel(item.to, translate)),
        ...(item.searchTerms ?? []).map(normalizeSearchText),
      ];
      if (!queryTokens.every((token) => fields.some((field) => field.includes(token)))) return [];

      const exactPhraseField = fields.findIndex((field) => field.includes(normalizedQuery));
      const rank =
        title === normalizedQuery
          ? 5
          : title.startsWith(normalizedQuery)
            ? 4
            : title.includes(normalizedQuery)
              ? 3
              : queryTokens.every((token) => title.includes(token))
                ? 2
                : exactPhraseField >= 0
                  ? 1
                  : 0;
      return [{ item, index, rank }];
    })
    .toSorted(
      (left, right) =>
        Number(left.item.secondary ?? false) - Number(right.item.secondary ?? false) ||
        right.rank - left.rank ||
        left.index - right.index,
    )
    .map(({ item }) => item);
}
